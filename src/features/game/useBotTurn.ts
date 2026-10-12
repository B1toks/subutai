import { useEffect, type RefObject } from 'react';
import { AI_ROULETTE_REVEAL_MS, AI_ROULETTE_BETWEEN_ACTIONS_MS } from './roulette';
import type { WatchingGame } from '../review/watching';
import type { BoardState, Move, PieceType } from '../../engine';
import { useSession } from '../../session/useSession';
import { statusOf } from '../../session/step';

/** The used slots when no bag is spun: one array, so the effect below
 *  does not re-run for a new empty one. */
const NO_SLOTS: number[] = [];

interface UseBotTurnArgs {
  isAutoMode: boolean;
  autoStopped: boolean;
  autoTimerRef: RefObject<number | null>;
  isMultiplayer: boolean;
  watchingGame: WatchingGame | null;
  aiTimerRef: RefObject<number | null>;
  currentPlayer: 'human' | 'ai';
  scheduleAutoMove: (boardState: BoardState, moves: Move[], wasRotation: boolean) => void;
  scheduleAiMove: (boardState: BoardState, moves: Move[], lastMoveWasRotation: boolean) => void;
  applyAiSpin: () => void;
  executeAiRouletteAction: (bs: BoardState, rolled: PieceType[], used: number[]) => void;
}

/**
 * When the bot moves: on its turn in a solo game (and on every turn in a
 * self-play run) this schedules one step through useBotScheduler's
 * functions. Roulette runs one phase per render: spin, then each action
 * after its pause, each a fresh run of this effect. Solo only, so it
 * reads the game from the session itself.
 */
export function useBotTurn({
  isAutoMode,
  autoStopped,
  autoTimerRef,
  isMultiplayer,
  watchingGame,
  aiTimerRef,
  currentPlayer,
  scheduleAutoMove,
  scheduleAiMove,
  applyAiSpin,
  executeAiRouletteAction,
}: UseBotTurnArgs) {
  const state = useSession((s) => s.board);
  const legalMoves = useSession((s) => s.legal) as Move[];
  const gameStatus = useSession(statusOf);
  const gameMode = useSession((s) => s.mode);
  const bag = useSession((s) => s.roulette.bag);
  const allowedPieceTypes = (bag?.slots ?? null) as PieceType[] | null;
  const rouletteActionsLeft = bag?.actionsLeft ?? 0;
  const usedRouletteSlots = (bag?.used ?? NO_SLOTS) as number[];
  const lastMoveWasRotation = useSession(
    (s) => s.log.moves.length > 0 && s.log.moves[s.log.moves.length - 1]?.move.kind === 'topologyToggle',
  );
  useEffect(() => {
    if (isMultiplayer) return; // PvP: no engine drives the opponent
    if (gameStatus !== 'active') return;
    if (watchingGame) return; // replay mode — never let the AI move.
    if (isAutoMode) {
      if (autoStopped) return;
      scheduleAutoMove(state, legalMoves, lastMoveWasRotation);
      return () => {
        // eslint-disable-next-line react-hooks/exhaustive-deps -- a timer id set by scheduleAutoMove, not a DOM node: clear the one pending now
        if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      };
    }
    if (currentPlayer !== 'ai') return;

    // Classic: the old path handles its own setTimeout + minimax.
    if (gameMode !== 'roulette') {
      scheduleAiMove(state, legalMoves, lastMoveWasRotation);
      return () => {
        if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      };
    }

    // --- Roulette (state-driven, one phase per render) -------------------
    //
    // Each branch schedules exactly ONE timer and performs ONE atomic state
    // transition. No chained timers, no closures over stale state: after the
    // timer fires and state updates, React re-runs this effect with fresh
    // state and selects the next phase.
    //
    // Phase 1 — AI spins (no roll yet).
    // Phase 2a — AI has rolled; execute action 1 after REVEAL pause.
    // Phase 2b — AI has acted once; execute action 2 after THINK pause.
    // (2a and 2b are the same branch; the delay is longer on the first one
    //  so the human can see the fresh roll.)

    if (allowedPieceTypes === null) {
      // Phase 1 — AI spin. Always runs after a short pause; the first-spin
      // gate only applies to human turns (auto-spin effect there waits for
      // the player's first manual click).
      const t = setTimeout(() => {
        applyAiSpin();
      }, 500);
      aiTimerRef.current = t;
      return () => clearTimeout(t);
    }

    if (rouletteActionsLeft > 0) {
      // Phase 2a/2b — one action, then exit. State change re-triggers effect.
      const delay =
        usedRouletteSlots.length === 0
          ? AI_ROULETTE_REVEAL_MS
          : AI_ROULETTE_BETWEEN_ACTIONS_MS;
      const t = setTimeout(() => {
        executeAiRouletteAction(state, allowedPieceTypes, usedRouletteSlots);
      }, delay);
      aiTimerRef.current = t;
      return () => clearTimeout(t);
    }
  // The helpers (applyAiSpin, executeAiRouletteAction) are re-created each
  // render and close over the current setState setters (stable refs). We
  // intentionally depend on the roulette fields so each phase transition
  // re-fires the effect with the latest state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentPlayer,
    state,
    gameStatus,
    gameMode,
    allowedPieceTypes,
    rouletteActionsLeft,
    usedRouletteSlots,
    legalMoves,
    scheduleAiMove,
    scheduleAutoMove,
    lastMoveWasRotation,
    watchingGame,
    isAutoMode,
    autoStopped,
    isMultiplayer,
  ]);
}
