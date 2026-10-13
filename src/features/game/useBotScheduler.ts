import { useCallback, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type { MoveAnalysis } from '../../analysis/classify';
import type { BoardState, PieceType, Move, SquareId } from '../../engine';
import { pickAiRouletteMove } from './roulette';
import { applyRotationMove, toggleTopology } from '../../engine/auxetic';
import { applyMove } from '../../engine/moves';
import { SubutaiAgent, type BotStrength } from '../../ai/agents';
import { moveVoting } from '../../twitch/moveVoting';
import { bumpEvalForMove } from './position';
import { classifyAsync } from '../../analysis/classifyClient';
import { scaleBudgetMs } from '../../utils/deviceTier';
import { searchPosition } from '../../ai/search';
import type { GameMode } from '../../shared/game';
import { session } from '../../session/session';
import { playableRouletteMoves } from '../../session/rules';

// Auto-mode tuning. We skip the move classifier (expensive worker round-trip)
// and use a small inter-move delay so a 60-ply game finishes in ~30s.
const AUTO_MOVE_DELAY_MS = 50;

// Shallow search used to label each auto-mode position for training data.
// ~100ms × ~80 plies ≈ +8s per game on top of the move-generation cost.
const AUTO_SEARCH_LABEL_BUDGET_MS = 100;
const AUTO_SEARCH_LABEL_DEPTH = 4;

interface UseBotSchedulerArgs {
  autoTimerRef: RefObject<number | null>;
  autoLastMoveAtRef: RefObject<number>;
  isMultiplayerRef: RefObject<boolean>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  botLevelRef: RefObject<BotStrength>;
  gameMode: GameMode;
  aiTimerRef: RefObject<number | null>;
  setSearchEvalFromWhite: Dispatch<SetStateAction<number | null>>;
  setSearchMateInPlies: Dispatch<SetStateAction<number | null>>;
  logLengthRef: RefObject<number>;
  commitAnalysis: (moveIdx: number, analysis: MoveAnalysis, moveTo: SquareId | undefined) => void;
}

/**
 * How the bot plays a move: scheduleAiMove searches and plays a classic
 * move (and hands it to the classifier), the roulette helpers spin and
 * play one action at a time, and scheduleAutoMove is the quick step of a
 * self-play run. The effect in App that decides when the bot moves calls
 * these. They choose; the session applies (session.dispatch, step.ts).
 * scheduleAiMove and scheduleAutoMove keep one identity for the session,
 * so they read the first render's gameMode, exactly as they did in App.
 */
export function useBotScheduler({
  autoTimerRef,
  autoLastMoveAtRef,
  isMultiplayerRef,
  setSelected,
  botLevelRef,
  gameMode,
  aiTimerRef,
  setSearchEvalFromWhite,
  setSearchMateInPlies,
  logLengthRef,
  commitAnalysis,
}: UseBotSchedulerArgs) {
  // --- Roulette AI helpers: each is ONE action of the session.

  // The AI's spin: its bag, drawn at once (no wheel), kept even if it
  // allows nothing — the next action decides what to do then.
  function applyAiSpin() {
    session.dispatch({ type: 'botSpin' });
  }

  // ONE AI action. Never schedules another timer — the effect re-fires on
  // the resulting state change.
  function executeAiRouletteAction(bs: BoardState, rolled: PieceType[], used: number[]) {
    const playable = playableRouletteMoves(bs, rolled, used);

    if (playable.length === 0) {
      // No piece move for the remaining slots. Try rotation as a fallback:
      // only worthwhile if the rotated topology opens up playable moves.
      const canRotate = !bs.lastMoveWasRotation;
      if (canRotate && playableRouletteMoves(toggleTopology(bs), rolled, used).length > 0) {
        session.dispatch({ type: 'rotate', actor: 'bot', now: Date.now() });
        return;
      }
      // Truly stuck — pass the turn.
      session.dispatch({ type: 'pass' });
      return;
    }

    const choice = pickAiRouletteMove(bs, playable);
    const mv: Move =
      choice.kind === 'promotion' && !choice.promotion
        ? { ...choice, promotion: 'queen' }
        : choice;
    // The turn goes on while the bag has actions and something to do with
    // them; a captured king ends the game (step.ts rouletteMove).
    session.dispatch({ type: 'move', move: mv, actor: 'bot', now: Date.now() });
  }

  const scheduleAiMove = useCallback(
    (
      boardState: BoardState,
      moves: Move[],
      lastMoveWasRotation: boolean,
    ) => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      aiTimerRef.current = setTimeout(async () => {
        const chosen = await SubutaiAgent.chooseMove(boardState, moves, {
          lastMoveWasRotation,
          allowSelfCheck: gameMode === 'roulette',
          strength: botLevelRef.current,
        });
        // R15-bug — clearTimeout can't stop a callback that already fired
        // and is parked on the await above. If a PvP match started while
        // the engine was thinking, this continuation must NOT touch the
        // solo world: its checkGameOver would set a terminal gameStatus
        // that the MP UI reads (banner over the board, clock hidden).
        if (isMultiplayerRef.current) return;
        if (!chosen) return;
        if (chosen.kind === 'topologyToggle' && boardState.lastMoveWasRotation) {
          console.warn('[rotation guard] AI returned rotation when not allowed — ignoring');
          return;
        }

        // T4 — Twitch move-vote gate. No-op (returns `chosen` instantly)
        // unless a vote mode is on and chat is connected. In predict
        // mode the gate holds the engine's move through a 15s vote
        // window; in chat mode it substitutes the chat-elected move.
        // Classic only — roulette's slot rules don't fit the candidate
        // model.
        const logLenBeforeGate = logLengthRef.current;
        const move =
          gameMode === 'classic'
            ? await moveVoting.gate(boardState, moves, chosen)
            : chosen;
        // T6 — the 15s vote window can outlive the game it started in
        // (new game / restore). Any log rewrite shifts the length; bail
        // instead of committing a move onto a different position.
        if (logLengthRef.current !== logLenBeforeGate) return;

        const next =
          move.kind === 'topologyToggle'
            ? applyRotationMove(boardState)
            : applyMove(boardState, move);

        // The board changes now; whether the game is over is asked after
        // the classification below (settle), as it always was.
        session.dispatch({ type: 'move', move, actor: 'bot', now: Date.now(), settle: false });
        setSelected(null);

        // Worker-backed classify: takes ~1 s of background work for depth 7
        // but doesn't block the main thread. logLengthRef gives us AI's
        // moveIdx (the count BEFORE the append we just did would be the same
        // value the ref still holds, so capture it BEFORE setLog above runs
        // its commit — which it has, but the ref only updates on next effect.
        // In practice the timing works because we read it right after the
        // synchronous setLog call returns).
        if (move.kind !== 'topologyToggle') {
          const moveIdx = logLengthRef.current;
          // B3 — material-delta bump instead of static-fallback flicker.
          setSearchEvalFromWhite((prev) => bumpEvalForMove(prev, boardState, move));
          setSearchMateInPlies(null);
          const aiAnalysis = await classifyAsync(boardState, move, next, {
            budgetMs: scaleBudgetMs(1000),
            maxDepth: 7,
            allowSelfCheck: gameMode === 'roulette',
          });
          commitAnalysis(moveIdx, aiAnalysis, move.to);
        }

        session.dispatch({ type: 'settle', board: next, lastWasRotation: move.kind === 'topologyToggle' });
      }, 650);
    },
    [
      commitAnalysis,
      isMultiplayerRef,
      botLevelRef,
      setSearchEvalFromWhite,
      setSearchMateInPlies,
      aiTimerRef,
      logLengthRef,
      setSelected,
    ],
  );

  // Slim AI step for auto mode: no classifier round-trip, tighter delay.
  // The standard scheduleAiMove path is preserved unchanged for human play.
  const scheduleAutoMove = useCallback(
    (boardState: BoardState, moves: Move[], wasRotation: boolean) => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      autoTimerRef.current = setTimeout(async () => {
        const move = await SubutaiAgent.chooseMove(boardState, moves, {
          lastMoveWasRotation: wasRotation,
          allowSelfCheck: gameMode === 'roulette',
        });
        if (!move) return;
        if (move.kind === 'topologyToggle' && boardState.lastMoveWasRotation) return;

        const next =
          move.kind === 'topologyToggle'
            ? applyRotationMove(boardState)
            : applyMove(boardState, move);

        session.dispatch({ type: 'move', move, actor: 'bot', now: Date.now() });
        setSelected(null);
        autoLastMoveAtRef.current = Date.now();

        // Label the resulting position with a shallow search score. Synchronous
        // (worker-free) so we don't add a second round-trip per move. Wrapped
        // in try/catch — a labeller failure must never stall the auto loop.
        try {
          const labelled = searchPosition(next, {
            budgetMs: AUTO_SEARCH_LABEL_BUDGET_MS,
            maxDepth: AUTO_SEARCH_LABEL_DEPTH,
          });
          const scoreFromWhite =
            next.sideToMove === 'white' ? labelled.score : -labelled.score;
          session.dispatch({ type: 'searchScore', scoreFromWhite });
        } catch (err) {
          console.warn('[autoplay] label search failed', err);
        }
      }, AUTO_MOVE_DELAY_MS);
    },
    // gameMode is the first render's, like scheduleAiMove's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return { applyAiSpin, executeAiRouletteAction, scheduleAiMove, scheduleAutoMove };
}
