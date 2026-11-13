import type { Dispatch, SetStateAction } from 'react';
import { searchAsync } from '../../ai/searchClient';
import type { BoardState, SquareId } from '../../engine';
import { applyRotationMove } from '../../engine/auxetic';
import { localData, LOCAL_KEYS } from '../../infra/localData';
import { session } from '../../session/session';
import type { GameMode, GameStatus } from '../../shared/game';
import type { WatchingGame } from '../review/watching';

type HintMove = { from: SquareId; to: SquareId } | { rotate: true } | null;

interface UseCoachToolsArgs {
  watchingGame: WatchingGame | null;
  /** Whose turn from this seat (App): the hint is for the player here. */
  currentPlayer: 'human' | 'ai';
  gameStatus: GameStatus;
  gameMode: GameMode;
  /** The game on the board (App's alias). */
  state: BoardState;
  /** Rotating is a legal turn now (useCanRotate): the hint may say "rotate". */
  canRotate: boolean;
  /** S2.4 — the coaching group's switch, and the tools it hides (App state). */
  setHelpToolsEnabled: Dispatch<SetStateAction<boolean>>;
  setShowSupport: Dispatch<SetStateAction<boolean>>;
  setShowThreats: Dispatch<SetStateAction<boolean>>;
  setHintMove: Dispatch<SetStateAction<HintMove>>;
}

/**
 * The coaching tools of the board's action row (S2.4): the switch that
 * shows or hides the group (saved, and switching off clears the support
 * map, the threat map and the hint), and the engine hint, a short search
 * on the search worker (Classic only). Plain handlers, no React hooks
 * inside: what they read is passed in from App's render, so the call's
 * position changes no effect order.
 */
export function useCoachTools({
  watchingGame,
  currentPlayer,
  gameStatus,
  gameMode,
  state,
  canRotate,
  setHelpToolsEnabled,
  setShowSupport,
  setShowThreats,
  setHintMove,
}: UseCoachToolsArgs) {
  function toggleHelpTools() {
    setHelpToolsEnabled((v) => {
      const next = !v;
      try {
        localData.set(LOCAL_KEYS.helpTools, next ? '1' : '0');
      } catch { /* private mode */ }
      if (!next) {
        setShowSupport(false);
        setShowThreats(false);
        setHintMove(null);
      }
      return next;
    });
  }

  // S2.4 — engine hint. A short search (~0.5s) on the search worker, for a
  // deliberate button press. Classic mode only: roulette's slot
  // restrictions aren't modeled by the bare search, so its "best move"
  // could be illegal this turn.
  async function computeHint() {
    if (currentPlayer !== 'human' || gameStatus !== 'active' || watchingGame) return;
    if (gameMode !== 'classic') return;
    // The board may move on while the worker thinks (a new game, a
    // resume): a hint for another position is dropped.
    const asked = session.getState().board;
    const stillAsked = () => session.getState().board === asked;
    const result = await searchAsync(state, {
      budgetMs: 500,
      maxDepth: 5,
      lastMoveWasRotation: state.lastMoveWasRotation,
    });
    const best = result.bestMove;
    if (!best || !stillAsked()) return;
    if (best.kind === 'topologyToggle') {
      setHintMove({ rotate: true });
      return;
    }
    // B4 — the search explores rotation but its eval rarely ranks it
    // strictly #1, so the hint never showed the signature move. Probe
    // the rotation line explicitly: if it's at least as good as the
    // best piece move (within 30cp), recommend the rotate — it's the
    // mechanic worth teaching.
    if (canRotate && !state.lastMoveWasRotation) {
      const rotated = applyRotationMove(state);
      const reply = await searchAsync(rotated, {
        budgetMs: 300,
        maxDepth: 4,
        lastMoveWasRotation: true,
      });
      if (!stillAsked()) return;
      const rotationScore = -reply.score; // negamax: reply is opponent-side
      if (rotationScore >= result.score - 30) {
        setHintMove({ rotate: true });
        return;
      }
    }
    if (best.from && best.to) {
      setHintMove({ from: best.from, to: best.to });
    }
  }

  return { toggleHelpTools, computeHint };
}
