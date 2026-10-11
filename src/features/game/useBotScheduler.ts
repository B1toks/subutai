import { useCallback, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type { MoveAnalysis } from '../../analysis/classify';
import type { BoardState, PieceType, Move, SquareId } from '../../engine';
import {
  getActivePieceTypes,
  spinRoulette,
  ROULETTE_MAX_ACTIONS,
  pickAiRouletteMove,
  consumeSlotIndex,
} from './roulette';
import { applyRotationMove, toggleTopology, applyPassMove } from '../../engine/auxetic';
import {
  computeSAN,
  appendMove,
  attachSearchScoreToLastMove,
  type GameLog,
} from '../../recording/log';
import { applyMove, findKing } from '../../engine/moves';
import { SubutaiAgent, type BotStrength } from '../../ai/agents';
import { moveVoting } from '../../twitch/moveVoting';
import { bumpEvalForMove } from './position';
import { classifyAsync } from '../../analysis/classifyClient';
import { scaleBudgetMs } from '../../utils/deviceTier';
import { searchPosition } from '../../ai/search';
import type { GameMode } from '../../shared/game';

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
  setState: Dispatch<SetStateAction<BoardState>>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setLegalMoves: Dispatch<SetStateAction<Move[]>>;
  setLog: Dispatch<SetStateAction<GameLog>>;
  setLastMove: Dispatch<SetStateAction<{ from?: SquareId; to?: SquareId } | null>>;
  botLevelRef: RefObject<BotStrength>;
  gameMode: GameMode;
  getLegalMoves: (s: BoardState) => Move[];
  setAllowedPieceTypes: Dispatch<SetStateAction<PieceType[] | null>>;
  setRouletteActionsLeft: Dispatch<SetStateAction<number>>;
  setUsedRouletteSlots: Dispatch<SetStateAction<number[]>>;
  setRouletteSpinCount: Dispatch<SetStateAction<number>>;
  rouletteSpinCount: number;
  aiTimerRef: RefObject<number | null>;
  setSearchEvalFromWhite: Dispatch<SetStateAction<number | null>>;
  setSearchMateInPlies: Dispatch<SetStateAction<number | null>>;
  logLengthRef: RefObject<number>;
  commitAnalysis: (moveIdx: number, analysis: MoveAnalysis, moveTo: SquareId | undefined) => void;
  playableRouletteMoves: (boardState: BoardState, allowed: PieceType[], used: number[]) => Move[];
  checkGameOver: (nextState: BoardState, lastMoveWasRotation?: boolean) => void;
}

/**
 * How the bot plays a move: scheduleAiMove searches and plays a classic
 * move (and hands it to the classifier), the roulette helpers spin and
 * play one action at a time, and scheduleAutoMove is the quick step of a
 * self-play run. The effect in App that decides when the bot moves calls
 * these. scheduleAiMove and scheduleAutoMove keep one identity for the
 * session, so they read the first render's checkGameOver, gameMode and
 * getLegalMoves, exactly as they did in App.
 */
export function useBotScheduler({
  autoTimerRef,
  autoLastMoveAtRef,
  isMultiplayerRef,
  setState,
  setSelected,
  setLegalMoves,
  setLog,
  setLastMove,
  botLevelRef,
  gameMode,
  getLegalMoves,
  setAllowedPieceTypes,
  setRouletteActionsLeft,
  setUsedRouletteSlots,
  setRouletteSpinCount,
  rouletteSpinCount,
  aiTimerRef,
  setSearchEvalFromWhite,
  setSearchMateInPlies,
  logLengthRef,
  commitAnalysis,
  playableRouletteMoves,
  checkGameOver,
}: UseBotSchedulerArgs) {
  // --- Roulette AI helpers (state-driven; each is ONE atomic state transition).

  // Apply the AI's spin. Sets allowedPieceTypes, seeds actions / slots, and
  // exits — the main effect picks up Phase 2 on the next render.
  function applyAiSpin(bs: BoardState) {
    const activeTypes = getActivePieceTypes(bs, bs.sideToMove);
    const pawnBoost = rouletteSpinCount < 3;
    const rolled = spinRoulette(activeTypes, pawnBoost);
    setRouletteSpinCount((n) => n + 1);
    setAllowedPieceTypes(rolled);
    setUsedRouletteSlots([]);
    setRouletteActionsLeft(ROULETTE_MAX_ACTIONS);
    setLegalMoves(playableRouletteMoves(bs, rolled, []));
  }

  // Apply an AI rotation as one action. Same semantics as handleRotate's
  // roulette branch, but self-contained for the AI driver.
  function executeAiRouletteRotation(
    bs: BoardState,
    rolled: PieceType[],
    used: number[],
    actionsLeft: number,
  ) {
    const rotated = applyRotationMove(bs);
    const toggleMove: Move = { kind: 'topologyToggle' };
    const san = computeSAN(bs, toggleMove);
    setLog((prev) => appendMove(prev, toggleMove, san, bs.topologyState));
    setLastMove(null);

    const actionsAfter = actionsLeft - 1;

    if (actionsAfter === 0) {
      setState(rotated);
      setAllowedPieceTypes(null);
      setUsedRouletteSlots([]);
      setRouletteActionsLeft(0);
      setLegalMoves(getLegalMoves(rotated));
      return;
    }

    // Stay on turn. Clamp side back; no further rotation allowed this turn.
    const clamped: BoardState = { ...rotated, sideToMove: bs.sideToMove };
    const nextPlayable = playableRouletteMoves(clamped, rolled, used);
    if (nextPlayable.length === 0) {
      // Nothing useful left — end the turn.
      setState(rotated);
      setAllowedPieceTypes(null);
      setUsedRouletteSlots([]);
      setRouletteActionsLeft(0);
      setLegalMoves(getLegalMoves(rotated));
      return;
    }

    setState(clamped);
    setRouletteActionsLeft(actionsAfter);
    setLegalMoves(nextPlayable);
    // allowedPieceTypes and usedRouletteSlots unchanged.
  }

  // Execute ONE AI sub-move and update React state. Never schedules another
  // timer — the effect re-fires on the resulting state change.
  function executeAiRouletteAction(
    bs: BoardState,
    rolled: PieceType[],
    used: number[],
    actionsLeft: number,
  ) {
    const playable = playableRouletteMoves(bs, rolled, used);

    if (playable.length === 0) {
      // No piece move for the remaining slots. Try rotation as a fallback:
      // only worthwhile if the rotated topology opens up playable moves.
      const canRotate = !bs.lastMoveWasRotation;
      if (canRotate) {
        const rotatedPreview = toggleTopology(bs);
        const postRotPlayable = playableRouletteMoves(rotatedPreview, rolled, used);
        if (postRotPlayable.length > 0) {
          executeAiRouletteRotation(bs, rolled, used, actionsLeft);
          return;
        }
      }
      // Truly stuck — pass the turn.
      const passed = applyPassMove(bs);
      setState(passed);
      setAllowedPieceTypes(null);
      setUsedRouletteSlots([]);
      setRouletteActionsLeft(0);
      setLegalMoves(getLegalMoves(passed));
      setLastMove(null);
      return;
    }

    const choice = pickAiRouletteMove(bs, playable);
    const mv: Move =
      choice.kind === 'promotion' && !choice.promotion
        ? { ...choice, promotion: 'queen' }
        : choice;
    const moverType = bs.pieces[mv.from!]!.type;
    const slotIdx = consumeSlotIndex(rolled, used, moverType);
    const newUsed = slotIdx >= 0 ? [...used, slotIdx] : used;
    const newActions = actionsLeft - 1;

    const san = computeSAN(bs, mv);
    const afterMove = applyMove(bs, mv);

    setLog((prev) => appendMove(prev, mv, san, bs.topologyState));
    setLastMove({ from: mv.from, to: mv.to });

    const kingCaptured =
      !findKing(afterMove, 'white') || !findKing(afterMove, 'black');

    if (kingCaptured) {
      setState(afterMove);
      setAllowedPieceTypes(null);
      setUsedRouletteSlots([]);
      setRouletteActionsLeft(0);
      checkGameOver(afterMove);
      return;
    }

    const noMoreActions = newActions <= 0;
    const clampedNext: BoardState = { ...afterMove, sideToMove: bs.sideToMove };
    const nextPlayable = noMoreActions
      ? []
      : playableRouletteMoves(clampedNext, rolled, newUsed);
    // Can the AI still do *something* next action? Either a piece move exists,
    // or rotation is available (and potentially useful — checked by the next
    // executeAiRouletteAction call).
    const canContinue =
      nextPlayable.length > 0 || !clampedNext.lastMoveWasRotation;
    const endTurn = noMoreActions || !canContinue;

    if (endTurn) {
      // Accept the side flip from applyMove — opponent's spin phase next.
      setState(afterMove);
      setAllowedPieceTypes(null);
      setUsedRouletteSlots([]);
      setRouletteActionsLeft(0);
      setLegalMoves(getLegalMoves(afterMove));
      return;
    }

    // Keep AI on the turn — clamp sideToMove back to 'bs.sideToMove'.
    setState(clampedNext);
    setUsedRouletteSlots(newUsed);
    setRouletteActionsLeft(newActions);
    setLegalMoves(nextPlayable);
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

        setState(next);
        const nextMoves = getLegalMoves(next);
        setLegalMoves(nextMoves);
        setSelected(null);
        const aiSan = computeSAN(boardState, move);
        setLog((prev) => appendMove(prev, move, aiSan, boardState.topologyState));
        setLastMove(
          move.kind === 'topologyToggle'
            ? null
            : { from: move.from, to: move.to },
        );

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

        checkGameOver(next, move.kind === 'topologyToggle');
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
      setLastMove,
      setLegalMoves,
      setLog,
      setSelected,
      setState,
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

        const san = computeSAN(boardState, move);
        setState(next);
        setLegalMoves(getLegalMoves(next));
        setSelected(null);
        setLog((prev) => appendMove(prev, move, san, boardState.topologyState));
        setLastMove(
          move.kind === 'topologyToggle'
            ? null
            : { from: move.from, to: move.to },
        );
        autoLastMoveAtRef.current = Date.now();
        checkGameOver(next, move.kind === 'topologyToggle');

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
          setLog((prev) => attachSearchScoreToLastMove(prev, scoreFromWhite));
        } catch (err) {
          console.warn('[autoplay] label search failed', err);
        }
      }, AUTO_MOVE_DELAY_MS);
    },
    // checkGameOver is captured from the enclosing scope; identical pattern to
    // scheduleAiMove which also does not list it in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return { applyAiSpin, executeAiRouletteAction, scheduleAiMove, scheduleAutoMove };
}
