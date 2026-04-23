import './App.css';
import type { BoardState, Color, Move, PieceType, SquareId, TopologyState } from './engine';
import { createStartingPosition, createPositionFromBackRankKey, isValidChess960Key } from './engine';
import { allSquares } from './engine/board';
import {
  applyMove,
  generateLegalMoves,
  generatePseudoLegalMoves,
  isCheckmate,
  isStalemate,
  checkDrawConditions,
  isInCheck,
  isSquareAttacked,
  countAttackers,
  getAttackerSquares,
  findKing,
  findCheckingPieces,
} from './engine/moves';
import { applyRotationMove, applyPassMove, toggleTopology, computeBoardLayout, tilePixelCenter } from './engine/auxetic';
import { SubutaiAgent } from './ai/agents';
import { PIECE_VALUE } from './ai/evaluate';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameLog } from './recording/log';
import { appendMove, computeSAN, createGameLog } from './recording/log';
import { buildSavedGameFromLog, buildSavedGameSnapshot } from './memory/build';
import { localStorageAdapter } from './memory/storage';
import { MemoryPanel } from './memory/MemoryPanel';
import type { SavedGame } from './memory/types';
import { NotationParseError, parseMemoryNotation } from './memory/notation';

type GameStatus =
  | 'active'
  | 'checkmate'
  | 'draw_stalemate'
  | 'draw_material'
  | 'draw_repetition'
  | 'draw_50move'
  | 'king_captured_white_wins'
  | 'king_captured_black_wins';

type GameMode = 'classic' | 'roulette';

const ROULETTE_SLOT_COUNT = 4;
const ROULETTE_MAX_ACTIONS = 2;
const AI_ROULETTE_REVEAL_MS = 1200;
const AI_ROULETTE_BETWEEN_ACTIONS_MS = 900;

/** Only piece types currently alive for `color` — no "dead" slots. */
function getActivePieceTypes(state: BoardState, color: Color): PieceType[] {
  const types = new Set<PieceType>();
  for (const piece of Object.values(state.pieces)) {
    if (piece && piece.color === color) types.add(piece.type);
  }
  return Array.from(types);
}

function spinRoulette(activeTypes: PieceType[]): PieceType[] {
  if (activeTypes.length === 0) return [];
  const out: PieceType[] = [];
  for (let i = 0; i < ROULETTE_SLOT_COUNT; i++) {
    out.push(activeTypes[Math.floor(Math.random() * activeTypes.length)]);
  }
  return out;
}

function backRankString(boardState: BoardState): string {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const abbrev: Record<string, string> = {
    rook: 'R', knight: 'N', bishop: 'B', queen: 'Q', king: 'K',
  };
  return files
    .map((f) => {
      const piece = boardState.pieces[`${f}1` as SquareId];
      return piece ? abbrev[piece.type] ?? '?' : '?';
    })
    .join('');
}

function App() {
  const [seed, setSeed] = useState<number>(1);
  const [state, setState] = useState<BoardState>(() => createStartingPosition(1));
  const [initialState, setInitialState] = useState<BoardState>(() => createStartingPosition(1));
  const [selected, setSelected] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>(() =>
    generateLegalMoves(createStartingPosition(1)),
  );
  const [log, setLog] = useState<GameLog>(() =>
    createGameLog('game-1', createStartingPosition(1), 1),
  );
  const [gameStatus, setGameStatus] = useState<GameStatus>('active');
  const [previewTopology, setPreviewTopology] = useState<TopologyState | null>(null);
  const [lastMove, setLastMove] = useState<{ from?: SquareId; to?: SquareId } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showMaterialPopup, setShowMaterialPopup] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showThreats, setShowThreats] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [previewLocked, setPreviewLocked] = useState(false);
  const [lockedPreviewTopology, setLockedPreviewTopology] = useState<TopologyState | null>(null);
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null);
  const [formationLocked, setFormationLocked] = useState(false);
  const [lockedFormationKey, setLockedFormationKey] = useState<string | null>(null);
  const [formationInputMode, setFormationInputMode] = useState(false);
  const [formationInputValue, setFormationInputValue] = useState('');
  const [showReplayDialog, setShowReplayDialog] = useState(false);
  const [replayText, setReplayText] = useState('');
  const [replayError, setReplayError] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: SquareId;
    to: SquareId;
  } | null>(null);
  const [gameMode, setGameMode] = useState<GameMode>('classic');
  const [allowedPieceTypes, setAllowedPieceTypes] = useState<PieceType[] | null>(null);
  const [isRouletteSpinning, setIsRouletteSpinning] = useState<boolean>(false);
  const [rouletteActionsLeft, setRouletteActionsLeft] = useState<number>(0);
  const [usedRouletteSlots, setUsedRouletteSlots] = useState<number[]>([]);
  const formationInputRef = useRef<HTMLInputElement>(null);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedForLogIdRef = useRef<string | null>(null);
  const liveSavedGameIdRef = useRef<string>(
    `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  const [boardSize, setBoardSize] = useState(() =>
    Math.min(window.innerWidth - 32, 520),
  );

  useEffect(() => {
    function onResize() {
      setBoardSize(Math.min(window.innerWidth - 32, 520));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (formationInputMode) formationInputRef.current?.focus();
  }, [formationInputMode]);

  useEffect(() => {
    if (gameStatus === 'active') return;
    if (log.moves.length === 0) return;
    if (savedForLogIdRef.current === log.id) return;

    const sourceId = liveSavedGameIdRef.current;
    const termination: 'checkmate' | 'stalemate' =
      gameStatus === 'checkmate'
        || gameStatus === 'king_captured_white_wins'
        || gameStatus === 'king_captured_black_wins'
        ? 'checkmate'
        : 'stalemate';
    const saved = buildSavedGameFromLog(log, state, termination, sourceId);
    (localStorageAdapter.saveOrUpdateGame?.(saved) ?? localStorageAdapter.saveGame(saved));

    // Clean up the live snapshot so Memory shows one final entry.
    if (sourceId) {
      localStorageAdapter.deleteGame?.(sourceId);
    }

    savedForLogIdRef.current = log.id;
  }, [gameStatus, log, state]);

  useEffect(() => {
    if (gameStatus !== 'active') return;
    if (log.moves.length === 0) return;
    const liveId = liveSavedGameIdRef.current;
    if (!liveId) return;
    const snapshot = buildSavedGameSnapshot(log, liveId);
    (localStorageAdapter.saveOrUpdateGame?.(snapshot) ?? localStorageAdapter.saveGame(snapshot));
  }, [gameStatus, log]);

  function applyFormationCode() {
    const raw = formationInputValue.trim().toUpperCase();
    if (!raw) {
      setFormationInputMode(false);
      setFormationInputValue('');
      return;
    }
    if (!isValidChess960Key(raw)) {
      setFormationInputValue(raw);
      return;
    }
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    const initial = createPositionFromBackRankKey(raw);
    setState(initial);
    setInitialState(initial);
    setSelected(null);
    setLegalMoves(generateLegalMoves(initial));
    setLog(createGameLog(`game-${Date.now()}`, initial, Date.now()));
    setGameStatus('active');
    setPreviewTopology(null);
    setLastMove(null);
    setFormationLocked(true);
    setLockedFormationKey(raw);
    setFormationInputMode(false);
    setFormationInputValue('');

    // New play session => new live snapshot id.
    liveSavedGameIdRef.current = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function cancelFormationInput() {
    setFormationInputMode(false);
    setFormationInputValue('');
  }

  const tileBase = boardSize / 8;

  function checkKingCaptured(nextState: BoardState): boolean {
    const whiteKing = findKing(nextState, 'white');
    const blackKing = findKing(nextState, 'black');
    if (!whiteKing) {
      setGameStatus('king_captured_black_wins');
      return true;
    }
    if (!blackKing) {
      setGameStatus('king_captured_white_wins');
      return true;
    }
    return false;
  }

  // Moves playable given a spin + already-used slots: a piece type is still
  // available if at least one slot of that type hasn't been consumed yet.
  function playableRouletteMoves(
    boardState: BoardState,
    allowed: PieceType[],
    used: number[],
  ): Move[] {
    const remaining = allowed.filter((_, idx) => !used.includes(idx));
    if (remaining.length === 0) return [];
    return generatePseudoLegalMoves(boardState).filter((m) => {
      if (!m.from) return false;
      const p = boardState.pieces[m.from];
      return Boolean(p && remaining.includes(p.type));
    });
  }

  // Pick the index of the slot this mover-type consumes. Prefers the first
  // unused slot of that exact type.
  function consumeSlotIndex(
    allowed: PieceType[],
    used: number[],
    moverType: PieceType,
  ): number {
    return allowed.findIndex(
      (type, idx) => type === moverType && !used.includes(idx),
    );
  }

  function handleSpinRoulette() {
    if (gameMode !== 'roulette') return;
    if (gameStatus !== 'active') return;
    if (allowedPieceTypes !== null) return;

    setIsRouletteSpinning(true);
    setTimeout(() => {
      // Roll only from pieces the current player actually has on the board.
      const activeTypes = getActivePieceTypes(state, state.sideToMove);
      const rolled = spinRoulette(activeTypes);
      const pseudo = generatePseudoLegalMoves(state);
      const playable = pseudo.filter((m) => {
        if (!m.from) return false;
        const p = state.pieces[m.from];
        return p && rolled.includes(p.type);
      });

      // Auto-pass only if the player has NO way to act — no piece move AND
      // rotation is blocked (back-to-back guard). If they can rotate they
      // should get a chance to spend their action on the rotation.
      const canRotate = !state.lastMoveWasRotation;
      if (playable.length === 0 && !canRotate) {
        const next = applyPassMove(state);
        setState(next);
        setAllowedPieceTypes(null);
        setSelected(null);
        setIsRouletteSpinning(false);
        setLastMove(null);
        setLegalMoves(generateLegalMoves(next));
        setRouletteActionsLeft(0);
        setUsedRouletteSlots([]);
      } else {
        setAllowedPieceTypes(rolled);
        setIsRouletteSpinning(false);
        setRouletteActionsLeft(ROULETTE_MAX_ACTIONS);
        setUsedRouletteSlots([]);
        // Board highlights expect `legalMoves`; swap in the roulette-filtered
        // set so target squares (teal) show up for the allowed pieces.
        setLegalMoves(playable);
      }
    }, 400);
  }

  function checkGameOver(nextState: BoardState, lastMoveWasRotation: boolean = false) {
    if (gameMode === 'roulette') {
      checkKingCaptured(nextState);
      return;
    }
    // #region agent log
    const lm = generateLegalMoves(nextState);
    const inChk = isCheckmate(nextState, lastMoveWasRotation);
    const inStale = isStalemate(nextState, lastMoveWasRotation);
    const kingSq = findKing(nextState, nextState.sideToMove);
    if (
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1')
    ) {
      fetch('http://127.0.0.1:7519/ingest/37bd3e22-11f2-45c3-b325-8dbcf69a5172',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'389750'},body:JSON.stringify({sessionId:'389750',location:'App.tsx:checkGameOver',message:'checkGameOver called',data:{sideToMove:nextState.sideToMove,topology:nextState.topologyState,legalMoveCount:lm.length,isCheckmate:inChk,isStalemate:inStale,kingSq,pieceCount:Object.keys(nextState.pieces).length},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    }
    // #endregion
    if (isCheckmate(nextState, lastMoveWasRotation)) {
      setGameStatus('checkmate');
      return;
    }
    const draw = checkDrawConditions(nextState, lastMoveWasRotation);
    if (draw === 'stalemate') setGameStatus('draw_stalemate');
    else if (draw === 'insufficient_material') setGameStatus('draw_material');
    else if (draw === 'threefold_repetition') setGameStatus('draw_repetition');
    else if (draw === 'fifty_move_rule') setGameStatus('draw_50move');
  }

  function startNewGame() {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    const newSeed = Date.now();
    const initial =
      formationLocked && lockedFormationKey
        ? createPositionFromBackRankKey(lockedFormationKey)
        : createStartingPosition(newSeed);
    setSeed(newSeed);
    setState(initial);
    setInitialState(initial);
    setSelected(null);
    setLegalMoves(generateLegalMoves(initial));
    setLog(createGameLog(`game-${newSeed}`, initial, newSeed));
    savedForLogIdRef.current = null;
    setGameStatus('active');
    setPreviewTopology(null);
    setLastMove(null);
    setAllowedPieceTypes(null);
    setIsRouletteSpinning(false);
    setRouletteActionsLeft(0);
    setUsedRouletteSlots([]);

    // New play session => new live snapshot id.
    liveSavedGameIdRef.current = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function toggleFormationLock() {
    setFormationLocked((v) => {
      if (!v) setLockedFormationKey(backRankString(initialState));
      else setLockedFormationKey(null);
      return !v;
    });
  }

  function handleRotate() {
    if (gameStatus !== 'active') return;
    if (currentPlayer !== 'human') return;
    if (state.lastMoveWasRotation) return;

    const toggled = toggleTopology(state);

    // Classic mode: king-safety check; rotation consumes the whole turn.
    if (gameMode !== 'roulette') {
      const ourKing = findKing(toggled, state.sideToMove);
      if (!ourKing) return;
      const opponent = state.sideToMove === 'white' ? 'black' : 'white';
      if (isSquareAttacked(toggled, ourKing, opponent as 'white' | 'black', toggled.topologyState)) return;

      const next = applyRotationMove(state);
      setState(next);
      setLegalMoves(generateLegalMoves(next));
      setSelected(null);
      setPreviewTopology(null);

      const toggleMove: Move = { kind: 'topologyToggle' };
      const toggleSan = computeSAN(state, toggleMove);
      setLog((prev) => appendMove(prev, toggleMove, toggleSan, state.topologyState));
      setLastMove(null);
      checkGameOver(next, true);
      return;
    }

    // Roulette mode: rotation costs exactly 1 Action Point.
    // - Must have spun (allowedPieceTypes !== null) and have at least 1 action.
    // - usedRouletteSlots is NOT modified (rotation doesn't consume a slot).
    if (allowedPieceTypes === null || rouletteActionsLeft < 1) return;

    const rotated = applyRotationMove(state); // sideToMove flipped, lastMoveWasRotation=true
    const toggleMove: Move = { kind: 'topologyToggle' };
    const toggleSan = computeSAN(state, toggleMove);
    setLog((prev) => appendMove(prev, toggleMove, toggleSan, state.topologyState));
    setLastMove(null);
    setSelected(null);
    setPreviewTopology(null);

    const actionsAfter = rouletteActionsLeft - 1;

    if (actionsAfter === 0) {
      // Last action: accept the side flip, end the turn.
      setState(rotated);
      setAllowedPieceTypes(null);
      setIsRouletteSpinning(false);
      setRouletteActionsLeft(0);
      setUsedRouletteSlots([]);
      setLegalMoves(generateLegalMoves(rotated));
      checkGameOver(rotated, true);
      return;
    }

    // First action: keep the turn. Clamp sideToMove back to the current player
    // and refresh legalMoves for the new topology (usedRouletteSlots intact).
    const clamped: BoardState = { ...rotated, sideToMove: state.sideToMove };
    const nextPlayable = playableRouletteMoves(
      clamped,
      allowedPieceTypes,
      usedRouletteSlots,
    );
    // We cannot rotate again this turn (lastMoveWasRotation=true). If there's
    // also no piece move available, the remaining action can't be used — end
    // the turn to keep the game flowing.
    if (nextPlayable.length === 0) {
      setState(rotated);
      setAllowedPieceTypes(null);
      setIsRouletteSpinning(false);
      setRouletteActionsLeft(0);
      setUsedRouletteSlots([]);
      setLegalMoves(generateLegalMoves(rotated));
      checkGameOver(rotated, true);
      return;
    }

    setState(clamped);
    setRouletteActionsLeft(actionsAfter);
    setLegalMoves(nextPlayable);
    // allowedPieceTypes and usedRouletteSlots unchanged — rotation doesn't
    // consume a specific slot.
    checkGameOver(clamped, true);
  }

  const currentPlayer = state.sideToMove === 'white' ? 'human' : 'ai';

  // Mode can only be switched before the first move — otherwise rules would
  // change mid-game (e.g. switching out of Roulette skips a spin).
  const modeToggleLocked = log.moves.length > 0 || state.fullmoveNumber > 1;

  // --- Roulette AI helpers (state-driven; each is ONE atomic state transition).

  // Pick the best AI move from a set of allowed moves.
  // Priority: (a) king capture, (b) highest-value capture, (c) random fallback.
  function pickAiRouletteMove(bs: BoardState, playable: Move[]): Move {
    const enemy: Color = bs.sideToMove === 'white' ? 'black' : 'white';
    const enemyKingSq = findKing(bs, enemy);
    if (enemyKingSq) {
      const kingCap = playable.find((m) => m.to === enemyKingSq);
      if (kingCap) return kingCap;
    }
    const scored = playable
      .map((m) => {
        const victim = m.to ? bs.pieces[m.to] : undefined;
        return { m, score: victim ? PIECE_VALUE[victim.type] : 0 };
      })
      .sort((a, b) => b.score - a.score);
    if (scored[0] && scored[0].score > 0) return scored[0].m;
    return playable[Math.floor(Math.random() * playable.length)];
  }

  // Apply the AI's spin. Sets allowedPieceTypes, seeds actions / slots, and
  // exits — the main effect picks up Phase 2 on the next render.
  function applyAiSpin(bs: BoardState) {
    const activeTypes = getActivePieceTypes(bs, bs.sideToMove);
    const rolled = spinRoulette(activeTypes);
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
      setLegalMoves(generateLegalMoves(rotated));
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
      setLegalMoves(generateLegalMoves(rotated));
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
      setLegalMoves(generateLegalMoves(passed));
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
      setLegalMoves(generateLegalMoves(afterMove));
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
        const move = await SubutaiAgent.chooseMove(boardState, moves, {
          lastMoveWasRotation,
        });
        if (!move) return;
        if (move.kind === 'topologyToggle' && boardState.lastMoveWasRotation) {
          console.warn('[rotation guard] AI returned rotation when not allowed — ignoring');
          return;
        }

        const next =
          move.kind === 'topologyToggle'
            ? applyRotationMove(boardState)
            : applyMove(boardState, move);

        setState(next);
        const nextMoves = generateLegalMoves(next);
        // #region agent log
        if (
          typeof window !== 'undefined' &&
          (window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1')
        ) {
          fetch('http://127.0.0.1:7519/ingest/37bd3e22-11f2-45c3-b325-8dbcf69a5172',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'389750'},body:JSON.stringify({sessionId:'389750',location:'App.tsx:scheduleAiMove',message:'AI moved, human legal moves computed',data:{aiMove:{kind:move.kind,from:move.from,to:move.to},topology:next.topologyState,humanLegalMoves:nextMoves.length,humanMoveSample:nextMoves.slice(0,8).map(m=>({from:m.from,to:m.to,kind:m.kind})),humanSide:next.sideToMove},timestamp:Date.now(),hypothesisId:'H1,H2'})}).catch(()=>{});
        }
        // #endregion
        setLegalMoves(nextMoves);
        setSelected(null);
        const aiSan = computeSAN(boardState, move);
        setLog((prev) => appendMove(prev, move, aiSan, boardState.topologyState));
        setLastMove(
          move.kind === 'topologyToggle'
            ? null
            : { from: move.from, to: move.to },
        );
        checkGameOver(next, move.kind === 'topologyToggle');
      }, 650);
    },
    [],
  );

  const lastMoveWasRotation =
    log.moves.length > 0 &&
    log.moves[log.moves.length - 1]?.move.kind === 'topologyToggle';

  const materialBreakdown = useMemo(() => {
    const pieceOrder: PieceType[] = ['queen', 'rook', 'bishop', 'knight', 'pawn'];
    const white: Record<PieceType, number> = {
      queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0, king: 0,
    };
    const black: Record<PieceType, number> = {
      queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0, king: 0,
    };
    let whiteTotal = 0;
    let blackTotal = 0;
    for (const piece of Object.values(state.pieces)) {
      if (!piece) continue;
      const v = PIECE_VALUE[piece.type];
      if (piece.color === 'white') {
        white[piece.type]++;
        whiteTotal += v;
      } else {
        black[piece.type]++;
        blackTotal += v;
      }
    }
    const startCount: Record<PieceType, number> = {
      queen: 1, rook: 2, bishop: 2, knight: 2, pawn: 8, king: 1,
    };
    const capturedByWhite: { type: PieceType; count: number; value: number }[] = [];
    const capturedByBlack: { type: PieceType; count: number; value: number }[] = [];
    let capturedByWhiteTotal = 0;
    let capturedByBlackTotal = 0;
    for (const type of pieceOrder) {
      const goneFromBlack = Math.max(0, startCount[type] - black[type]);
      if (goneFromBlack > 0) {
        const value = goneFromBlack * PIECE_VALUE[type];
        capturedByWhite.push({ type, count: goneFromBlack, value });
        capturedByWhiteTotal += value;
      }
      const goneFromWhite = Math.max(0, startCount[type] - white[type]);
      if (goneFromWhite > 0) {
        const value = goneFromWhite * PIECE_VALUE[type];
        capturedByBlack.push({ type, count: goneFromWhite, value });
        capturedByBlackTotal += value;
      }
    }
    return {
      score: whiteTotal - blackTotal,
      capturedByWhite,
      capturedByBlack,
      capturedByWhiteTotal,
      capturedByBlackTotal,
      whiteTotal,
      blackTotal,
    };
  }, [state.pieces]);

  const materialScore = materialBreakdown.score;

  useEffect(() => {
    if (gameStatus !== 'active') return;
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
      // Phase 1 — spin after a short pause so the UI can settle.
      const t = setTimeout(() => {
        applyAiSpin(state);
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
        executeAiRouletteAction(
          state,
          allowedPieceTypes,
          usedRouletteSlots,
          rouletteActionsLeft,
        );
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
    lastMoveWasRotation,
  ]);

  const highlightedTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    const targets = new Set<string>();
    for (const move of legalMoves) {
      if (move.from !== selected) continue;
      if (move.to) targets.add(move.to);
      // Chess960: clicking the own rook also triggers castling, so the rook
      // square is a valid interaction target for a selected king.
      if (move.kind === 'castle' && move.castleRookFrom) {
        targets.add(move.castleRookFrom);
      }
    }
    return targets;
  }, [legalMoves, selected]);

  const checkSquares = useMemo(() => {
    const empty = { king: null as string | null, checkers: new Set<string>() };
    if (previewTopology && previewTopology !== state.topologyState) {
      const toggled = toggleTopology(state);
      const viewState: BoardState = { ...toggled, sideToMove: state.sideToMove };
      const king = findKing(viewState, state.sideToMove);
      if (!king) return empty;
      const opp = state.sideToMove === 'white' ? 'black' as const : 'white' as const;
      if (!isSquareAttacked(viewState, king, opp, viewState.topologyState)) return empty;
      return { king, checkers: new Set<string>(findCheckingPieces(viewState)) };
    }
    if (!isInCheck(state)) return empty;
    const king = findKing(state, state.sideToMove);
    const checkers = new Set<string>(findCheckingPieces(state));
    return { king, checkers };
  }, [previewTopology, state]);

  const displayTopology =
    previewLocked && lockedPreviewTopology
      ? lockedPreviewTopology
      : (previewTopology ?? state.topologyState);

  const threatenedSquares = useMemo(() => {
    if (!showThreats) return new Map<string, number>();
    const opp: Color = state.sideToMove === 'white' ? 'black' : 'white';
    const analyzeState: BoardState = { ...state, topologyState: displayTopology };
    const counts = new Map<string, number>();
    for (const sq of allSquares) {
      const c = countAttackers(analyzeState, sq, opp, displayTopology);
      if (c > 0) counts.set(sq, c);
    }
    return counts;
  }, [showThreats, state, displayTopology]);

  const supportPairs = useMemo((): [SquareId, SquareId][] => {
    if (!showSupport) return [];
    const ourColor: Color = 'white';
    const pairs: [SquareId, SquareId][] = [];
    for (const to of allSquares) {
      const piece = state.pieces[to];
      if (!piece || piece.color !== ourColor) continue;
      const attackers = getAttackerSquares(state, to, ourColor, displayTopology);
      for (const from of attackers) {
        if (from !== to) pairs.push([from, to]);
      }
    }
    return pairs;
  }, [showSupport, state, displayTopology]);

  const threateningPieceSquares = useMemo(() => {
    if (!showThreats || !hoveredSquare || !threatenedSquares.has(hoveredSquare)) return new Set<string>();
    const opp: Color = state.sideToMove === 'white' ? 'black' : 'white';
    const attackers = getAttackerSquares(state, hoveredSquare as SquareId, opp, displayTopology);
    return new Set(attackers);
  }, [showThreats, hoveredSquare, threatenedSquares, state, displayTopology]);

  const hoverSupporters = useMemo((): SquareId[] => {
    if (!showSupport || !selected || !hoveredSquare) return [];
    return getAttackerSquares(state, hoveredSquare as SquareId, 'white', displayTopology);
  }, [showSupport, selected, hoveredSquare, state, displayTopology]);

  function onSquareClick(square: string) {
    if (gameStatus !== 'active') return;
    if (currentPlayer !== 'human') return;

    // In roulette mode the board is locked until a roll has happened.
    if (gameMode === 'roulette' && allowedPieceTypes === null) return;

    // In roulette mode, each sub-move needs an action point.
    if (gameMode === 'roulette' && rouletteActionsLeft <= 0) return;

    // Active move pool differs per mode: roulette uses pseudo-legal (king
    // safety disabled) filtered to *unused* slot types.
    const remainingTypes: PieceType[] =
      gameMode === 'roulette'
        ? allowedPieceTypes!.filter((_, idx) => !usedRouletteSlots.includes(idx))
        : [];
    const activeMoves: Move[] =
      gameMode === 'roulette'
        ? generatePseudoLegalMoves(state).filter((m) => {
            if (!m.from) return false;
            const p = state.pieces[m.from];
            return Boolean(p && remainingTypes.includes(p.type));
          })
        : legalMoves;

    if (!selected) {
      if (gameMode === 'roulette') {
        const p = state.pieces[square as SquareId];
        if (!p || p.color !== state.sideToMove) return;
        if (!remainingTypes.includes(p.type)) return;
      }
      setSelected(square);
      return;
    }
    if (selected === square) {
      setSelected(null);
      return;
    }
    let move = activeMoves.find(
      (m) => m.from === selected && m.to === square,
    );
    if (!move) {
      move = activeMoves.find(
        (m) =>
          m.from === selected &&
          m.kind === 'castle' &&
          m.castleRookFrom === square,
      );
    }
    if (!move) {
      if (gameMode === 'roulette') {
        const p = state.pieces[square as SquareId];
        if (!p || p.color !== state.sideToMove) return;
        if (!remainingTypes.includes(p.type)) return;
      }
      setSelected(square);
      return;
    }
    // Promotion picker (classic only — in roulette we auto-queen to keep the
    // multi-action flow uninterrupted).
    if (move.kind === 'promotion' && move.from && move.to && gameMode !== 'roulette') {
      setPendingPromotion({ from: move.from, to: move.to });
      return;
    }
    const resolvedMove: Move =
      gameMode === 'roulette' && move.kind === 'promotion' && !move.promotion
        ? { ...move, promotion: 'queen' }
        : move;

    const san = computeSAN(state, resolvedMove);
    const moverType = state.pieces[resolvedMove.from!]!.type;
    const afterMove = applyMove(state, resolvedMove);
    setLog((prev) => appendMove(prev, resolvedMove, san, state.topologyState));
    setLastMove({ from: resolvedMove.from, to: resolvedMove.to });

    if (gameMode !== 'roulette') {
      setState(afterMove);
      setLegalMoves(generateLegalMoves(afterMove));
      setSelected(null);
      checkGameOver(afterMove);
      return;
    }

    // --- Roulette mode: decide whether the turn continues or ends.
    const slotIdx = consumeSlotIndex(allowedPieceTypes!, usedRouletteSlots, moverType);
    const newUsed = slotIdx >= 0 ? [...usedRouletteSlots, slotIdx] : usedRouletteSlots;
    const actionsAfter = rouletteActionsLeft - 1;

    // If a king was just captured, end the game regardless of remaining actions.
    const kingCaptured =
      !findKing(afterMove, 'white') || !findKing(afterMove, 'black');

    let stayOnTurn = false;
    let nextPlayable: Move[] = [];
    if (!kingCaptured && actionsAfter > 0) {
      // Clamp sideToMove back so the same player continues — we still evaluate
      // remaining-slot playability against that clamped state.
      const clamped: BoardState = { ...afterMove, sideToMove: state.sideToMove };
      nextPlayable = playableRouletteMoves(clamped, allowedPieceTypes!, newUsed);
      // Stay on turn if piece moves exist OR rotation is still available
      // (the human may want to spend the remaining action on rotating).
      stayOnTurn = nextPlayable.length > 0 || !clamped.lastMoveWasRotation;
    }

    if (stayOnTurn) {
      const clamped: BoardState = { ...afterMove, sideToMove: state.sideToMove };
      setState(clamped);
      setUsedRouletteSlots(newUsed);
      setRouletteActionsLeft(actionsAfter);
      setLegalMoves(nextPlayable);
      setSelected(null);
    } else {
      // End of turn: accept the side-flip from applyMove, clear roulette state.
      setState(afterMove);
      setUsedRouletteSlots([]);
      setRouletteActionsLeft(0);
      setAllowedPieceTypes(null);
      setLegalMoves(generateLegalMoves(afterMove));
      setSelected(null);
    }
    checkGameOver(afterMove);
  }

  function handlePromotion(pieceType: PieceType) {
    if (!pendingPromotion) return;
    const move = legalMoves.find(
      (m) =>
        m.from === pendingPromotion.from &&
        m.to === pendingPromotion.to &&
        m.kind === 'promotion' &&
        m.promotion === pieceType,
    );
    if (!move) return;
    const san = computeSAN(state, move);
    const next = applyMove(state, move);
    setState(next);
    const nextMoves = generateLegalMoves(next);
    setLegalMoves(nextMoves);
    setSelected(null);
    setPendingPromotion(null);
    setLog((prev) => appendMove(prev, move, san, state.topologyState));
    setLastMove({ from: move.from, to: move.to });
    checkGameOver(next);
  }

  const squares = useMemo(() => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    return ranks.flatMap((rank) =>
      files.map((file) => `${file}${rank}`),
    );
  }, []);

  const canRotate = useMemo(() => {
    if (currentPlayer !== 'human') return false;
    if (state.lastMoveWasRotation) return false; // back-to-back guard

    if (gameMode === 'roulette') {
      // Rotation costs 1 action point — needs an active spin AND >= 1 action.
      // King-safety check is intentionally bypassed (kill-the-king rules).
      return allowedPieceTypes !== null && rouletteActionsLeft >= 1;
    }

    // Classic: standard king-safety self-check.
    const toggled = toggleTopology(state);
    const king = findKing(toggled, state.sideToMove);
    if (!king) return false;
    const opp = state.sideToMove === 'white' ? 'black' : 'white';
    return !isSquareAttacked(toggled, king, opp as 'white' | 'black', toggled.topologyState);
  }, [currentPlayer, state, gameMode, allowedPieceTypes, rouletteActionsLeft]);

  const layout = useMemo(
    () => computeBoardLayout(displayTopology, boardSize),
    [displayTopology, boardSize],
  );

  const scale = layout.tileSize / tileBase;

  const positionLabel = backRankString(initialState);

  function resumeGame(game: SavedGame) {
    const initial = createPositionFromBackRankKey(game.config960);
    let current: BoardState = initial;
    let nextLog: GameLog = createGameLog(`resume-${Date.now()}`, initial, Date.now());

    for (const entry of game.moves) {
      const mv = entry.move;
      if (mv.kind === 'topologyToggle') {
        current = applyRotationMove(current);
        nextLog = appendMove(nextLog, mv, undefined, entry.topology);
        continue;
      }
      if (!mv.from || !mv.to) continue;
      current = applyMove(current, mv);
      nextLog = appendMove(nextLog, mv, undefined, entry.topology);
    }

    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    setState(current);
    setInitialState(initial);
    setSelected(null);
    setLegalMoves(generateLegalMoves(current));
    setLog(nextLog);
    setGameStatus('active');
    setPreviewTopology(null);
    setLastMove(null);
    setFormationLocked(true);
    setLockedFormationKey(game.config960);
    savedForLogIdRef.current = null;
    liveSavedGameIdRef.current = game.id;
  }

  function importReplayFromNotation() {
    try {
      const parsed = parseMemoryNotation(replayText);
      const initial = createPositionFromBackRankKey(parsed.config960);
      let current: BoardState = initial;
      let replayLog: GameLog = createGameLog(`replay-${Date.now()}`, initial, Date.now());

      for (const token of parsed.moves) {
        const mv = token.move;

        // Auto-switch topology if @B/@A suffix requires it
        if (token.requiredTopology && current.topologyState !== token.requiredTopology) {
          const topoBefore = current.topologyState;
          const toggleSan = computeSAN(current, { kind: 'topologyToggle' });
          current = applyRotationMove(current);
          replayLog = appendMove(replayLog, { kind: 'topologyToggle' }, toggleSan, topoBefore);
        }

        if (mv.kind === 'topologyToggle') {
          const topoBefore = current.topologyState;
          const san = computeSAN(current, mv);
          current = applyRotationMove(current);
          replayLog = appendMove(replayLog, mv, san, topoBefore);
        } else if (mv.kind === 'castle') {
          // Resolve castle from legal moves
          const legal = generateLegalMoves(current);
          const targetFile = token.castleSide === 'queen' ? 'c' : 'g';
          const castleMove = legal.find(
            (m) => m.kind === 'castle' && m.to && m.to[0] === targetFile,
          );
          if (!castleMove) {
            throw new NotationParseError('No legal castle move available at this position.');
          }
          const topoBefore = current.topologyState;
          const san = computeSAN(current, castleMove);
          current = applyMove(current, castleMove);
          replayLog = appendMove(replayLog, castleMove, san, topoBefore);
        } else if (mv.from && mv.to) {
          if (!current.pieces[mv.from]) {
            throw new NotationParseError(`Illegal move: no piece on ${mv.from}.`);
          }
          // Match against legal moves to get correct kind (capture vs normal)
          const legal = generateLegalMoves(current);
          const matched = legal.find(
            (m) =>
              m.from === mv.from &&
              m.to === mv.to &&
              (!mv.promotion || m.promotion === mv.promotion),
          ) ?? mv;
          const topoBefore = current.topologyState;
          const san = computeSAN(current, matched);
          current = applyMove(current, matched);
          replayLog = appendMove(replayLog, matched, san, topoBefore);
        }
      }

      const id = `replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const snapshot = buildSavedGameSnapshot(replayLog, id);
      (localStorageAdapter.saveOrUpdateGame?.(snapshot) ?? localStorageAdapter.saveGame(snapshot));

      // Load into the board as an unfinished game so it can be continued.
      liveSavedGameIdRef.current = id;
      setFormationLocked(true);
      setLockedFormationKey(parsed.config960);
      setInitialState(initial);
      setState(current);
      setSelected(null);
      setLegalMoves(generateLegalMoves(current));
      setLog(replayLog);
      setGameStatus('active');
      setPreviewTopology(null);
      setLastMove(null);
      savedForLogIdRef.current = null;

      setReplayError(null);
      setShowReplayDialog(false);
      setReplayText('');
    } catch (e) {
      if (e instanceof NotationParseError) {
        setReplayError(e.message);
      } else {
        setReplayError('Could not parse replay log.');
      }
    }
  }

  // Notation string for copy
  const notationString = useMemo(() => {
    const lines: string[] = [
      `[Chess960 "${positionLabel}"]`,
      `[Seed "${seed}"]`,
      '',
    ];
    const entries = log.moves;
    for (let i = 0; i < entries.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const white = entries[i];
      const black = entries[i + 1];

      function fmt(entry: typeof white): string {
        let san = entry.san;
        if (!san) {
          if (entry.move.kind === 'topologyToggle') {
            const from = entry.topology ?? 'A';
            return `${from}\u2192${from === 'A' ? 'B' : 'A'}`;
          }
          if (entry.move.kind === 'castle') {
            san = entry.move.to && entry.move.to[0] === 'c' ? 'O-O-O' : 'O-O';
          } else {
            san = `${entry.move.from}\u2192${entry.move.to}`;
            if (entry.move.kind === 'promotion' && entry.move.promotion) {
              const pl: Record<string, string> = { queen: 'Q', rook: 'R', bishop: 'B', knight: 'N' };
              san += `=${pl[entry.move.promotion] ?? ''}`;
            }
          }
        }
        if (entry.move.kind !== 'topologyToggle' && entry.topology === 'B') {
          if (!san.includes('@')) san += '@B';
        }
        return san;
      }

      let line = `${moveNum}. ${fmt(white)}`;
      if (black) line += `  ${fmt(black)}`;
      lines.push(line);
    }
    return lines.join('\n');
  }, [log.moves, positionLabel, seed]);

  function copyNotation() {
    navigator.clipboard.writeText(notationString).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const gameOverMessage = useMemo(() => {
    if (gameStatus === 'checkmate') {
      const winner = state.sideToMove === 'white' ? 'Black' : 'White';
      return `Checkmate \u2014 ${winner} wins!`;
    }
    if (gameStatus === 'draw_stalemate') {
      return 'Draw \u2014 Stalemate';
    }
    if (gameStatus === 'draw_material') {
      return 'Draw \u2014 Insufficient material';
    }
    if (gameStatus === 'draw_repetition') {
      return 'Draw \u2014 Threefold repetition';
    }
    if (gameStatus === 'draw_50move') {
      return 'Draw \u2014 50-move rule';
    }
    if (gameStatus === 'king_captured_white_wins') {
      return 'King captured \u2014 White wins!';
    }
    if (gameStatus === 'king_captured_black_wins') {
      return 'King captured \u2014 Black wins!';
    }
    return null;
  }, [gameStatus, state.sideToMove]);

  return (
    <div className="app-root" style={{ '--board-size': `${boardSize}px` } as React.CSSProperties}>
      <header className="app-header">
        <h1>subutai</h1>
        <div className="mode-toggle">
          <button
            type="button"
            className={`mode-btn${gameMode === 'classic' ? ' mode-btn-active' : ''}`}
            disabled={modeToggleLocked}
            title={modeToggleLocked ? 'Finish or restart the game to change modes' : 'Classic chess rules'}
            onClick={() => {
              if (gameMode === 'classic') return;
              setGameMode('classic');
              setAllowedPieceTypes(null);
              setIsRouletteSpinning(false);
              setRouletteActionsLeft(0);
              setUsedRouletteSlots([]);
            }}
          >
            Classic
          </button>
          <button
            type="button"
            className={`mode-btn${gameMode === 'roulette' ? ' mode-btn-active' : ''}`}
            disabled={modeToggleLocked}
            title={modeToggleLocked ? 'Finish or restart the game to change modes' : 'Kill the king — spin the roulette each turn'}
            onClick={() => {
              if (gameMode === 'roulette') return;
              setGameMode('roulette');
              setAllowedPieceTypes(null);
              setIsRouletteSpinning(false);
              setRouletteActionsLeft(0);
              setUsedRouletteSlots([]);
            }}
          >
            Roulette
          </button>
        </div>
      </header>

      {gameMode === 'roulette' && gameStatus === 'active' && (
        <div className="roulette-panel">
          <div className="roulette-display">
            {allowedPieceTypes ? (
              allowedPieceTypes.map((t, i) => {
                const isUsed = usedRouletteSlots.includes(i);
                return (
                  <span
                    key={i}
                    className={`roulette-face roulette-face-${t}${isUsed ? ' slot-used' : ''}`}
                  >
                    <span className={`piece piece-${state.sideToMove}`}>
                      {glyphForPiece(state.sideToMove, t)}
                    </span>
                  </span>
                );
              })
            ) : isRouletteSpinning ? (
              Array.from({ length: ROULETTE_SLOT_COUNT }, (_, i) => (
                <span key={i} className="roulette-face roulette-face-rolling">?</span>
              ))
            ) : (
              <span className="roulette-label">
                {currentPlayer === 'human'
                  ? 'Your turn — spin the roulette'
                  : 'AI is about to spin...'}
              </span>
            )}
          </div>

          {allowedPieceTypes && (
            <div className="roulette-actions" aria-label="Actions remaining">
              <span className="roulette-actions-label">Actions:</span>
              {Array.from({ length: ROULETTE_MAX_ACTIONS }, (_, i) => (
                <span
                  key={i}
                  className={`roulette-action-dot${i < rouletteActionsLeft ? ' active' : ' spent'}`}
                />
              ))}
            </div>
          )}

          <button
            type="button"
            className="roulette-spin-btn"
            onClick={handleSpinRoulette}
            disabled={
              allowedPieceTypes !== null ||
              isRouletteSpinning ||
              currentPlayer !== 'human'
            }
          >
            Spin Roulette
          </button>
        </div>
      )}

      <div
        className={`board${previewTopology || previewLocked ? ' previewing' : ''}`}
        style={{ width: boardSize, height: boardSize }}
      >
        {squares.map((sq) => {
          const piece = state.pieces[sq as SquareId];
          const isDark =
            ((sq.charCodeAt(0) - 'a'.charCodeAt(0)) +
              (Number(sq[1]) - 1)) %
            2 ===
            1;
          const isSelected = selected === sq;
          const isTarget = highlightedTargets.has(sq);
          const isLastFrom = lastMove?.from === sq;
          const isLastTo = lastMove?.to === sq;
          const isCheckedKing = checkSquares.king === sq;
          const isCheckingPiece = checkSquares.checkers.has(sq);
          const threatCount = threatenedSquares.get(sq) ?? 0;
          const isThreateningPiece = threateningPieceSquares.has(sq);

          const { cx, cy, angle } = tilePixelCenter(
            sq as SquareId,
            displayTopology,
            layout,
          );

          const tx = cx - tileBase / 2;
          const ty = cy - tileBase / 2;

          return (
            <button
              key={sq}
              type="button"
              className={[
                'tile',
                isDark ? 'dark' : 'light',
                isSelected ? 'selected' : '',
                isTarget ? 'target' : '',
                isLastFrom ? 'last-from' : '',
                isLastTo ? 'last-to' : '',
                isCheckedKing ? (gameStatus === 'checkmate' ? 'mated-king' : 'checked-king') : '',
                isCheckingPiece ? (gameStatus === 'checkmate' ? 'mating-piece' : 'checking-piece') : '',
                threatCount > 0 ? 'threatened' : '',
                isThreateningPiece ? 'threatening-piece' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                width: tileBase,
                height: tileBase,
                transform: `translate(${tx}px, ${ty}px) rotate(${angle}deg) scale(${scale})`,
                ...(threatCount > 0 ? { '--threat-n': threatCount } as React.CSSProperties : {}),
              }}
              onClick={() => onSquareClick(sq)}
              onMouseEnter={() => setHoveredSquare(sq)}
              onMouseLeave={() => setHoveredSquare(null)}
            >
              {piece ? (
                <span
                  className={[
                    'piece',
                    piece.color === 'white'
                      ? 'piece-white'
                      : 'piece-black',
                  ].join(' ')}
                  style={angle ? { transform: `rotate(${-angle}deg)` } : undefined}
                >
                  {glyphForPiece(piece.color, piece.type)}
                </span>
              ) : null}
            </button>
          );
        })}
        {showSupport && (
          <svg
            className="support-overlay"
            width={boardSize}
            height={boardSize}
            style={{ pointerEvents: 'none' }}
          >
            <defs>
              <marker
                id="support-arrowhead"
                markerWidth="4"
                markerHeight="2.5"
                refX="3.5"
                refY="1.25"
                orient="auto"
              >
                <path
                  d="M 0 0 L 3.5 1.25 L 0 2.5"
                  fill="none"
                  stroke="var(--support-stroke, #14b8a6)"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </marker>
              <marker
                id="support-arrowhead-orange"
                markerWidth="4"
                markerHeight="2.5"
                refX="3.5"
                refY="1.25"
                orient="auto"
              >
                <path
                  d="M 0 0 L 3.5 1.25 L 0 2.5"
                  fill="none"
                  stroke="var(--support-hover-stroke, #ea580c)"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </marker>
            </defs>
            {supportPairs.map(([from, to], i) => {
              const fromCenter = tilePixelCenter(from, displayTopology, layout);
              const toCenter = tilePixelCenter(to, displayTopology, layout);
              const dx = toCenter.cx - fromCenter.cx;
              const dy = toCenter.cy - fromCenter.cy;
              const dist = Math.hypot(dx, dy) || 1;
              const inset = tileBase * 0.4;
              const endX = toCenter.cx - (dx / dist) * inset;
              const endY = toCenter.cy - (dy / dist) * inset;
              return (
                <line
                  key={`${from}-${to}-${i}`}
                  x1={fromCenter.cx}
                  y1={fromCenter.cy}
                  x2={endX}
                  y2={endY}
                  className="support-arrow"
                  markerEnd="url(#support-arrowhead)"
                />
              );
            })}
            {hoveredSquare && hoverSupporters.map((fromSq) => {
              const toSq = hoveredSquare as SquareId;
              const fromCenter = tilePixelCenter(fromSq, displayTopology, layout);
              const toCenter = tilePixelCenter(toSq, displayTopology, layout);
              const dx = toCenter.cx - fromCenter.cx;
              const dy = toCenter.cy - fromCenter.cy;
              const dist = Math.hypot(dx, dy) || 1;
              const inset = tileBase * 0.4;
              const endX = toCenter.cx - (dx / dist) * inset;
              const endY = toCenter.cy - (dy / dist) * inset;
              return (
                <line
                  key={`hover-${fromSq}-${toSq}`}
                  x1={fromCenter.cx}
                  y1={fromCenter.cy}
                  x2={endX}
                  y2={endY}
                  className="support-arrow support-arrow-hover"
                  markerEnd="url(#support-arrowhead-orange)"
                />
              );
            })}
          </svg>
        )}
      </div>

      {pendingPromotion && (
        <div className="promotion-backdrop" onClick={() => setPendingPromotion(null)}>
          <div className="promotion-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="promotion-title">Promote pawn to:</div>
            <div className="promotion-options">
              {(['queen', 'rook', 'bishop', 'knight'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className="promotion-option"
                  onClick={() => handlePromotion(type)}
                  title={type}
                >
                  <span className="piece piece-white">
                    {glyphForPiece('white', type)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {gameOverMessage && (
        <div className="game-over-banner">{gameOverMessage}</div>
      )}

      <div className="board-actions">
        <div className="action-group action-group-reset-lock">
          <button
            type="button"
            className="action-btn"
            onClick={startNewGame}
            title="New game"
          >
            {'\u21BB'}
          </button>
          <button
            type="button"
            className={`action-btn${formationLocked ? ' active' : ''}`}
            onClick={toggleFormationLock}
            title={formationLocked ? 'Unlock formation (new games will be random)' : 'Lock formation (new game keeps this 960)'}
          >
            {'\u{1F512}'}
          </button>
        </div>

        <div className="action-group action-group-center">
          <div className="action-group action-group-support-threat">
            <button
              type="button"
              className={`action-btn${showSupport ? ' active' : ''}`}
              title="Toggle support map (who backs up whom)"
              onClick={() => setShowSupport((v) => !v)}
            >
              {'\u27A1'}
            </button>
            <button
              type="button"
              className={`action-btn${showThreats ? ' active' : ''}`}
              title="Toggle threat map"
              onClick={() => setShowThreats((v) => !v)}
            >
              {'\u26A0'}
            </button>
          </div>
          <button
            type="button"
            className={`action-btn preview-btn${previewLocked ? ' active' : ''}`}
            title={previewLocked ? 'Unlock rotation preview' : 'Preview rotation (click to lock)'}
            disabled={currentPlayer !== 'human'}
            onClick={() => {
              if (currentPlayer !== 'human') return;
              if (previewLocked) {
                setPreviewLocked(false);
                setLockedPreviewTopology(null);
              } else {
                setPreviewLocked(true);
                setLockedPreviewTopology(state.topologyState === 'A' ? 'B' : 'A');
              }
            }}
            onPointerEnter={() => {
              if (currentPlayer === 'human' && !previewLocked) {
                setPreviewTopology(state.topologyState === 'A' ? 'B' : 'A');
              }
            }}
            onPointerLeave={() => {
              if (!previewLocked) setPreviewTopology(null);
            }}
          >
            {'\u{1F441}'}
          </button>
          <button
            type="button"
            className="rotate-btn"
            onClick={handleRotate}
            disabled={!canRotate}
          >
            Rotate &middot; {state.topologyState === 'A' ? 'A \u2192 B' : 'B \u2192 A'}
          </button>
        </div>
        <div
          className="material-score-wrap"
          onMouseEnter={() => setShowMaterialPopup(true)}
          onMouseLeave={() => setShowMaterialPopup(false)}
        >
          <span
            className={`material-score ${materialScore > 0 ? 'positive' : materialScore < 0 ? 'negative' : 'zero'}`}
          >
            {materialScore > 0 ? '+' : ''}
            {(materialScore / 100).toFixed(1)}
          </span>
          {showMaterialPopup && (
            <div className="material-score-popup" role="tooltip">
              <div className="material-captured-section">
                <div className="material-captured-label">Captured by White</div>
                {materialBreakdown.capturedByWhite.length === 0 ? (
                  <div className="material-captured-list">—</div>
                ) : (
                  <div className="material-captured-list">
                    {materialBreakdown.capturedByWhite
                      .map(({ type, count, value }) => {
                        const label = type === 'knight' ? 'N' : type[0].toUpperCase();
                        return `${label}×${count} (${(value / 100).toFixed(1)})`;
                      })
                      .join(', ')}
                    <span className="material-captured-total">
                      {' → '}{(materialBreakdown.capturedByWhiteTotal / 100).toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
              <div className="material-captured-section">
                <div className="material-captured-label">Captured by Black</div>
                {materialBreakdown.capturedByBlack.length === 0 ? (
                  <div className="material-captured-list">—</div>
                ) : (
                  <div className="material-captured-list">
                    {materialBreakdown.capturedByBlack
                      .map(({ type, count, value }) => {
                        const label = type === 'knight' ? 'N' : type[0].toUpperCase();
                        return `${label}×${count} (${(value / 100).toFixed(1)})`;
                      })
                      .join(', ')}
                    <span className="material-captured-total">
                      {' → '}{(materialBreakdown.capturedByBlackTotal / 100).toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          className="action-btn"
          onClick={() => setShowHelp(true)}
          title="Rules & info"
        >
          ?
        </button>
      </div>

      <div className="position-label-wrap">
        <button
          type="button"
          className="position-replay-btn"
          onClick={() => {
            setReplayError(null);
            setShowReplayDialog(true);
          }}
          title="Paste a move log to replay"
        >
          Replay
        </button>
        <span className="position-label">Chess960: {positionLabel}</span>
        {!formationInputMode ? (
          <button
            type="button"
            className="position-edit-btn"
            onDoubleClick={() => {
              setFormationInputValue(positionLabel);
              setFormationInputMode(true);
            }}
            title="Double-click to enter formation code"
          >
            edit
          </button>
        ) : (
          <span className="position-input-wrap">
            <input
              ref={formationInputRef}
              type="text"
              className="position-input"
              value={formationInputValue}
              onChange={(e) => setFormationInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFormationCode();
                if (e.key === 'Escape') cancelFormationInput();
              }}
              onBlur={applyFormationCode}
              placeholder="e.g. RQKRNBBN"
              maxLength={8}
            />
            {formationInputValue && !isValidChess960Key(formationInputValue.trim().toUpperCase()) && (
              <span className="position-input-error">Invalid 960 code</span>
            )}
          </span>
        )}
      </div>

      {showReplayDialog && (
        <div className="help-backdrop" onClick={() => setShowReplayDialog(false)}>
          <div className="help-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Replay from log</h2>
            <p>Paste a move log in the same format as “Copy to clipboard”.</p>
            <textarea
              className="replay-textarea"
              value={replayText}
              onChange={(e) => setReplayText(e.target.value)}
              placeholder='[Chess960 "RQKRNBBN"]\n[Seed "123"]\n\n1. e2→e4  e7→e5\n2. A→B  g8→f6\n...'
              rows={10}
            />
            {replayError && <div className="replay-error">{replayError}</div>}
            <div className="replay-actions">
              <button type="button" className="help-close-btn" onClick={importReplayFromNotation}>
                Load replay
              </button>
              <button
                type="button"
                className="help-close-btn"
                onClick={() => setShowReplayDialog(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <details className="move-log-details">
        <summary>Moves ({log.moves.length})</summary>
        <div className="move-log-content">
          <pre className="move-log-text">{notationString}</pre>
          <button type="button" className="copy-btn" onClick={copyNotation}>
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
        </div>
      </details>

      <MemoryPanel
        onGameActivate={(g) => {
          if (g.status === 'incomplete') resumeGame(g);
        }}
      />

      {showHelp && (
        <div className="help-backdrop" onClick={() => setShowHelp(false)}>
          <div className="help-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Subutai &mdash; Auxetic Chess960</h2>
            <p>
              Subutai combines <strong>Chess960</strong> (Fischer random chess) with an
              <strong> <a href="https://www.youtube.com/shorts/RLO48ETn6LE" target="_blank"> auxetic board</a></strong> that can rotate between two stable states.
            </p>
            <p><strong>How it works:</strong></p>
            <ul>
              <li>The board is divided into 4&times;4 blocks of 2&times;2 squares.</li>
              <li>Pressing <em>Rotate</em> flips all blocks &plusmn;90&deg;, reshuffling
                which squares are adjacent. This <strong>costs your turn</strong>.</li>
              <li>Hover the eye button to preview the rotation; <strong>click</strong> the eye to
                temporarily lock the rotated view for inspection (click again to unlock). This is not the move.</li>
              <li><em>Support map</em> (arrow button): shows which of your pieces are backed up by others (arrows from supporter to supported).</li>
              <li><em>Threat map</em> (warning button): tints squares the opponent attacks. Hover a threatened square to highlight the threatening pieces.</li>
              <li>The starting position is a random Chess960 arrangement.</li>
              <li>Standard chess rules apply: you cannot move into check, checkmate ends the game.</li>
            </ul>
            <p>
              <a href="https://en.wikipedia.org/wiki/Fischer_random_chess" target="_blank" rel="noopener noreferrer">
                Chess960 on Wikipedia
              </a>
            </p>
            <button type="button" className="help-close-btn" onClick={() => setShowHelp(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function glyphForPiece(color: string, type: string): string {
  const map: Record<string, string> = {
    'white-pawn': '\u265F\uFE0E',
    'white-knight': '\u265E',
    'white-bishop': '\u265D',
    'white-rook': '\u265C',
    'white-queen': '\u265B',
    'white-king': '\u265A',
    'black-pawn': '\u265F\uFE0E',
    'black-knight': '\u265E',
    'black-bishop': '\u265D',
    'black-rook': '\u265C',
    'black-queen': '\u265B',
    'black-king': '\u265A',
  };
  return map[`${color}-${type}`] ?? '';
}

export default App;
