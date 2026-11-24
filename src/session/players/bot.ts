import type { BoardState, Color, Move, PieceType } from '../../engine';
import { applyRotationMove, toggleTopology } from '../../engine/auxetic';
import { applyMove } from '../../engine/moves';
import type { BotStrength } from '../../ai/agents';
import { chooseBotMove, searchAsync } from '../../ai/searchClient';
import {
  AI_ROULETTE_BETWEEN_ACTIONS_MS,
  AI_ROULETTE_REVEAL_MS,
  pickAiRouletteMove,
} from '../../features/game/roulette';
import { playableRouletteMoves } from '../rules';
import type { Action, SessionEvent, SessionState } from '../types';
import type { Player } from './types';

/** The pause before a classic move, so the player sees theirs land. */
const THINK_MS = 650;
/** Roulette: the pause before the bot spins. */
const SPIN_MS = 500;
/** Self-play: the pause between moves, so a 60-ply game takes ~30 s. */
const AUTO_MOVE_DELAY_MS = 50;
// Shallow search used to label each self-play position for training data.
// ~100ms × ~80 plies ≈ +8s per game on top of the move-generation cost.
const AUTO_SEARCH_LABEL_BUDGET_MS = 100;
const AUTO_SEARCH_LABEL_DEPTH = 4;

/** Waits `ms`, or rejects when the turn ends first. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });
}

/** A turn the bot has nothing to answer: it waits for the turn to end. */
function stall(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

const lastWasRotation = (s: SessionState) =>
  s.log.moves.length > 0 && s.log.moves[s.log.moves.length - 1]?.move.kind === 'topologyToggle';

/** One action of the bot's Roulette turn, with what is left of its bag. */
export function rouletteAction(bs: BoardState, rolled: readonly PieceType[], used: readonly number[]): Action {
  const playable = playableRouletteMoves(bs, rolled as PieceType[], used as number[]);
  if (playable.length === 0) {
    // No piece move for the remaining slots. Try rotation as a fallback:
    // only worthwhile if the rotated topology opens up playable moves.
    const canRotate = !bs.lastMoveWasRotation;
    if (canRotate && playableRouletteMoves(toggleTopology(bs), rolled as PieceType[], used as number[]).length > 0) {
      return { type: 'rotate', actor: 'bot', now: Date.now() };
    }
    // Truly stuck — pass the turn.
    return { type: 'pass' };
  }
  const choice = pickAiRouletteMove(bs, playable);
  const mv: Move =
    choice.kind === 'promotion' && !choice.promotion ? { ...choice, promotion: 'queen' } : choice;
  // The turn goes on while the bag has actions and something to do with
  // them; a captured king ends the game (step.ts rouletteMove).
  return { type: 'move', move: mv, actor: 'bot', now: Date.now() };
}

export interface BotPlayerOptions {
  readonly color: Color;
  /** Runs an action outside a turn's answer: the end-of-game check of a
   *  classic move, the self-play label. */
  readonly dispatch: (action: Action) => readonly SessionEvent[];
  /** The level, read when the move is chosen. */
  readonly strength: () => BotStrength;
  /** Twitch Predict / chat vote (moveVoting.gate): the classic move to
   *  play instead of the engine's, after the vote window. */
  readonly vote: (board: BoardState, legal: Move[], chosen: Move) => Promise<Move>;
  /** A classic move is on the board (`index` in the log): whatever comes
   *  before the game's end is asked (the classifier's verdict). */
  readonly analyse: (before: BoardState, move: Move, after: BoardState, index: number, logId: string) => Promise<void>;
  /** A classic or self-play move of the bot has just run. */
  readonly moved: () => void;
}

/**
 * The bot, seated on one side. A classic turn: a pause, the level's move
 * from the search worker, the Twitch vote; the move goes on the board and
 * the game's end is asked only after the classifier has spoken. Roulette:
 * a spin, then one action per turn of the bag, each after its pause.
 */
export function createBotPlayer(opts: BotPlayerOptions): Player {
  let pendingSettle: { before: BoardState; move: Move; index: number; logId: string } | null = null;
  return {
    color: opts.color,
    kind: 'bot',
    async onTurn(s, signal) {
      if (s.mode === 'roulette') {
        const bag = s.roulette.bag;
        if (bag === null) {
          // The bot spins after a short pause; its bag lands slot by slot
          // (the turn waits for it, players/turns.ts).
          await pause(SPIN_MS, signal);
          return { type: 'botSpin', now: Date.now() };
        }
        if (bag.actionsLeft <= 0) return stall(signal);
        await pause(bag.used.length === 0 ? AI_ROULETTE_REVEAL_MS : AI_ROULETTE_BETWEEN_ACTIONS_MS, signal);
        return rouletteAction(s.board, bag.slots, bag.used);
      }
      await pause(THINK_MS, signal);
      const legal = s.legal as Move[];
      const chosen = await chooseBotMove(
        s.board,
        legal,
        { lastMoveWasRotation: lastWasRotation(s), allowSelfCheck: false, strength: opts.strength() },
        () => !signal.aborted,
      );
      signal.throwIfAborted();
      if (!chosen) return stall(signal);
      if (chosen.kind === 'topologyToggle' && s.board.lastMoveWasRotation) {
        console.warn('[rotation guard] AI returned rotation when not allowed — ignoring');
        return stall(signal);
      }
      // T4 — Twitch move-vote gate. Returns `chosen` at once unless a vote
      // mode is on and chat is connected. Classic only — roulette's slot
      // rules don't fit the candidate model.
      const move = await opts.vote(s.board, legal, chosen);
      signal.throwIfAborted();
      pendingSettle = { before: s.board, move, index: s.log.moves.length, logId: s.log.id };
      // The board changes now; whether the game is over is asked after the
      // classification (onPlayed), as it always was.
      return { type: 'move', move, actor: 'bot', now: Date.now(), settle: false };
    },
    onPlayed(action, events) {
      const p = pendingSettle;
      pendingSettle = null;
      // A move the session refused (events: none) sets nothing off.
      if (action.type !== 'move' || action.settle !== false || !p || events.length === 0) return;
      opts.moved();
      const rotation = p.move.kind === 'topologyToggle';
      const next = rotation ? applyRotationMove(p.before) : applyMove(p.before, p.move);
      const settle = () =>
        opts.dispatch({ type: 'settle', board: next, lastWasRotation: rotation, logId: p.logId, plies: p.index + 1 });
      if (rotation) settle();
      // A classifier that failed leaves the move without a verdict; the
      // end of the game is asked all the same.
      else void opts.analyse(p.before, p.move, next, p.index, p.logId).then(settle, settle);
    },
  };
}

/**
 * The bot of a self-play run, seated on both sides: a short pause, the
 * full-strength move, and a shallow search that labels the new position.
 * No classifier, no vote. Its search allows no self-check in either
 * mode: it always read the first render's mode, which is classic.
 */
export function createAutoPlayer(opts: Pick<BotPlayerOptions, 'color' | 'dispatch' | 'moved'>): Player {
  let pendingLabel: BoardState | null = null;
  return {
    color: opts.color,
    kind: 'bot',
    async onTurn(s, signal) {
      await pause(AUTO_MOVE_DELAY_MS, signal);
      const move = await chooseBotMove(
        s.board,
        s.legal as Move[],
        { lastMoveWasRotation: lastWasRotation(s), allowSelfCheck: false },
        () => !signal.aborted,
      );
      signal.throwIfAborted();
      if (!move) return stall(signal);
      if (move.kind === 'topologyToggle' && s.board.lastMoveWasRotation) return stall(signal);
      pendingLabel = move.kind === 'topologyToggle' ? applyRotationMove(s.board) : applyMove(s.board, move);
      return { type: 'move', move, actor: 'bot', now: Date.now() };
    },
    onPlayed() {
      const next = pendingLabel;
      pendingLabel = null;
      if (!next) return;
      opts.moved();
      // Label the resulting position with a shallow search score, on the
      // search worker: it runs before the next move's search, which waits
      // behind it there. A labeller failure must never stall the run.
      void searchAsync(next, { budgetMs: AUTO_SEARCH_LABEL_BUDGET_MS, maxDepth: AUTO_SEARCH_LABEL_DEPTH })
        .then((labelled) => {
          const scoreFromWhite = next.sideToMove === 'white' ? labelled.score : -labelled.score;
          opts.dispatch({ type: 'searchScore', scoreFromWhite });
        })
        .catch((err) => console.warn('[autoplay] label search failed', err));
    },
  };
}
