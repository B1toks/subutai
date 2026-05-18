import './App.css';
import type { BoardState, Color, Move, PieceType, SquareId, TopologyState } from './engine';
import { createStartingPosition, createPositionFromBackRankKey, isValidChess960Key } from './engine';
import { allSquares } from './engine/board';
import {
  applyMove,
  generateLegalMoves,
  generatePseudoLegalMoves,
  isCheckmate,
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
import { evaluate, PIECE_VALUE } from './ai/evaluate';
import { searchPosition, ttClear } from './ai/search';
import { type MoveClass, type MoveAnalysis } from './analysis/classify';
import { classifyAsync } from './analysis/classifyClient';
import { GameReview } from './components/GameReview';
import { NamePicker } from './components/NamePicker';
import { GameSummary } from './components/GameSummary';
import { ConfirmDialog } from './components/ConfirmDialog';
import { FeedbackModal } from './components/FeedbackModal';
import { MilestoneModal } from './components/MilestoneModal';
import { AutoPlayView } from './components/AutoPlayView';
import { StatsPage } from './components/StatsPage';
import { FriendLobby } from './components/FriendLobby';
import type { GameReviewMeta } from './components/GameReview';
import { useMultiplayerSync } from './components/MultiplayerGameView';
import type { MatchDoc, MatchOutcome } from './firebase/matches';
import {
  saveMultiplayerGameToGames,
  translateOutcomeForPlayer,
} from './firebase/multiplayerGames';
import { saveTrainingGame } from './firebase/trainingGames';
import { useAuth } from './firebase/useAuth';
import {
  saveCompletedGame,
  getPersonalBest,
  fetchSavedGame,
  deserializeGameLog,
} from './firebase/games';
import { Leaderboard } from './components/Leaderboard';
import { computeGamePoints, type GameOutcome, type GamePoints } from './analysis/points';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameLog } from './recording/log';
import {
  appendMove,
  attachSearchScoreToLastMove,
  computeSAN,
  createGameLog,
  updateMoveAnalysisAt,
} from './recording/log';
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

function spinRoulette(
  activeTypes: PieceType[],
  pawnBoost: boolean = false,
): PieceType[] {
  if (activeTypes.length === 0) return [];
  // Pawn-bias for the first 3 spins of a game (Stage O): we add 'pawn' to the
  // pool one extra time, lifting its per-slot probability from 1/n to 2/(n+1)
  // — roughly a +50-65% boost depending on how many piece types remain.
  const pool: PieceType[] =
    pawnBoost && activeTypes.includes('pawn')
      ? [...activeTypes, 'pawn']
      : activeTypes;
  const out: PieceType[] = [];
  for (let i = 0; i < ROULETTE_SLOT_COUNT; i++) {
    out.push(pool[Math.floor(Math.random() * pool.length)]);
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

const MOVE_CLASS_MARKER: Record<MoveClass, string> = {
  best: ' ⭐',
  good: '',
  mistake: '?',
  blunder: '??',
  brilliant: '!!',
  checkmate: '#',
};

// White-perspective static eval. evaluate() returns the score for sideToMove,
// so we negate when it's Black's turn — this way + always means White is ahead.
function evaluateFromWhite(state: BoardState): number {
  const raw = evaluate(state);
  return state.sideToMove === 'white' ? raw : -raw;
}

// Map a White-perspective centipawn score to a pair of HSL colors that drive
// the linear-gradient. tanh squashes extreme positions into [-1, 1] so the
// gradient eases off rather than running away on crushing material wins.
function evalToColors(evalCp: number): { c1: string; c2: string } {
  const t = Math.tanh(evalCp / 400);
  if (t > 0.1) {
    const i = Math.min(t, 1);
    return {
      c1: `hsl(45, ${30 + 30 * i}%, ${15 + 5 * i}%)`,
      c2: `hsl(35, ${20 + 20 * i}%, ${8 + 3 * i}%)`,
    };
  }
  if (t < -0.1) {
    const i = Math.min(-t, 1);
    return {
      c1: `hsl(355, ${25 + 35 * i}%, ${12 + 4 * i}%)`,
      c2: `hsl(345, ${20 + 25 * i}%, ${6 + 3 * i}%)`,
    };
  }
  return { c1: '#2a2520', c2: '#1a1612' };
}

const HUMAN_COLOR: Color = 'white';

/** Reshape a live MatchDoc into the GameLog the single-player render code
 *  already knows how to consume. The stored move shape happens to be a
 *  superset of LoggedMove (analysis is absent in MP). */
function deriveMpLog(live: MatchDoc): GameLog {
  return {
    id: `mp-${live.code}`,
    createdAt: new Date().toISOString(),
    randomSeed: live.seed,
    initialTopology: live.log.initialTopology,
    initialState: createPositionFromBackRankKey(live.chess960Id),
    moves: live.log.moves.map((m) => ({
      san: m.san,
      move: m.move,
      topology: m.topology,
      timestamp: m.timestamp,
    })),
  };
}

function deriveMpLastMove(
  live: MatchDoc,
): { from?: SquareId; to?: SquareId } | null {
  const last = live.log.moves[live.log.moves.length - 1]?.move;
  if (!last || last.kind === 'topologyToggle') return null;
  return { from: last.from, to: last.to };
}
const WATCH_AUTOPLAY_MS = 1500;
// Auto-mode tuning. We skip the move classifier (expensive worker round-trip)
// and use a small inter-move delay so a 60-ply game finishes in ~30s.
const AUTO_MOVE_DELAY_MS = 50;
const AUTO_BETWEEN_GAMES_MS = 600;
const AUTO_WATCHDOG_MS = 60_000;
// Shallow search used to label each auto-mode position for training data.
// ~100ms × ~80 plies ≈ +8s per game on top of the move-generation cost.
const AUTO_SEARCH_LABEL_BUDGET_MS = 100;
const AUTO_SEARCH_LABEL_DEPTH = 4;
// Bumped per release so /training_games docs can be filtered by engine
// version when we later use them for training data.
const AI_VERSION = 'stage-j';

interface WatchingGame {
  log: GameLog;
  playerName: string;
  gameId: string;
  currentMoveIdx: number;
  autoplay: boolean;
}

interface GameBackup {
  seed: number;
  state: BoardState;
  initialState: BoardState;
  legalMoves: Move[];
  log: GameLog;
  gameStatus: GameStatus;
  lastMove: { from?: SquareId; to?: SquareId } | null;
  liveSavedGameId: string;
  savedForLogId: string | null;
  completedLogId: string | null;
  searchEvalFromWhite: number | null;
  searchMateInPlies: number | null;
  formationLocked: boolean;
  lockedFormationKey: string | null;
}

function App() {
  // Self-play / training data collection mode: ?auto=1 in the URL puts both
  // sides under AI control, hides the regular UI, and writes finished games
  // to /training_games. URL-derived so it survives reloads but can be exited
  // by clicking Stop (which navigates back to the no-param URL).
  const isAutoMode = useMemo(
    () => new URLSearchParams(window.location.search).get('auto') === '1',
    [],
  );
  const maxGames = useMemo(() => {
    const m = new URLSearchParams(window.location.search).get('max');
    if (!m) return 0;
    const n = parseInt(m, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, []);
  // Internal monitoring page for the /training_games collection. URL-only so
  // it never shows up in the regular navigation UI.
  const isStatsMode = useMemo(
    () => new URLSearchParams(window.location.search).get('stats') === '1',
    [],
  );
  // T2: ?game=<id> loads a saved /games doc into the Review screen on
  // mount, so a copied share-link opens directly into playback.
  const sharedGameId = useMemo(
    () => new URLSearchParams(window.location.search).get('game'),
    [],
  );

  const [autoGamesCompleted, setAutoGamesCompleted] = useState(0);
  const [autoLastOutcome, setAutoLastOutcome] = useState<GameOutcome | null>(null);
  // Rolling history of full-move counts so the panel can show an average.
  const [autoMoveHistory, setAutoMoveHistory] = useState<number[]>([]);
  const [autoStopped, setAutoStopped] = useState(false);
  const [autoStoppedReason, setAutoStoppedReason] = useState<string | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNextGameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoLastMoveAtRef = useRef<number>(Date.now());
  // Each completed game-id is processed exactly once by the auto-save effect.
  const autoSavedLogIdRef = useRef<string | null>(null);

  const { user, displayName, loading: authLoading, setDisplayName } = useAuth();
  const [showNameModal, setShowNameModal] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [lastGamePoints, setLastGamePoints] = useState<GamePoints | null>(null);
  // Stage P addendum 7: captured at finishGame so the GameSummary modal
  // keeps the previous game's duration even after Play Again resets the
  // running start-time ref.
  const [lastGameDurationMs, setLastGameDurationMs] = useState<number | null>(
    null,
  );
  const [gameOutcome, setGameOutcome] = useState<GameOutcome | null>(null);
  const [confirmingResign, setConfirmingResign] = useState(false);
  const [savingGame, setSavingGame] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [currentRank, setCurrentRank] = useState<number | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [personalBest, setPersonalBest] = useState<number | null>(null);
  const [lastGameId, setLastGameId] = useState<string | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [milestoneShown, setMilestoneShown] = useState(false);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const completedLogIdRef = useRef<string | null>(null);
  const [view, setView] = useState<
    'game' | 'review' | 'leaderboard' | 'friend-lobby'
  >('game');
  // Stage Q.A: opponent selector in the header. 'ai' keeps the existing
  // solo flow; 'friend' opens the PvP lobby. Once a match starts it just
  // overlays the existing 'game' view — the board/log/header reuse the
  // single-player UI, only the data source flips.
  const [opponentMode, setOpponentMode] = useState<'ai' | 'friend'>('ai');
  // Q.B.2: active PvP match handshake. When non-null, the rest of App
  // sources its board / log / turn state from useMultiplayerSync below
  // instead of the local engine.
  const [activeMatch, setActiveMatch] = useState<MatchDoc | null>(null);
  // Match-completion modal state (separate from the AI GameSummary which
  // is points-driven and doesn't fit the PvP shape).
  const [mpEndOutcome, setMpEndOutcome] = useState<MatchOutcome | null>(null);
  const mpSavedGameIdRef = useRef<string | null>(null);
  const mpWroteOutcomeRef = useRef<string | null>(null);
  // T2: review can be entered for the LIVE game (default — reads the `log`
  // alias) OR with a snapshot loaded via the MP completion modal or the
  // ?game=<id> URL. activeReviewLog overrides when set; meta gives the
  // review header context ("Alex vs AI", "won/lost/drew").
  const [activeReviewLog, setActiveReviewLog] = useState<GameLog | null>(null);
  const [activeReviewMeta, setActiveReviewMeta] =
    useState<GameReviewMeta | null>(null);
  const [sharedGameError, setSharedGameError] = useState<string | null>(null);
  // Q.B.2: PvP sync. Hook is always called (with null match before any
  // game starts) so React's hook-order rules are respected. Returns null
  // when no match — every consumer guards on isMultiplayer below.
  const mpSync = useMultiplayerSync(
    activeMatch,
    user?.uid ?? null,
    () => {
      // Doc was deleted out from under us — drop back to lobby.
      setActiveMatch(null);
      setMpEndOutcome(null);
      mpSavedGameIdRef.current = null;
      mpWroteOutcomeRef.current = null;
      setView('friend-lobby');
    },
  );
  const isMultiplayer = mpSync !== null;
  const [watchingGame, setWatchingGame] = useState<WatchingGame | null>(null);
  const watchAutoplayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameBackupRef = useRef<GameBackup | null>(null);
  const [seed, setSeed] = useState<number>(1);
  // Local single-player engine state. In multiplayer (Q.B.2) the rest of
  // App reads through the `state` / `legalMoves` / `log` / `lastMove`
  // const aliases below, which swap to mpSync-derived values; the local
  // setters keep firing for safety but their writes are visually inert
  // because the aliases ignore them.
  const [stateLocal, setState] = useState<BoardState>(() => createStartingPosition(1));
  const [initialState, setInitialState] = useState<BoardState>(() => createStartingPosition(1));
  const [selected, setSelected] = useState<string | null>(null);
  const [legalMovesLocal, setLegalMoves] = useState<Move[]>(() =>
    generateLegalMoves(createStartingPosition(1)),
  );
  const [logLocal, setLog] = useState<GameLog>(() =>
    createGameLog('game-1', createStartingPosition(1), 1),
  );
  const [gameStatus, setGameStatus] = useState<GameStatus>('active');
  const [previewTopology, setPreviewTopology] = useState<TopologyState | null>(null);
  const [lastMoveLocal, setLastMove] = useState<{ from?: SquareId; to?: SquareId } | null>(null);
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
  const [gameModeLocal, setGameMode] = useState<GameMode>('classic');
  // PvP gameMode flows from the match doc — host picks it at create time.
  // Q.D.2: reuse the SAME solo roulette UI/logic by aliasing gameMode,
  // allowedPieceTypes, rouletteActionsLeft, etc. through to MP-derived
  // values. Single-player still drives those from local state below.
  const gameMode: GameMode = isMultiplayer
    ? mpSync?.isRouletteMode
      ? 'roulette'
      : 'classic'
    : gameModeLocal;
  const [allowedPieceTypesLocal, setAllowedPieceTypes] = useState<PieceType[] | null>(null);
  const [isRouletteSpinning, setIsRouletteSpinning] = useState<boolean>(false);
  const [rouletteActionsLeftLocal, setRouletteActionsLeft] = useState<number>(0);
  const [usedRouletteSlotsLocal, setUsedRouletteSlots] = useState<number[]>([]);
  // First roulette spin per game requires a manual click on the Spin
  // Roulette button. Subsequent spins auto-fire via a useEffect after a
  // short delay. Tracking just the boolean is enough — no pending-callback
  // state, no banner: the existing button stays the single spin UI.
  const [firstRouletteSpinDoneLocal, setFirstRouletteSpinDone] = useState(false);
  // First 3 spins of a game weight pawn slightly higher so beginners ease in
  // with familiar piece moves instead of front-loaded knight chaos.
  const [rouletteSpinCountLocal, setRouletteSpinCount] = useState(0);
  // Stage T1: square that just had a pawn taken via en passant — paints a
  // brief explosion overlay so the off-target capture is visually obvious.
  const [enPassantExplosionSquare, setEnPassantExplosionSquare] =
    useState<SquareId | null>(null);

  // -------- Q.B.2: read-side aliases for multiplayer mode -----------------
  // When isMultiplayer the board / log / legal-moves come from the live
  // Firestore doc via mpSync. Writers (setState/setLog/...) still target
  // local state — they're effectively dead writes in MP because the
  // aliases below ignore them, and every write path is guarded by
  // isMultiplayer anyway.
  // Q.D.3: in MP roulette an action mid-turn flips boardState.sideToMove
  // (the engine doesn't know we're keeping the same player on the clock
  // for a second action). Solo solves this by clamping; here we clamp at
  // alias time so generateLegalMoves below produces MY pieces' moves
  // for action 2 instead of the opponent's.
  const state: BoardState = (() => {
    if (!isMultiplayer) return stateLocal;
    const base = mpSync!.boardState;
    if (
      mpSync!.isRouletteMode &&
      mpSync!.isMyTurn &&
      mpSync!.rouletteActionsLeft > 0 &&
      base.sideToMove !== mpSync!.myColor
    ) {
      return { ...base, sideToMove: mpSync!.myColor };
    }
    return base;
  })();
  const log: GameLog = isMultiplayer
    ? deriveMpLog(mpSync!.matchState)
    : logLocal;
  const legalMoves: Move[] = isMultiplayer
    ? generateLegalMoves(state)
    : legalMovesLocal;
  const lastMove: { from?: SquareId; to?: SquareId } | null = isMultiplayer
    ? deriveMpLastMove(mpSync!.matchState)
    : lastMoveLocal;
  // Q.D.3: roulette state aliases for MP. The live match doc carries the
  // full 4-slot bag, action counter, and used-slot indices — so the same
  // solo UI (Spin button, slot chips, "Move a knight" hint) renders
  // verbatim in PvP roulette without any new components.
  const allowedPieceTypes: PieceType[] | null =
    isMultiplayer && mpSync?.isRouletteMode
      ? mpSync.rouletteSlots
      : allowedPieceTypesLocal;
  const rouletteActionsLeft: number =
    isMultiplayer && mpSync?.isRouletteMode
      ? mpSync.rouletteActionsLeft
      : rouletteActionsLeftLocal;
  const usedRouletteSlots: number[] =
    isMultiplayer && mpSync?.isRouletteMode
      ? mpSync.usedRouletteSlots
      : usedRouletteSlotsLocal;
  // Per-player gate: solo uses a local boolean reset in startNewGame; MP
  // reads my spin count off the match doc so both players track
  // independently across reloads.
  const firstRouletteSpinDone: boolean =
    isMultiplayer && mpSync && user
      ? (mpSync.matchState.rouletteSpinsByPlayer?.[user.uid] ?? 0) > 0
      : firstRouletteSpinDoneLocal;
  const rouletteSpinCount: number =
    isMultiplayer && mpSync?.isRouletteMode
      ? mpSync.matchState.rouletteSpinCount ?? 0
      : rouletteSpinCountLocal;
  const formationInputRef = useRef<HTMLInputElement>(null);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stage P addendum 7: wall-clock when the current game began. Used to
  // compute durationMs on save. Set in startNewGame (and on initial mount
  // for the first game).
  const gameStartedAtRef = useRef<number>(Date.now());
  const savedForLogIdRef = useRef<string | null>(null);
  const liveSavedGameIdRef = useRef<string>(
    `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  // --- Dynamic evaluation + background --------------------------------------
  // Search-backed eval (White-perspective, centipawns) gets pushed in by the
  // classifier after every move. While null (start-of-game / fresh reset)
  // we fall back to the static evaluator so the bar isn't blank.
  const [searchEvalFromWhite, setSearchEvalFromWhite] = useState<number | null>(null);
  // Set when the search found a forced mate from the post-move position.
  const [searchMateInPlies, setSearchMateInPlies] = useState<number | null>(null);
  // currentEval is the canonical WHITE-perspective centipawn score. The
  // engine, classifier, prev-eval delta tracking and any future
  // server-side persistence all want this monotonic shape.
  const currentEval = useMemo(() => {
    if (isMultiplayer) return evaluateFromWhite(state);
    if (searchEvalFromWhite !== null) return searchEvalFromWhite;
    return evaluateFromWhite(state);
  }, [isMultiplayer, searchEvalFromWhite, state]);

  // T5: viewer-perspective eval — positive = "I'm winning". Drives the
  // background gradient AND the eval-bar fill so the player who's behind
  // sees a cool/crimson room and a near-empty bar, while their opponent
  // simultaneously sees gold + a near-full bar. Single-player path is
  // myColor='white' so this is a no-op there.
  const myColor: 'white' | 'black' =
    isMultiplayer && mpSync ? mpSync.myColor : 'white';
  const myPerspectiveEval = useMemo(
    () => (myColor === 'black' ? -currentEval : currentEval),
    [currentEval, myColor],
  );
  // Previous eval — kept for delta comparisons used by the classifier.
  const prevEvalRef = useRef<number>(currentEval);
  // The element whose CSS variables drive the gradient. Setting via ref
  // (rather than inline style) so React doesn't churn the style object every
  // render and break the @property transition.
  const shellRef = useRef<HTMLDivElement>(null);
  // Worker-backed classify can resolve AFTER subsequent moves have been
  // played — we read this ref in each .then() to decide whether the analysis
  // is still "current" (visuals fire) or stale (log patched, visuals skipped).
  const logLengthRef = useRef<number>(0);

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
    if (isMultiplayer) return; // PvP games persist via /games, not local Memory
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
    if (isMultiplayer) return; // no local Memory snapshots during PvP
    if (gameStatus !== 'active') return;
    if (log.moves.length === 0) return;
    const liveId = liveSavedGameIdRef.current;
    if (!liveId) return;
    const snapshot = buildSavedGameSnapshot(log, liveId);
    (localStorageAdapter.saveOrUpdateGame?.(snapshot) ?? localStorageAdapter.saveGame(snapshot));
  }, [gameStatus, log, isMultiplayer]);

  // Game-completion pipeline: detects terminal gameStatus transitions, computes
  // points, opens the GameSummary modal, and kicks the async Firestore save.
  // The ref guards against double-fires (StrictMode + deps that move together).
  // Auto mode handles completion via its own effect — never enters this path.
  useEffect(() => {
    if (isAutoMode) return;
    if (isMultiplayer) return; // MP completion runs through a separate effect
    if (gameStatus === 'active') return;
    if (log.moves.length === 0) return;
    if (completedLogIdRef.current === log.id) return;
    // Resign sets gameOutcome before flipping status — don't overwrite it.
    if (gameOutcome) return;
    completedLogIdRef.current = log.id;

    let outcome: GameOutcome;
    if (gameStatus === 'checkmate') {
      outcome = state.sideToMove === HUMAN_COLOR ? 'ai-win' : 'human-win';
    } else if (gameStatus === 'king_captured_black_wins') {
      // Black wins => human (white) lost.
      outcome = 'ai-win';
    } else if (gameStatus === 'king_captured_white_wins') {
      outcome = 'human-win';
    } else {
      outcome = 'draw';
    }
    void finishGame(outcome);
    // finishGame closes over current state/log/user/displayName; we want this
    // to fire once per terminal transition, hence the ref-guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStatus, log.id, log.moves.length, isAutoMode]);

  // ---- Q.B.2 multiplayer: terminal detection + host /games save ----------
  // Runs whenever the live match changes. If the board reached mate/draw,
  // first peer to notice writes the outcome (transaction-guarded). When
  // status flips to completed, the host saves a /games doc once.
  useEffect(() => {
    if (!isMultiplayer || !mpSync) return;
    const match = mpSync.matchState;
    if (match.status !== 'active') return;
    if (match.outcome) return;
    if (mpWroteOutcomeRef.current === match.code) return;
    const board = mpSync.boardState;
    let outcome: MatchOutcome | null = null;
    if (isCheckmate(board)) {
      outcome = board.sideToMove === 'white' ? 'black-win' : 'white-win';
    } else if (checkDrawConditions(board) !== null) {
      outcome = 'draw';
    }
    if (!outcome) return;
    mpWroteOutcomeRef.current = match.code;
    void mpSync.writeOutcomeIfFirst(outcome);
  }, [isMultiplayer, mpSync]);

  useEffect(() => {
    if (!isMultiplayer || !mpSync) return;
    const match = mpSync.matchState;
    if (match.status !== 'completed' || !match.outcome) return;
    // Show local completion modal exactly once per terminal transition.
    if (mpEndOutcome !== match.outcome) {
      setMpEndOutcome(match.outcome);
    }
    // Host-only /games write — guarded by code so retries are idempotent.
    if (mpSync.isHost && mpSavedGameIdRef.current !== match.code) {
      mpSavedGameIdRef.current = match.code;
      void saveMultiplayerGameToGames(match).catch((err) => {
        console.error('[mp] save to /games failed', err);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiplayer, mpSync?.matchState.status, mpSync?.matchState.outcome]);

  // T2: load a shared game on mount when ?game=<id> is in the URL. Bypasses
  // every game/match flow — drops directly into the Review screen with
  // metadata derived from the doc. Shared games are read-only; the back
  // button strips the param so a refresh returns to the normal app.
  useEffect(() => {
    if (!sharedGameId) return;
    let cancelled = false;
    void fetchSavedGame(sharedGameId)
      .then((saved) => {
        if (cancelled || !saved) {
          if (!cancelled) setSharedGameError('Game not found.');
          return;
        }
        const loadedLog = deserializeGameLog(saved);
        const playerLabel = saved.playerName || 'Player';
        const opponentLabel = saved.vsAI
          ? 'AI'
          : ((saved as unknown as { opponentName?: string }).opponentName ??
            'Opponent');
        setActiveReviewLog(loadedLog);
        setActiveReviewMeta({
          playerName: playerLabel,
          opponentName: opponentLabel,
          outcome: saved.outcome,
        });
        setView('review');
      })
      .catch((err) => {
        console.error('[shared-game] fetch failed', err);
        if (!cancelled) setSharedGameError('Could not load shared game.');
      });
    return () => {
      cancelled = true;
    };
  }, [sharedGameId]);

  async function finishGame(outcome: GameOutcome) {
    const points = computeGamePoints(log, outcome, HUMAN_COLOR, gameMode);
    const durationMs = Date.now() - gameStartedAtRef.current;
    setGameOutcome(outcome);
    setLastGamePoints(points);
    setLastGameDurationMs(durationMs);
    setSummaryOpen(true);
    setSaveError(null);
    setIsNewBest(false);
    setCurrentRank(null);

    if (!user || !displayName) {
      // Not signed in / no name yet — show summary locally and skip Firestore.
      return;
    }

    setSavingGame(true);
    try {
      // Snapshot the pre-write best so the modal can show "old" alongside new.
      const oldBest = await getPersonalBest(user.uid, gameMode);
      setPersonalBest(oldBest);

      const { gameId, isNewBest: nb, newRank } = await saveCompletedGame({
        uid: user.uid,
        displayName,
        log,
        outcome,
        points,
        chess960Id: positionLabel,
        seed,
        humanColor: HUMAN_COLOR,
        gameMode,
        durationMs,
      });
      setLastGameId(gameId);
      setIsNewBest(nb);
      setCurrentRank(newRank);
      if (nb) setPersonalBest(points.total);
    } catch (err) {
      console.error('[finishGame] save failed', err);
      setSaveError('Could not save this game. Check your connection.');
    } finally {
      setSavingGame(false);
    }
  }

  // Auto-mode completion: when a self-play game ends, save to
  // /training_games (separate collection from the human leaderboard) and
  // queue the next game. Bypasses the regular finishGame path entirely.
  useEffect(() => {
    if (!isAutoMode) return;
    if (autoStopped) return;
    if (gameStatus === 'active') return;
    if (log.moves.length === 0) return;
    if (autoSavedLogIdRef.current === log.id) return;
    autoSavedLogIdRef.current = log.id;

    let outcome: GameOutcome;
    if (gameStatus === 'checkmate') {
      // The side now to move was just checkmated. White=human alias gives us
      // a "human-win"/"ai-win" mapping consistent with the rest of the codebase.
      outcome = state.sideToMove === HUMAN_COLOR ? 'ai-win' : 'human-win';
    } else if (gameStatus === 'king_captured_black_wins') {
      outcome = 'ai-win';
    } else if (gameStatus === 'king_captured_white_wins') {
      outcome = 'human-win';
    } else {
      outcome = 'draw';
    }
    const moveCount = Math.floor(log.moves.length / 2);
    const finalEvalFromWhite =
      state.sideToMove === 'white' ? evaluate(state) : -evaluate(state);

    setAutoLastOutcome(outcome);
    setAutoGamesCompleted((n) => n + 1);
    setAutoMoveHistory((prev) => {
      const next = [...prev, moveCount];
      // Keep the rolling average bounded.
      return next.length > 50 ? next.slice(-50) : next;
    });

    void saveTrainingGame({
      log,
      chess960Id: backRankString(initialState),
      seed,
      outcome,
      moveCount,
      finalEvalFromWhite,
      aiVersion: AI_VERSION,
      durationMs: Date.now() - gameStartedAtRef.current,
    }).catch((err) => {
      console.error('[autoplay] saveTrainingGame failed', err);
    });

    if (autoNextGameTimerRef.current) clearTimeout(autoNextGameTimerRef.current);
    autoNextGameTimerRef.current = setTimeout(() => {
      startNewGame();
    }, AUTO_BETWEEN_GAMES_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAutoMode, autoStopped, gameStatus, log.id, log.moves.length]);

  // Capped-run stop: once the requested number of games is reached, stop
  // queuing new ones. The current game finishes saving but the loop ends.
  useEffect(() => {
    if (!isAutoMode || maxGames <= 0 || autoStopped) return;
    if (autoGamesCompleted >= maxGames) {
      setAutoStopped(true);
      setAutoStoppedReason(`Done. ${autoGamesCompleted} games completed.`);
      if (autoNextGameTimerRef.current) clearTimeout(autoNextGameTimerRef.current);
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    }
  }, [autoGamesCompleted, maxGames, isAutoMode, autoStopped]);

  // Watchdog: if no move has been made in 60s, the AI has hung (rare). Reset.
  useEffect(() => {
    if (!isAutoMode || autoStopped) return;
    const id = setInterval(() => {
      if (Date.now() - autoLastMoveAtRef.current > AUTO_WATCHDOG_MS) {
        console.warn('[autoplay] watchdog: no move in 60s, forcing new game');
        autoLastMoveAtRef.current = Date.now();
        autoSavedLogIdRef.current = null;
        startNewGame();
      }
    }, 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAutoMode, autoStopped]);

  // Clear auto timers on unmount.
  useEffect(() => {
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      if (autoNextGameTimerRef.current) clearTimeout(autoNextGameTimerRef.current);
    };
  }, []);

  function stopAuto() {
    setAutoStopped(true);
    setAutoStoppedReason('Stopped by user.');
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    if (autoNextGameTimerRef.current) clearTimeout(autoNextGameTimerRef.current);
    // Navigate back to the clean URL so a reload exits auto mode entirely.
    setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete('auto');
      url.searchParams.delete('max');
      window.location.href = url.toString();
    }, 400);
  }

  // Replay the first `moveCount` entries of a log on top of its initialState.
  // Returns the resulting BoardState — used by watching-mode to project the
  // current frame without mutating the underlying log.
  function replayBoardAt(replayLog: GameLog, moveCount: number): BoardState {
    let cur: BoardState = replayLog.initialState;
    const cap = Math.min(moveCount, replayLog.moves.length);
    for (let i = 0; i < cap; i++) {
      const mv = replayLog.moves[i].move;
      if (mv.kind === 'topologyToggle') {
        cur = applyRotationMove(cur);
      } else {
        cur = applyMove(cur, mv);
      }
    }
    return cur;
  }

  async function startWatching(gameId: string, playerName: string) {
    try {
      const saved = await fetchSavedGame(gameId);
      if (!saved) {
        console.warn('[watch] game not found', gameId);
        return;
      }
      const replayLog = deserializeGameLog(saved);

      // Snapshot current game so Stop can restore it exactly.
      gameBackupRef.current = {
        seed,
        state,
        initialState,
        legalMoves,
        log,
        gameStatus,
        lastMove,
        liveSavedGameId: liveSavedGameIdRef.current,
        savedForLogId: savedForLogIdRef.current,
        completedLogId: completedLogIdRef.current,
        searchEvalFromWhite,
        searchMateInPlies,
        formationLocked,
        lockedFormationKey,
      };

      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      if (watchAutoplayRef.current) clearTimeout(watchAutoplayRef.current);

      // Project frame 0 of the replay.
      const projected = replayBoardAt(replayLog, 0);
      setState(projected);
      setInitialState(replayLog.initialState);
      setSeed(replayLog.randomSeed);
      setLegalMoves(generateLegalMoves(projected));
      setLog({ ...replayLog, moves: [] });
      setSelected(null);
      setGameStatus('active');
      setLastMove(null);
      setPreviewTopology(null);
      setSearchEvalFromWhite(null);
      setSearchMateInPlies(null);
      // Block the completion-watcher effect from firing on this log id.
      completedLogIdRef.current = replayLog.id;

      setView('game');
      setWatchingGame({
        log: replayLog,
        playerName,
        gameId,
        currentMoveIdx: 0,
        autoplay: false,
      });
    } catch (err) {
      console.error('[watch] startWatching failed', err);
    }
  }

  function seekWatchTo(idx: number) {
    setWatchingGame((cur) => {
      if (!cur) return cur;
      const clamped = Math.max(0, Math.min(idx, cur.log.moves.length));
      const projected = replayBoardAt(cur.log, clamped);
      setState(projected);
      setLog({ ...cur.log, moves: cur.log.moves.slice(0, clamped) });
      setLegalMoves(generateLegalMoves(projected));
      setSelected(null);
      const lastEntry = clamped > 0 ? cur.log.moves[clamped - 1] : null;
      if (lastEntry && lastEntry.move.from && lastEntry.move.to) {
        setLastMove({ from: lastEntry.move.from, to: lastEntry.move.to });
      } else {
        setLastMove(null);
      }
      return { ...cur, currentMoveIdx: clamped };
    });
  }

  function toggleWatchAutoplay() {
    setWatchingGame((cur) => (cur ? { ...cur, autoplay: !cur.autoplay } : cur));
  }

  function stopWatching() {
    if (watchAutoplayRef.current) {
      clearTimeout(watchAutoplayRef.current);
      watchAutoplayRef.current = null;
    }
    const backup = gameBackupRef.current;
    setWatchingGame(null);
    if (!backup) return;

    setSeed(backup.seed);
    setState(backup.state);
    setInitialState(backup.initialState);
    setLegalMoves(backup.legalMoves);
    setLog(backup.log);
    setGameStatus(backup.gameStatus);
    setLastMove(backup.lastMove);
    setFormationLocked(backup.formationLocked);
    setLockedFormationKey(backup.lockedFormationKey);
    setSearchEvalFromWhite(backup.searchEvalFromWhite);
    setSearchMateInPlies(backup.searchMateInPlies);
    setSelected(null);
    liveSavedGameIdRef.current = backup.liveSavedGameId;
    savedForLogIdRef.current = backup.savedForLogId;
    completedLogIdRef.current = backup.completedLogId;
    gameBackupRef.current = null;
  }

  function requestResign() {
    if (watchingGame) return;
    if (isMultiplayer) {
      if (!mpSync || mpSync.matchState.status !== 'active') return;
      setConfirmingResign(true);
      return;
    }
    if (gameStatus !== 'active') return;
    if (log.moves.length === 0) return;
    setConfirmingResign(true);
  }

  function confirmResign() {
    setConfirmingResign(false);
    // PvP resign: route through the match doc so the opponent sees the
    // status flip; their listener will mirror the outcome. Local engine
    // state stays untouched (gameStatus etc.).
    if (isMultiplayer) {
      if (!mpSync) return;
      void mpSync.resign();
      return;
    }
    if (gameStatus !== 'active') return;
    // Pre-set the outcome so the gameStatus-watching effect skips this one.
    setGameOutcome('human-resign');
    setGameStatus('checkmate');
    completedLogIdRef.current = log.id;
    void finishGame('human-resign');
  }

  // Drive the gradient via CSS custom properties. setProperty (rather than
  // inline style) lets the @property-registered transition interpolate
  // colour-to-colour smoothly. prevEvalRef tracks the white-POV value
  // (classifier delta still expects white-POV).
  //
  // T5: paint from the viewer's perspective so each peer in a PvP match
  // sees their OWN winning/losing state — the player who's ahead gets
  // gold/warm, the player who's behind gets crimson/cool, simultaneously.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const { c1, c2 } = evalToColors(myPerspectiveEval);
    shell.style.setProperty('--eval-c1', c1);
    shell.style.setProperty('--eval-c2', c2);
    prevEvalRef.current = currentEval;
  }, [myPerspectiveEval, currentEval, view, activeMatch]);

  // Keep logLengthRef in sync with committed log state — used by classify
  // .then handlers to decide if their analysis is still the latest.
  useEffect(() => {
    logLengthRef.current = log.moves.length;
  }, [log.moves.length]);

  // Watching-mode autoplay: when enabled, advances one move every
  // WATCH_AUTOPLAY_MS until we hit the end of the replay.
  useEffect(() => {
    if (!watchingGame || !watchingGame.autoplay) return;
    if (watchingGame.currentMoveIdx >= watchingGame.log.moves.length) {
      // Hit the end — flip autoplay off so the play button resets to ▶.
      setWatchingGame((cur) => (cur ? { ...cur, autoplay: false } : cur));
      return;
    }
    watchAutoplayRef.current = setTimeout(() => {
      seekWatchTo(watchingGame.currentMoveIdx + 1);
    }, WATCH_AUTOPLAY_MS);
    return () => {
      if (watchAutoplayRef.current) {
        clearTimeout(watchAutoplayRef.current);
        watchAutoplayRef.current = null;
      }
    };
    // seekWatchTo is stable-ish (defined in the component body but captures
    // setState which is stable); we intentionally drive this effect off the
    // watchingGame snapshot only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchingGame?.autoplay, watchingGame?.currentMoveIdx]);

  // Brief glowing outline on the board container whenever topology flips,
  // so rotations don't feel invisible. Fires for both manual rotates and
  // Roulette-driven auto-rotations.
  const [recentRotation, setRecentRotation] = useState(false);
  const prevTopologyRef = useRef(state.topologyState);
  useEffect(() => {
    if (prevTopologyRef.current === state.topologyState) return;
    prevTopologyRef.current = state.topologyState;
    setRecentRotation(true);
    const t = setTimeout(() => setRecentRotation(false), 2500);
    return () => clearTimeout(t);
  }, [state.topologyState]);

  // 50-move milestone celebration. Fires exactly once per game the first
  // time the human has played 50 full chess moves. Skipped during replay
  // and after the game ends.
  useEffect(() => {
    if (watchingGame) return;
    if (gameStatus !== 'active') return;
    if (milestoneShown) return;
    const fullMoves = Math.floor(log.moves.length / 2);
    if (fullMoves >= 50) {
      setMilestoneShown(true);
      setShowMilestoneModal(true);
    }
  }, [log.moves.length, gameStatus, milestoneShown, watchingGame]);

  // Square to pulse-highlight after a blunder/brilliant. Cleared after the
  // animation duration (4 cycles × 600ms = 2.4s, rounded to 2500).
  const [classifiedSquare, setClassifiedSquare] = useState<{
    square: SquareId;
    classification: 'blunder' | 'brilliant';
  } | null>(null);
  const classifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push the search-backed eval from an analysis into the bar/gradient state.
  // Used by every classify callsite (live moves, AI, imported-log completion).
  const pushSearchEval = useCallback((analysis: MoveAnalysis) => {
    setSearchEvalFromWhite(analysis.searchScoreFromWhite);
    setSearchMateInPlies(analysis.isMate ? analysis.mateInPlies ?? 0 : null);
  }, []);

  const flagClassifiedSquare = useCallback(
    (square: SquareId, classification: 'blunder' | 'brilliant') => {
      if (classifyTimerRef.current) clearTimeout(classifyTimerRef.current);
      setClassifiedSquare({ square, classification });
      classifyTimerRef.current = setTimeout(() => {
        setClassifiedSquare(null);
        classifyTimerRef.current = null;
      }, 2500);
    },
    [],
  );

  // Triggers a screen flash for a classified move. Sets the colour/peak
  // opacity/transition duration as CSS variables; on the next frame, snaps
  // opacity back to 0 so the registered --flash-opacity transition fades it.
  const triggerFlash = useCallback((cls: MoveClass) => {
    const shell = shellRef.current;
    if (!shell) return;
    let color: string;
    let peak: string;
    let durationMs: number;
    if (cls === 'blunder') {
      color = 'rgb(220, 40, 40)';
      peak = '0.35';
      durationMs = 400;
    } else if (cls === 'brilliant') {
      color = 'rgb(255, 200, 80)';
      peak = '0.45';
      durationMs = 600;
    } else if (cls === 'checkmate') {
      color = 'rgb(255, 255, 255)';
      peak = '0.6';
      durationMs = 800;
    } else {
      return;
    }
    shell.style.setProperty('--flash-color', color);
    shell.style.setProperty('--flash-duration', `${durationMs}ms`);
    shell.style.setProperty('--flash-opacity', peak);
    setTimeout(() => {
      shell.style.setProperty('--flash-opacity', '0');
    }, 50);
  }, []);

  // Apply per-move visual side-effects, but only if no newer move has been
  // played since the analysis was queued. With the Worker-backed classifier
  // a response can land seconds after a subsequent move; we don't want a
  // stale flash for an old move firing while the bar should reflect a newer one.
  const applyClassifyVisuals = useCallback(
    (moveIdx: number, analysis: MoveAnalysis, moveTo: SquareId | undefined) => {
      if (logLengthRef.current !== moveIdx + 1) return;
      pushSearchEval(analysis);
      triggerFlash(analysis.classification);
      if (
        moveTo &&
        (analysis.classification === 'blunder' || analysis.classification === 'brilliant')
      ) {
        flagClassifiedSquare(moveTo, analysis.classification);
      }
    },
    [pushSearchEval, triggerFlash, flagClassifiedSquare],
  );

  /**
   * Walks an imported log forward, classifying each move asynchronously.
   * Each step is its own setTimeout(0) so the UI stays responsive between
   * ~300 ms classifies. The captured log id ensures we don't patch a
   * different game if the user starts a new one mid-classify.
   */
  const classifyImportedLog = useCallback(
    (loadedLog: GameLog) => {
      const capturedId = loadedLog.id;
      // Pre-compute all positions synchronously — cheap (no search) — so the
      // classifier can grab `stateBefore` for each move by index later.
      const states: BoardState[] = [loadedLog.initialState];
      for (const entry of loadedLog.moves) {
        const prev = states[states.length - 1];
        let next: BoardState;
        if (entry.move.kind === 'topologyToggle') {
          next = applyRotationMove(prev);
        } else if (entry.move.from && entry.move.to) {
          next = applyMove(prev, entry.move);
        } else {
          next = prev;
        }
        states.push(next);
      }
      // Only the last move's analysis feeds the bar — otherwise it would
      // pinball through 30 mid-game scores while the loading completes.
      let lastAnalysis: MoveAnalysis | null = null;
      (async () => {
        for (let i = 0; i < loadedLog.moves.length; i++) {
          const entry = loadedLog.moves[i];
          if (entry.move.kind === 'topologyToggle' || !entry.move.from || !entry.move.to) {
            continue;
          }
          const a = await classifyAsync(states[i], entry.move, states[i + 1], {
            budgetMs: 1000,
            maxDepth: 7,
          });
          setLog((prev) =>
            prev.id === capturedId ? updateMoveAnalysisAt(prev, i, a) : prev,
          );
          lastAnalysis = a;
        }
        if (lastAnalysis) pushSearchEval(lastAnalysis);
      })();
    },
    [pushSearchEval],
  );

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
    setSearchEvalFromWhite(null);
    setSearchMateInPlies(null);

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
    // Q.D.3: MP roulette routes through the hook so the 4-slot bag,
    // pawn-bias, and action allotment all sync via Firestore. Both peers
    // see the same slots as soon as the doc updates.
    if (isMultiplayer) {
      if (!mpSync || !mpSync.isMyTurn) return;
      if (mpSync.matchState.status !== 'active') return;
      if (mpSync.rouletteSlots !== null) return;
      void mpSync.spinRoulette();
      return;
    }
    if (gameStatus !== 'active') return;
    if (allowedPieceTypes !== null) return;
    // First click of the game flips the gate so the auto-spin effect can
    // take over on subsequent turns.
    if (!firstRouletteSpinDone) setFirstRouletteSpinDone(true);
    doSpinRouletteNow();
  }

  function doSpinRouletteNow() {
    setIsRouletteSpinning(true);
    setTimeout(() => {
      // Roll only from pieces the current player actually has on the board.
      const activeTypes = getActivePieceTypes(state, state.sideToMove);
      const pawnBoost = rouletteSpinCount < 3;
      const rolled = spinRoulette(activeTypes, pawnBoost);
      setRouletteSpinCount((n) => n + 1);
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
    // Reset the transposition table so positions from the previous game can't
    // bias the new search. (TT is reused across moves WITHIN one game.)
    ttClear();
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
    setFirstRouletteSpinDone(false);
    setRouletteSpinCount(0);
    setSearchEvalFromWhite(null);
    setSearchMateInPlies(null);
    setSummaryOpen(false);
    setLastGamePoints(null);
    setGameOutcome(null);
    setSavingGame(false);
    setSaveError(null);
    setCurrentRank(null);
    setIsNewBest(false);
    setPersonalBest(null);
    setLastGameId(null);
    setMilestoneShown(false);
    setShowMilestoneModal(false);
    completedLogIdRef.current = null;
    autoSavedLogIdRef.current = null;
    autoLastMoveAtRef.current = Date.now();
    gameStartedAtRef.current = Date.now();

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
    if (watchingGame) return;
    if (currentPlayer !== 'human') return;
    if (state.lastMoveWasRotation) return;

    // Multiplayer: send a topologyToggle move through Firestore — the
    // opponent's listener re-derives the board (rebuildBoardFromMatch
    // skips toggle entries today; T1 unblocks them once Q.B.2 picks them
    // up via the same applyRotationMove path). King-safety check first
    // so we don't push an illegal rotation across the wire.
    if (isMultiplayer && mpSync) {
      if (mpSync.matchState.status !== 'active') return;
      if (!mpSync.isMyTurn) return;
      const toggledMp = toggleTopology(state);
      const ourKingMp = findKing(toggledMp, state.sideToMove);
      if (!ourKingMp) return;
      const oppMp = state.sideToMove === 'white' ? 'black' : 'white';
      if (
        isSquareAttacked(
          toggledMp,
          ourKingMp,
          oppMp as 'white' | 'black',
          toggledMp.topologyState,
        )
      ) {
        return;
      }
      // Q.D.3: in MP roulette rotate burns an action without consuming a
      // slot — handled by sendRotate. In classic MP rotate is a whole
      // turn — also routes through sendRotate which delegates to sendMove.
      void mpSync.sendRotate();
      setPreviewTopology(null);
      setSelected(null);
      return;
    }

    if (gameStatus !== 'active') return;

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

  // In MP currentPlayer reflects whose turn it is from MY seat: 'human' when
  // I can act, 'ai' otherwise. Keeping the same vocabulary lets the existing
  // canRotate / scheduler / UI-disable code work unchanged.
  const currentPlayer = isMultiplayer
    ? mpSync!.isMyTurn
      ? 'human'
      : 'ai'
    : state.sideToMove === 'white'
      ? 'human'
      : 'ai';

  // Auto-trigger the human's roulette spin after the first manual click of
  // the game. Conditions mirror the Spin Roulette button's enabled-state:
  // roulette mode, not currently spinning, human's turn, no roll active,
  // game still in progress, watcher not engaged. 500ms delay keeps the
  // turn boundary visible.
  useEffect(() => {
    if (isMultiplayer) return; // MP has its own auto-spin effect below
    if (gameMode !== 'roulette') return;
    if (!firstRouletteSpinDone) return;
    if (gameStatus !== 'active') return;
    if (watchingGame) return;
    if (currentPlayer !== 'human') return;
    if (allowedPieceTypes !== null) return;
    if (isRouletteSpinning) return;
    const t = setTimeout(() => {
      doSpinRouletteNow();
    }, 500);
    return () => clearTimeout(t);
    // doSpinRouletteNow re-allocates each render (captures the latest state
    // via closure) — listing it would re-fire the effect every render and
    // restart the 500ms timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gameMode,
    firstRouletteSpinDone,
    gameStatus,
    watchingGame,
    currentPlayer,
    allowedPieceTypes,
    isRouletteSpinning,
    isMultiplayer,
  ]);

  // Q.D.3: MP roulette auto-spin. Fires only when I need a fresh bag AND
  // I've already done at least one manual spin in this match. Pre-spin
  // means rouletteSlots===null. mid-turn (action 2) ALSO has slots set
  // — so the trigger condition is rouletteSlots===null while my turn is
  // active.
  useEffect(() => {
    if (!isMultiplayer || !mpSync) return;
    if (!mpSync.isRouletteMode) return;
    if (!mpSync.isMyTurn) return;
    if (mpSync.matchState.status !== 'active') return;
    if (mpSync.rouletteSlots !== null) return;
    if (mpSync.mySpinCount === 0) return; // first spin is manual
    const t = setTimeout(() => {
      void mpSync.spinRoulette();
    }, 500);
    return () => clearTimeout(t);
    // spinRoulette identity changes each render; same pattern as solo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isMultiplayer,
    mpSync?.isRouletteMode,
    mpSync?.isMyTurn,
    mpSync?.matchState.status,
    mpSync?.rouletteSlots,
    mpSync?.mySpinCount,
  ]);

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
          // Drop search-eval so the bar follows the static fallback for the
          // ~1 s before the worker comes back with the upgraded score.
          setSearchEvalFromWhite(null);
          setSearchMateInPlies(null);
          const aiAnalysis = await classifyAsync(boardState, move, next, {
            budgetMs: 1000,
            maxDepth: 7,
          });
          setLog((prev) => updateMoveAnalysisAt(prev, moveIdx, aiAnalysis));
          applyClassifyVisuals(moveIdx, aiAnalysis, move.to);
        }

        checkGameOver(next, move.kind === 'topologyToggle');
      }, 650);
    },
    [applyClassifyVisuals],
  );

  // Slim AI step for auto mode: no classifier round-trip, tighter delay.
  // The standard scheduleAiMove path is preserved unchanged for human play.
  const scheduleAutoMove = useCallback(
    (boardState: BoardState, moves: Move[], wasRotation: boolean) => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      autoTimerRef.current = setTimeout(async () => {
        const move = await SubutaiAgent.chooseMove(boardState, moves, {
          lastMoveWasRotation: wasRotation,
        });
        if (!move) return;
        if (move.kind === 'topologyToggle' && boardState.lastMoveWasRotation) return;

        const next =
          move.kind === 'topologyToggle'
            ? applyRotationMove(boardState)
            : applyMove(boardState, move);

        const san = computeSAN(boardState, move);
        setState(next);
        setLegalMoves(generateLegalMoves(next));
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

  // materialBreakdown.score is white-perspective (whiteTotal - blackTotal).
  // T5.1: flip for the black seat in PvP so the counter follows the same
  // viewer-perspective convention as the eval bar and gradient — green
  // when I'm up material, red when down.
  const materialScore =
    myColor === 'black' ? -materialBreakdown.score : materialBreakdown.score;

  useEffect(() => {
    if (isMultiplayer) return; // PvP: no engine drives the opponent
    if (gameStatus !== 'active') return;
    if (watchingGame) return; // replay mode — never let the AI move.
    if (isAutoMode) {
      if (autoStopped) return;
      scheduleAutoMove(state, legalMoves, lastMoveWasRotation);
      return () => {
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
    scheduleAutoMove,
    lastMoveWasRotation,
    watchingGame,
    isAutoMode,
    autoStopped,
    isMultiplayer,
  ]);

  // Stage T1: trigger the en-passant explosion overlay whenever a new
  // EP move lands in the log — works for both solo + MP because the log
  // alias covers both. Captured pawn sits at (file of `to`, rank of `from`).
  useEffect(() => {
    const last = log.moves[log.moves.length - 1];
    if (!last) return;
    const mv = last.move;
    if (mv.kind !== 'enPassant' || !mv.from || !mv.to) return;
    const captureSq = (mv.to[0] + mv.from[1]) as SquareId;
    setEnPassantExplosionSquare(captureSq);
    const t = setTimeout(() => setEnPassantExplosionSquare(null), 700);
    return () => clearTimeout(t);
  }, [log.moves.length]);

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

  // Stage T1: en-passant target squares get a distinct pulse so the player
  // notices the rare opportunity. Disjoint from the regular green dots.
  const enPassantTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    const ep = new Set<string>();
    for (const move of legalMoves) {
      if (move.from !== selected) continue;
      if (move.kind === 'enPassant' && move.to) ep.add(move.to);
    }
    return ep;
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
    if (watchingGame) return; // replay mode is read-only.

    // Multiplayer: bypass the local engine pipeline entirely. Selection +
    // legalMoves are the same shared values; the only difference is the
    // move dispatch sends through Firestore instead of mutating local state.
    if (isMultiplayer) {
      if (!mpSync || !mpSync.isMyTurn) return;
      if (mpSync.matchState.status !== 'active') return;
      const sq = square as SquareId;
      const piece = state.pieces[sq];
      // Q.D.3: MP roulette — board is dead until the on-clock player
      // spins. After spin only piece types whose slot index is still
      // unused can be selected.
      const isMpRoulette = mpSync.isRouletteMode;
      if (isMpRoulette && mpSync.rouletteSlots === null) return;
      const canSelectType = (type: PieceType): boolean => {
        if (!isMpRoulette || !mpSync.rouletteSlots) return true;
        return mpSync.rouletteSlots.some(
          (t, i) => t === type && !mpSync.usedRouletteSlots.includes(i),
        );
      };
      if (!selected) {
        if (
          piece &&
          piece.color === mpSync.myColor &&
          canSelectType(piece.type)
        ) {
          setSelected(square);
        }
        return;
      }
      if (selected === square) {
        setSelected(null);
        return;
      }
      const move = legalMoves.find(
        (m) => m.from === selected && m.to === square,
      );
      if (!move) {
        // Click on another own piece → switch; else clear.
        if (
          piece &&
          piece.color === mpSync.myColor &&
          canSelectType(piece.type)
        ) {
          setSelected(square);
        } else {
          setSelected(null);
        }
        return;
      }
      const resolved: Move =
        move.kind === 'promotion' && !move.promotion
          ? { ...move, promotion: 'queen' }
          : move;
      setSelected(null);
      void mpSync.sendMove(resolved);
      return;
    }

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
    // Defer classify so the click feels instant — main thread is still
    // single-threaded but the DOM paints first, then the analysis lands
    // ~300 ms later as if the engine is "thinking".
    // Worker-backed classify: keeps the main thread responsive while the
    // ~1 s depth-7 search runs. moveIdx is captured pre-append so the .then
    // can patch by index even if the user / AI has moved on by the time the
    // analysis lands. Visuals are gated to "still the latest move".
    // Drop the previous search-eval immediately — currentEval falls back to
    // the static evaluator, which gives the bar an instant first-pass shift
    // (matters most on captures). The classify .then upgrades it ~1s later.
    setSearchEvalFromWhite(null);
    setSearchMateInPlies(null);
    const moveIdx = log.moves.length;
    classifyAsync(state, resolvedMove, afterMove, { budgetMs: 1000, maxDepth: 7 })
      .then((analysis) => {
        setLog((prev) => updateMoveAnalysisAt(prev, moveIdx, analysis));
        applyClassifyVisuals(moveIdx, analysis, resolvedMove.to);
      });

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
    // See onSquareClick: drop search-eval so the static fallback paints the
    // bar instantly while the worker classifier catches up.
    setSearchEvalFromWhite(null);
    setSearchMateInPlies(null);
    const moveIdx = log.moves.length;
    classifyAsync(state, move, next, { budgetMs: 1000, maxDepth: 7 }).then(
      (analysis) => {
        setLog((prev) => updateMoveAnalysisAt(prev, moveIdx, analysis));
        applyClassifyVisuals(moveIdx, analysis, move.to);
      },
    );
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

  // Highlight the last N piece-plies on the board. Roulette mode plays two
  // sub-moves per AI turn, so we widen the window to 2; classic stays at 1
  // and renders identically to the old single-lastMove behaviour.
  // Indexed 0 = most recent, 1 = previous (used for an 'older' opacity).
  const recentPlyHighlights = useMemo(() => {
    const wantCount = gameMode === 'roulette' ? 2 : 1;
    const from = new Map<string, number>();
    const to = new Map<string, number>();
    let found = 0;
    for (let i = log.moves.length - 1; i >= 0 && found < wantCount; i--) {
      const m = log.moves[i].move;
      if (!m.from || !m.to || m.kind === 'topologyToggle') continue;
      if (!from.has(m.from)) from.set(m.from, found);
      if (!to.has(m.to)) to.set(m.to, found);
      found++;
    }
    return { from, to };
  }, [log.moves, gameMode]);

  const positionLabel = backRankString(initialState);

  // Stable callback for <MemoryPanel onGameActivate>. The wrapped function
  // closes over a ref that always points at the latest `resumeGame`, so the
  // prop reference itself never changes and React.memo on MemoryPanel can
  // skip the 300-card subtree on every App re-render.
  const resumeGameRef = useRef<(game: SavedGame) => void>(() => {});
  const onMemoryGameActivate = useCallback((g: SavedGame) => {
    if (g.status === 'incomplete') resumeGameRef.current(g);
  }, []);

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
    setSearchEvalFromWhite(null);
    setSearchMateInPlies(null);
    classifyImportedLog(nextLog);
  }
  // Keep the ref pointing at the latest resumeGame closure so the stable
  // onMemoryGameActivate callback always invokes the fresh state-bound copy.
  resumeGameRef.current = resumeGame;

  function importReplayFromNotation() {
    try {
      const parsed = parseMemoryNotation(replayText);
      const initial = createPositionFromBackRankKey(parsed.config960);
      let current: BoardState = initial;
      let replayLog: GameLog = createGameLog(`replay-${Date.now()}`, initial, Date.now());

      for (const token of parsed.moves) {
        const mv = token.move;

        // Auto-switch topology if @B/@A suffix requires it.
        // T1.2: use the pure `toggleTopology` (doesn't flip sideToMove or
        // record a move). Previously this called applyRotationMove which
        // burned a turn — and then castles by the (now wrong) side failed
        // with "No legal castle". The @B suffix is informational; if the
        // game really included a rotation, the log carries it as its own
        // entry and the toggleTopology no-ops when topology already matches.
        if (token.requiredTopology && current.topologyState !== token.requiredTopology) {
          current = toggleTopology(current);
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
      setSearchEvalFromWhite(null);
      setSearchMateInPlies(null);
      classifyImportedLog(replayLog);

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
        const a = entry.analysis;
        if (a) {
          const marker = MOVE_CLASS_MARKER[a.classification];
          if (marker) san += marker;
          if (a.classification === 'blunder') {
            // Stage O: collapse the PV to a single move \u2014 the chain was hard
            // to parse mid-list. Prefer bestMoveSan when present (it's the
            // first PV move with explicit naming).
            const first = a.bestMoveSan ?? a.bestPvSan?.[0];
            if (first) {
              san += ` \u2190 Better: ${first}`;
            }
            // Append the centipawn loss so the player can gauge how marginal
            // the suggestion is. cpl 50-100 = borderline, 300+ = real blunder.
            // Stage L's float-eval makes cpl a non-integer \u2014 round for display.
            if (a.cpl > 0) {
              san += ` (\u2212${Math.round(a.cpl)} cp)`;
            }
          }
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

  if (isStatsMode) {
    return <StatsPage />;
  }

  if (isAutoMode) {
    const avgMoves =
      autoMoveHistory.length > 0
        ? Math.round(
            autoMoveHistory.reduce((s, n) => s + n, 0) / autoMoveHistory.length,
          )
        : null;
    const currentFullMoves = Math.floor(log.moves.length / 2);
    const autoBoard = (
      <div
        className={`board${recentRotation ? ' is-rotated' : ''}`}
        style={{ width: boardSize, height: boardSize }}
      >
        {squares.map((sq) => {
          const piece = state.pieces[sq as SquareId];
          const isDark =
            ((sq.charCodeAt(0) - 'a'.charCodeAt(0)) +
              (Number(sq[1]) - 1)) %
              2 ===
            1;
          const isLastFrom = lastMove?.from === sq;
          const isLastTo = lastMove?.to === sq;
          const { cx, cy, angle } = tilePixelCenter(
            sq as SquareId,
            displayTopology,
            layout,
          );
          const tx = cx - tileBase / 2;
          const ty = cy - tileBase / 2;
          return (
            <div
              key={sq}
              className={[
                'tile',
                isDark ? 'dark' : 'light',
                isLastFrom ? 'last-from' : '',
                isLastTo ? 'last-to' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                width: tileBase,
                height: tileBase,
                transform: `translate(${tx}px, ${ty}px) rotate(${angle}deg) scale(${scale})`,
              }}
            >
              {piece && (
                <span
                  className={`piece piece-${piece.color}`}
                  style={angle ? { transform: `rotate(${-angle}deg)` } : undefined}
                >
                  {glyphForPiece(piece.color, piece.type)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
    return (
      <div className="app-shell auto-shell-root" ref={shellRef}>
        <AutoPlayView
          gamesCompleted={autoGamesCompleted}
          maxGames={maxGames}
          currentGameFullMoves={currentFullMoves}
          lastOutcome={autoLastOutcome}
          avgGameMoves={avgMoves}
          stopped={autoStopped}
          stoppedReason={autoStoppedReason}
          onStop={stopAuto}
          board={autoBoard}
        />
      </div>
    );
  }

  if (view === 'review') {
    return (
      <div className="app-shell" ref={shellRef}>
        <GameReview
          log={activeReviewLog ?? log}
          meta={activeReviewMeta ?? undefined}
          gameId={sharedGameId ?? lastGameId ?? null}
          onBack={() => {
            setView('game');
            // Drop the snapshot so the next plain Review opens the live log.
            setActiveReviewLog(null);
            setActiveReviewMeta(null);
            // Strip ?game= so a refresh won't re-open the shared review.
            if (
              typeof window !== 'undefined' &&
              new URLSearchParams(window.location.search).get('game')
            ) {
              const url = new URL(window.location.href);
              url.searchParams.delete('game');
              window.history.replaceState(null, '', url.toString());
            }
          }}
        />
      </div>
    );
  }

  if (view === 'leaderboard') {
    return (
      <div className="app-shell" ref={shellRef}>
        <Leaderboard
          currentUid={user?.uid ?? null}
          onBack={() => setView('game')}
          onWatchGame={(gameId, playerName) => {
            void startWatching(gameId, playerName);
          }}
        />
      </div>
    );
  }

  if (view === 'friend-lobby') {
    return (
      <div className="app-shell" ref={shellRef}>
        <FriendLobby
          uid={user?.uid ?? null}
          displayName={displayName}
          onBack={() => {
            setView('game');
            setOpponentMode('ai');
          }}
          onMatchReady={(match) => {
            // Q.B.2: hand the live match over to the regular game view.
            // The board / log / header all reuse the single-player UI,
            // sourcing their data from useMultiplayerSync.
            setActiveMatch(match);
            setView('game');
            // Reset any stale completion state from a previous match.
            setMpEndOutcome(null);
            mpSavedGameIdRef.current = null;
            mpWroteOutcomeRef.current = null;
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-shell" ref={shellRef}>
    <div className="app-root" style={{ '--board-size': `${boardSize}px` } as React.CSSProperties}>
      <header className="app-header">
        <div className="app-brand">
          <h1>subutai</h1>
          {isMultiplayer && mpSync ? (
            <p className="app-tagline">
              vs <strong>{mpSync.opponentDisplayName}</strong> · {mpSync.matchState.code}
            </p>
          ) : (
            gameMode === 'classic' &&
            opponentMode === 'ai' && (
              <p className="app-tagline">
                Try to survive 50 moves against the AI
              </p>
            )
          )}
        </div>
        <div className="header-controls">
        {displayName && (
          <button
            type="button"
            className="header-username-btn"
            onClick={() => setShowNameModal(true)}
            title="Change name"
          >
            {displayName}
          </button>
        )}
        <button
          type="button"
          className="header-leaderboard-btn"
          onClick={() => setView('leaderboard')}
          title="Leaderboard"
        >
          {'\u{1F3C6}'}
        </button>
        <button
          type="button"
          className="header-feedback-btn"
          onClick={() => setShowFeedbackModal(true)}
          disabled={!user || !displayName}
          title="Share feedback"
          aria-label="Share feedback"
        >
          {'\u{1F4AC}'}
        </button>
        <div className="opponent-mode-switcher">
          <button
            type="button"
            className={`opponent-mode-btn${opponentMode === 'ai' ? ' is-active' : ''}`}
            onClick={() => setOpponentMode('ai')}
            title="Play vs the engine"
          >
            {'\u{1F916}'} vs AI
          </button>
          <button
            type="button"
            className={`opponent-mode-btn${opponentMode === 'friend' ? ' is-active' : ''}`}
            onClick={() => {
              setOpponentMode('friend');
              setView('friend-lobby');
            }}
            title="Private match by code"
            disabled={!user || !displayName}
          >
            {'\u{1F465}'} vs Friend
            <span className="beta-tag">BETA</span>
          </button>
        </div>
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
        <button
          type="button"
          className="header-help-btn"
          onClick={() => setShowHelp(true)}
          title="Rules & info"
        >
          ?
        </button>
        </div>
      </header>

      {watchingGame && (
        <div className="watch-banner">
          <span className="watch-banner-label">
            {'\u{1F441}'} Watching <strong>{watchingGame.playerName}</strong>’s game ·
            move {Math.floor((watchingGame.currentMoveIdx + 1) / 2)}/
            {Math.floor(watchingGame.log.moves.length / 2)}
          </span>
          <div className="watch-banner-controls">
            <button
              type="button"
              className="watch-btn"
              onClick={() => seekWatchTo(watchingGame.currentMoveIdx - 1)}
              disabled={watchingGame.currentMoveIdx === 0}
              title="Previous move"
            >
              ← Prev
            </button>
            <button
              type="button"
              className="watch-btn"
              onClick={() => seekWatchTo(watchingGame.currentMoveIdx + 1)}
              disabled={watchingGame.currentMoveIdx >= watchingGame.log.moves.length}
              title="Next move"
            >
              Next →
            </button>
            <button
              type="button"
              className={`watch-btn${watchingGame.autoplay ? ' watch-btn-active' : ''}`}
              onClick={toggleWatchAutoplay}
              disabled={watchingGame.currentMoveIdx >= watchingGame.log.moves.length}
              title="Auto play"
            >
              {watchingGame.autoplay ? '⏸ Pause' : '▶ Auto'}
            </button>
            <button
              type="button"
              className="watch-btn watch-btn-stop"
              onClick={stopWatching}
              title="Stop and return to your game"
            >
              ✕ Stop
            </button>
          </div>
        </div>
      )}

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

      {sharedGameError && (
        <div className="mp-banner mp-banner-error" role="status">
          {sharedGameError}{' '}
          <button
            type="button"
            className="mp-back-btn"
            style={{ marginLeft: 8 }}
            onClick={() => setSharedGameError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {isMultiplayer && mpSync && mpSync.matchState.status === 'active' && (
        <div
          className={`mp-banner${mpSync.isMyTurn ? ' mp-banner-active' : ' mp-banner-wait'}`}
        >
          {mpSync.isMyTurn ? (
            // Roulette UI is rendered by the shared solo panel below
            // (Spin Roulette button + slot chips). Surface a compact
            // action counter when we're mid-turn so the player knows
            // they still have moves left.
            mpSync.isRouletteMode && mpSync.rouletteSlots ? (
              <>
                Your turn — {mpSync.rouletteActionsLeft} action
                {mpSync.rouletteActionsLeft === 1 ? '' : 's'} left
              </>
            ) : (
              'Your turn'
            )
          ) : mpSync.isRouletteMode && mpSync.rouletteSlots ? (
            <>
              <span className="mp-spinner" aria-hidden />
              {mpSync.opponentDisplayName} is acting…
            </>
          ) : (
            <>
              <span className="mp-spinner" aria-hidden />
              Waiting for {mpSync.opponentDisplayName}…
            </>
          )}
        </div>
      )}

      {isMultiplayer &&
        mpSync &&
        mpSync.selfAfkWarning &&
        mpSync.matchState.status === 'active' && (
          <div className="mp-banner mp-banner-warn">
            ⏰ Your turn — make a move or auto-forfeit in ~30s.
          </div>
        )}

      {isMultiplayer && mpSync && mpSync.error && (
        <div className="mp-banner mp-banner-error">{mpSync.error}</div>
      )}

      <div className="board-with-eval">
        <EvalBar
          evalCp={myPerspectiveEval}
          mateInPlies={searchMateInPlies}
          isPending={!isMultiplayer && searchEvalFromWhite === null}
        />
      <div className="board-with-coords" style={{ width: boardSize }}>
      <div className="board-ranks" style={{ height: boardSize }}>
        {(isMultiplayer && mpSync?.myColor === 'black'
          ? ['1', '2', '3', '4', '5', '6', '7', '8']
          : ['8', '7', '6', '5', '4', '3', '2', '1']
        ).map((r) => (
          <div key={r} className="board-rank">{r}</div>
        ))}
      </div>
      <div
        className={`board${previewTopology || previewLocked ? ' previewing' : ''}${recentRotation ? ' is-rotated' : ''}`}
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
          const isEnPassantTarget = enPassantTargets.has(sq);
          const isEnPassantExplosion = enPassantExplosionSquare === sq;
          // Classic uses the single lastMove state; roulette derives the
          // last two piece-plies from the log so both AI sub-moves show.
          const isLastFrom =
            gameMode === 'roulette'
              ? recentPlyHighlights.from.has(sq)
              : lastMove?.from === sq;
          const isLastTo =
            gameMode === 'roulette'
              ? recentPlyHighlights.to.has(sq)
              : lastMove?.to === sq;
          const olderHighlight =
            gameMode === 'roulette' &&
            (recentPlyHighlights.from.get(sq) === 1 ||
              recentPlyHighlights.to.get(sq) === 1);
          const isCheckedKing = checkSquares.king === sq;
          const isCheckingPiece = checkSquares.checkers.has(sq);
          const threatCount = threatenedSquares.get(sq) ?? 0;
          const isThreateningPiece = threateningPieceSquares.has(sq);

          const { cx, cy, angle } = tilePixelCenter(
            sq as SquareId,
            displayTopology,
            layout,
          );

          // T3: orient via coord mirroring rather than CSS rotate(180deg).
          // The parent .board stays unrotated so piece glyphs render right-
          // way-up for both colors; we just flip the per-tile position so
          // the black player sees their own back rank at the bottom.
          const flip = isMultiplayer && mpSync?.myColor === 'black';
          const cxView = flip ? boardSize - cx : cx;
          const cyView = flip ? boardSize - cy : cy;
          const tx = cxView - tileBase / 2;
          const ty = cyView - tileBase / 2;

          return (
            <button
              key={sq}
              type="button"
              className={[
                'tile',
                isDark ? 'dark' : 'light',
                isSelected ? 'selected' : '',
                isEnPassantTarget ? 'target-enpassant' : isTarget ? 'target' : '',
                isEnPassantExplosion ? 'enpassant-explosion' : '',
                isLastFrom ? 'last-from' : '',
                isLastTo ? 'last-to' : '',
                olderHighlight ? 'last-older' : '',
                isCheckedKing ? (gameStatus === 'checkmate' ? 'mated-king' : 'checked-king') : '',
                isCheckingPiece ? (gameStatus === 'checkmate' ? 'mating-piece' : 'checking-piece') : '',
                threatCount > 0 ? 'threatened' : '',
                isThreateningPiece ? 'threatening-piece' : '',
                classifiedSquare?.square === sq
                  ? `classified-${classifiedSquare.classification}`
                  : '',
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
      <div className="board-files">
        {(isMultiplayer && mpSync?.myColor === 'black'
          ? ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']
          : ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
        ).map((f) => (
          <div key={f} className="board-file">{f}</div>
        ))}
      </div>
      </div>
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
          <button
            type="button"
            className="action-btn resign-btn"
            onClick={requestResign}
            disabled={!!watchingGame || gameStatus !== 'active' || log.moves.length === 0}
            title="Resign \u2014 half move points, no bonus"
          >
            {'\u{1F3F3}'}
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
          className="review-trigger-btn"
          onClick={() => setView('review')}
          disabled={log.moves.length === 0}
          title="Review the game move-by-move"
        >
          📊 Review
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
        {/* ceil so the count matches the highest move number actually visible
            in the notation (after White's reply, "3." is on screen so we
            show 3, not 2). */}
        <summary>Moves ({Math.ceil(log.moves.length / 2)})</summary>
        <div className="move-log-content">
          <pre className="move-log-text">{notationString}</pre>
          <button type="button" className="copy-btn" onClick={copyNotation}>
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
        </div>
      </details>

      {!isMultiplayer && (
        <MemoryPanel onGameActivate={onMemoryGameActivate} />
      )}

      {!authLoading && user && !displayName && (
        <NamePicker
          mode="initial"
          uid={user.uid}
          onComplete={(name) => {
            setDisplayName(name);
          }}
        />
      )}

      {showNameModal && user && displayName && (
        <NamePicker
          mode="change"
          uid={user.uid}
          currentName={displayName}
          onComplete={(name) => {
            setDisplayName(name);
            setShowNameModal(false);
          }}
          onCancel={() => setShowNameModal(false)}
        />
      )}

      {confirmingResign && (
        <ConfirmDialog
          title="Resign this game?"
          message="Resigning only earns half move points and no capture or outcome bonus. Are you sure?"
          confirmLabel="Resign anyway"
          cancelLabel="Cancel"
          danger
          onConfirm={confirmResign}
          onCancel={() => setConfirmingResign(false)}
        />
      )}

      {isMultiplayer && mpSync && mpEndOutcome && (() => {
        const myView = translateOutcomeForPlayer(mpEndOutcome, {
          uid: mpSync.myUid,
          displayName: '',
          color: mpSync.myColor,
        });
        const opp = mpSync.opponentDisplayName;
        const headline =
          myView === 'human-win'
            ? `You won vs ${opp}!`
            : myView === 'human-resign'
              ? `You resigned vs ${opp}.`
              : myView === 'ai-win'
                ? `You lost vs ${opp}.`
                : `Draw vs ${opp}.`;
        const subline =
          mpEndOutcome === 'host-resign'
            ? `${mpSync.matchState.host.displayName} resigned.`
            : mpEndOutcome === 'guest-resign'
              ? `${mpSync.matchState.guest?.displayName ?? 'Guest'} resigned.`
              : mpEndOutcome === 'draw'
                ? 'Match drawn.'
                : `${mpEndOutcome === 'white-win' ? 'White' : 'Black'} wins by checkmate.`;
        function dismiss() {
          setMpEndOutcome(null);
          setActiveMatch(null);
          setOpponentMode('ai');
          setView('game');
        }
        function backToLobby() {
          setMpEndOutcome(null);
          setActiveMatch(null);
          mpSavedGameIdRef.current = null;
          mpWroteOutcomeRef.current = null;
          setView('friend-lobby');
        }
        function reviewMatch() {
          if (!mpSync) return;
          // Snapshot the match log so leaving the live match doesn't pull
          // the data out from under the review screen. classifyAsync will
          // populate per-move analysis on the fly inside GameReview.
          setActiveReviewLog(deriveMpLog(mpSync.matchState));
          setActiveReviewMeta({
            playerName: displayName ?? 'You',
            opponentName: mpSync.opponentDisplayName,
            outcome: myView,
          });
          setMpEndOutcome(null);
          setActiveMatch(null);
          setView('review');
        }
        return (
          <div className="mp-completion-backdrop" onClick={dismiss}>
            <div
              className="mp-completion-dialog"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mp-completion-title">Match complete</h2>
              <p className="mp-completion-headline">{headline}</p>
              <p className="mp-completion-subline">{subline}</p>
              <div className="mp-completion-actions">
                <button
                  type="button"
                  className="mp-btn mp-btn-primary"
                  onClick={reviewMatch}
                >
                  📊 Review this game
                </button>
                <button
                  type="button"
                  className="mp-btn mp-btn-secondary"
                  onClick={dismiss}
                >
                  Back to AI
                </button>
                <button
                  type="button"
                  className="mp-btn mp-btn-secondary"
                  onClick={backToLobby}
                >
                  Find opponent
                </button>
              </div>
              <p className="mp-completion-footnote">
                PvP games don&apos;t affect leaderboard points.
              </p>
            </div>
          </div>
        );
      })()}

      {summaryOpen && lastGamePoints && gameOutcome && (
        <GameSummary
          points={lastGamePoints}
          outcome={gameOutcome}
          personalBest={personalBest}
          isNewPersonalBest={isNewBest}
          currentRank={currentRank}
          saving={savingGame}
          saveError={saveError}
          chess960Id={positionLabel}
          gameId={lastGameId}
          playerId={user?.uid ?? null}
          playerName={displayName}
          durationMs={lastGameDurationMs ?? undefined}
          gameMode={gameMode}
          onClose={() => setSummaryOpen(false)}
          onPlayAgain={() => {
            setSummaryOpen(false);
            startNewGame();
          }}
        />
      )}

      {showFeedbackModal && user && displayName && (
        <FeedbackModal
          playerId={user.uid}
          playerName={displayName}
          onClose={() => setShowFeedbackModal(false)}
        />
      )}

      {showMilestoneModal && (
        <MilestoneModal
          fullMoves={Math.floor(log.moves.length / 2)}
          currentScoreEstimate={Math.floor(log.moves.length / 2) * 5}
          onKeepPlaying={() => setShowMilestoneModal(false)}
          onResignNow={() => {
            setShowMilestoneModal(false);
            // The modal already explained the consequence — go straight to
            // the resign-confirmation dialog so the player can change their
            // mind without an extra click.
            setConfirmingResign(true);
          }}
        />
      )}

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
    </div>
  );
}

function EvalBar({
  evalCp,
  mateInPlies,
  isPending,
}: {
  /** VIEWER-perspective centipawn score. Positive = "I'm winning". App
   *  inverts this for the black seat before passing it in (T5) — keeps
   *  this component dumb: always fill the bottom (my-side) of the bar. */
  evalCp: number;
  mateInPlies: number | null;
  /** True while we're showing the static-eval fallback waiting on the worker. */
  isPending: boolean;
}) {
  const isMate = mateInPlies !== null;
  let mySidePercent: number;
  let display: string;
  if (isMate) {
    // Snap to the winning edge so the bar visually screams "the game is
    // ending" — bypass the smooth tanh curve.
    mySidePercent = evalCp > 0 ? 95 : 5;
    const sign = evalCp > 0 ? '' : '−';
    const moves = Math.ceil((mateInPlies as number) / 2);
    display = moves <= 0 ? `${sign}#` : `${sign}M${moves}`;
  } else {
    // 50% baseline + tanh-shaped scale so big advantages don't peg the bar
    // to 0/100 and tiny ones still register. Clamp so the loser always
    // shows a sliver — fully empty looks broken.
    const t = Math.tanh(evalCp / 400);
    mySidePercent = Math.max(5, Math.min(95, 50 + t * 45));
    display = `${evalCp >= 0 ? '+' : '−'}${(Math.abs(evalCp) / 100).toFixed(1)}`;
  }
  // Text sits on the side opposite to my fill so it stays legible.
  const textOnBottom = mySidePercent < 50;
  return (
    <div
      className={`eval-bar${isMate ? ' is-mate' : ''}${isPending ? ' is-pending' : ''}`}
      aria-label={`Evaluation ${display}`}
    >
      <div className="eval-bar-white" style={{ height: `${mySidePercent}%` }} />
      <span
        className={`eval-bar-text${textOnBottom ? ' eval-bar-text-bottom' : ' eval-bar-text-top'}`}
      >
        {display}
      </span>
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
