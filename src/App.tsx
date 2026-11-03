import './App.css';
import type { BoardState, Color, Move, PieceType, SquareId, TopologyState } from './engine';
import { createStartingPosition, createPositionFromBackRankKey, isValidChess960Key } from './engine';
import {
  applyMove,
  generateLegalMoves,
  isSquareAttacked,
  findKing,
} from './engine/moves';
import { applyRotationMove, toggleTopology, tilePixelCenter, toTileFrame } from './engine/auxetic';
import {
  BOT_STRENGTH_LABEL,
} from './ai/agents';
import { clearSearchTable, searchAsync } from './ai/searchClient';
import { classifyAsync } from './analysis/classifyClient';
import { useToast } from './components/Toast';
import type { EndgameKind, KingOrigin, VictoryTheme } from './components/EndgameScene';
import { GameSummary } from './components/GameSummary';
import { STREAMING_UI } from './featureFlags';
import { FeedbackModal } from './components/FeedbackModal';
import { MilestoneModal } from './components/MilestoneModal';
import { AutoPlayView } from './components/AutoPlayView';
import { PlayerRow } from './components/PlayerRow';
import { EvalBar } from './features/game/EvalBar';
import { HelpDialog } from './app/HelpDialog';
import { ScreenFlash } from './features/game/ScreenFlash';
import { WatchBanner } from './features/review/WatchBanner';
import { MatchBanners } from './features/online/MatchBanners';
import { StatusBar } from './app/StatusBar';
import { AutoBoard } from './features/autoplay/AutoBoard';
import { GameClocks } from './features/game/GameClocks';
import { MovesPanel } from './features/game/MovesPanel';
import { AnalysisPanel } from './features/game/AnalysisPanel';
import { ReplayDialog } from './memory/ReplayDialog';
import { LocalGameOver } from './features/local/LocalGameOver';
import { PromotionDialog } from './features/game/PromotionDialog';
import { RoulettePanel } from './features/game/RoulettePanel';
import { NO_SLOTS } from './features/game/boardView';
import { GameSetupPanel } from './features/game/GameSetupPanel';
import { PositionCodeRow } from './features/game/PositionCodeRow';
import { AppHeader } from './app/AppHeader';
import { LocalTopActions } from './features/local/LocalTopActions';
import { AppDialogs } from './app/AppDialogs';
import { MatchCompleteDialog } from './features/online/MatchCompleteDialog';
import { BoardActions } from './features/game/BoardActions';
import { BoardCoords } from './features/game/BoardCoords';
import { BoardOverlays } from './features/game/BoardOverlays';
import { TutorialOverlay } from './components/TutorialOverlay';
import { WelcomeScreen } from './components/WelcomeScreen';
import type { GameReviewMeta } from './components/GameReview';
import type { MatchDoc, MatchOutcome } from './firebase/matches';
import { useAuth } from './firebase/useAuth';
import { deserializeGameLog } from './firebase/games';
import { gamesRepo } from './infra/firestore/games';
import { computeGamePoints, type GameOutcome, type GamePoints } from './analysis/points';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameLog } from './recording/log';
import { computeSAN, unclassifiedMoveIndexes } from './recording/log';
import { buildSavedGameSnapshot } from './memory/build';
import { localStorageAdapter } from './memory/storage';
import { MemoryPanel } from './memory/MemoryPanel';
import { NotationParseError } from './memory/notation';
// rotateIsLegal (R10) decides whether chat rounds accept "rotate"; it lives
// with the replay importer, which checks rotations the same way (QA-02).
import { replayFromNotation } from './memory/replayImport';
import { busy } from './ui/busy';
import { streaming, useStreaming } from './integrations';
import { scaleBudgetMs } from './utils/deviceTier';
import {
  canAnswerDraw,
  canOfferDraw,
  drawOfferBlock,
  standingDrawOffer,
  type DrawOfferBlock,
  type DrawTable,
} from './utils/drawOffer';
import { HUMAN_COLOR, type GameMode, type GameStatus } from './shared/game';
import { isPieceMovableInRoulette } from './features/game/roulette';
import {
  backRankString,
  bumpEvalForMove,
  gameEnding,
  replayBoardAt,
} from './features/game/position';
import type { GameBackup, WatchingGame } from './features/review/watching';
import { glyphForPiece } from './features/game/pieceGlyph';
import { colorFromMouseEvent, type AnnotationColor, type ArrowAnnotation } from './features/game/annotations';
import { recentPlies } from './features/game/boardMarks';
import { soloOutcome } from './features/endgame/result';
import { useUrlModes } from './app/useUrlModes';
import { useOnlineMatch } from './features/online/useOnlineMatch';
import { useMobileDrawers } from './app/useMobileDrawers';
import { useOnboarding } from './app/useOnboarding';
import { useTwitchState } from './features/twitch/useTwitchState';
import { useMusicState } from './features/music/useMusicState';
import { useBotLevel } from './features/game/useBotLevel';
import { useBoardFxState } from './features/game/useBoardFxState';
import { useEval } from './features/game/useEval';
import { useBoardSize } from './app/useBoardSize';
import { usePresenceHeartbeat } from './features/online/usePresenceHeartbeat';
import { useConsoleSeams } from './features/game/useConsoleSeams';
import { useMemoryAutosave } from './memory/useMemoryAutosave';
import { useOnlineMatchEnd } from './features/online/useOnlineMatchEnd';
import { useDrawDeclinedToast } from './features/online/useDrawDeclinedToast';
import { useSharedGame } from './features/review/useSharedGame';
import { useAutoPlay } from './features/autoplay/useAutoPlay';
import { useRoomGradient } from './app/useRoomGradient';
import { useClassifyGuards } from './features/game/useClassifyGuards';
import { useWatchAutoplay } from './features/review/useWatchAutoplay';
import { useAdaptiveTheme } from './app/useAdaptiveTheme';
import { useMoveMilestones } from './features/game/useMoveMilestones';
import { useAdaptiveMusic } from './features/music/useAdaptiveMusic';
import { useMoveLogScroll } from './features/game/useMoveLogScroll';
import { useRotateHint } from './features/game/useRotateHint';
import { useClassifier } from './features/game/useClassifier';
import { useGameClocks } from './features/game/useGameClocks';
import { useNavigationGuards } from './app/useNavigationGuards';
import { useSoloFlagFall } from './features/game/useSoloFlagFall';
import { useAfkNudge } from './features/game/useAfkNudge';
import { useMoveFeedback } from './features/game/useMoveFeedback';
import { useRouletteAutoSpin } from './features/game/useRouletteAutoSpin';
import { useSeats } from './features/game/useSeats';
import { useCaptureFx } from './features/game/useCaptureFx';
import { useBoardMarks } from './features/game/useBoardMarks';
import { useCoachNudges } from './features/game/useCoachNudges';
import { useEndgame, importEndgameScene } from './features/endgame/useEndgame';
import { useGameStartPing } from './features/game/useGameStartPing';
import { useResumeGame } from './memory/useResumeGame';
import { useNotation } from './features/game/useNotation';
import { useGameSaveQueue, type FinishedGameSave } from './features/endgame/useGameSaveQueue';
import { useMaterial } from './features/game/useMaterial';
import { useCanRotate } from './features/game/useCanRotate';
import { session, turns } from './session/session';
import { useSession, useSessionFatal } from './session/useSession';
import { useSessionEventsAfterCommit } from './session/useSessionEvents';
import { drawTableOf, statusOf } from './session/step';
import { localData, LOCAL_KEYS } from './infra/localData';

// Sprint 4.4 — heavy sub-views are code-split. Each renders as a
// full-screen takeover, so a Suspense spinner fallback is natural.
// NOTE: this block must sit BELOW the react import — Vite's dev-mode
// CJS interop turns `import { lazy }` into a const at the import line,
// so calling lazy() above it is a TDZ ReferenceError.
const GameReview = lazy(() =>
  import('./components/GameReview').then((m) => ({ default: m.GameReview })),
);
const Leaderboard = lazy(() =>
  import('./components/Leaderboard').then((m) => ({ default: m.Leaderboard })),
);
const FriendLobby = lazy(() =>
  import('./components/FriendLobby').then((m) => ({ default: m.FriendLobby })),
);
const StatsPage = lazy(() =>
  import('./components/StatsPage').then((m) => ({ default: m.StatsPage })),
);
// T3 — Twitch overlay is code-split: only streamers pay for it.
const TwitchPanel = lazy(() =>
  import('./components/TwitchPanel').then((m) => ({ default: m.TwitchPanel })),
);
// SP — Spotify dock, same deal.
const MusicDock = lazy(() =>
  import('./components/MusicDock').then((m) => ({ default: m.MusicDock })),
);
// M.15 — the dock's sound-grid background: off unless saved on (useMusicState).
const BackgroundWaveGrid = lazy(() =>
  import('./components/BackgroundWaveGrid').then((m) => ({ default: m.BackgroundWaveGrid })),
);
// R6 — pixel victory cinematic; loaded only when a tense win triggers it.
// importEndgameScene (in useEndgame) lets the iris warm the chunk early.
const EndgameScene = lazy(() =>
  importEndgameScene().then((m) => ({ default: m.EndgameScene })),
);

// M.14 — beat-mode glide length. MUST match the .piece-slide-in CSS
// animation duration so the slide lands exactly on the beat.
const BEAT_SLIDE_MS = 260;

function App() {
  const { isAutoMode, maxGames, isStatsMode, sharedGameId } = useUrlModes();

  const [autoGamesCompleted, setAutoGamesCompleted] = useState(0);
  const [autoLastOutcome, setAutoLastOutcome] = useState<GameOutcome | null>(null);
  // Rolling history of full-move counts so the panel can show an average.
  const [autoMoveHistory, setAutoMoveHistory] = useState<number[]>([]);
  const [autoStopped, setAutoStopped] = useState(false);
  const [autoStoppedReason, setAutoStoppedReason] = useState<string | null>(null);
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
  // QA-11 — WHO is resigning while the confirmation is up. In hot-seat
  // either seat has a Resign button, so it is not always the side to move.
  const [confirmingResign, setConfirmingResign] = useState<Color | null>(null);
  // The game on the board (src/session): the position, the log, the
  // status, the roulette turn, the pending promotion and the hot-seat
  // draw offers. Solo and hot-seat play change it only through
  // session.dispatch; online play reads its match instead (the aliases
  // below). The draw offers are never saved: hot-seat stores nothing
  // beyond the Memory entry.
  const sess = useSession((s) => s);
  // A session listener that threw (the turns, a service) throws here, so
  // AppErrorBoundary shows the error screen instead of a dead board.
  useSessionFatal();
  // Sprint 4.3.1 — pending opponent switch during an active local game.
  // When non-null the ConfirmDialog mounts; on confirm we discard the
  // local game state and start fresh in the requested mode.
  const [pendingOpponentChange, setPendingOpponentChange] = useState<
    'ai' | 'friend' | 'local' | null
  >(null);
  const [savingGame, setSavingGame] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [currentRank, setCurrentRank] = useState<number | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [personalBest, setPersonalBest] = useState<number | null>(null);
  const [lastGameId, setLastGameId] = useState<string | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [milestoneShown, setMilestoneShown] = useState(false);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  // Sprint 2.5 — local AFK detector. Independent of the MP afk-watchdog
  // (mpSync.selfAfkWarning) which forfeits the match after 30s; this one
  // is a UX nag that surfaces a pulsing banner when the player's been
  // idle on their own turn for 20s. Resets on any pointer / key activity.
  const [showAfkAlert, setShowAfkAlert] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  const completedLogIdRef = useRef<string | null>(null);
  // QA-02 — the log id of a game that came from Load replay (or a Memory
  // entry marked imported). Such a game is never ranked.
  const importedLogIdRef = useRef<string | null>(null);
  // N-1 — the game on the board was picked up from Memory (or from a live
  // session that was already unranked), not played start to finish here as
  // a bot game. A reload of an ordinary solo bot game is not marked. Same shape as the
  // imported mark above: keyed by log id, so any new game clears it. It is
  // separate because the Memory entry's `imported` flag must keep meaning
  // "pasted from a log" — the summary says which of the two it was.
  const resumedLogIdRef = useRef<string | null>(null);
  // Whether the game the summary is about was imported (for its wording).
  const [lastGameImported, setLastGameImported] = useState(false);
  const [lastGameResumed, setLastGameResumed] = useState(false);
  const [view, setView] = useState<
    'game' | 'review' | 'leaderboard' | 'friend-lobby'
  >('game');
  // Stage Q.A: opponent selector in the header. 'ai' keeps the existing
  // solo flow; 'friend' opens the PvP lobby. Once a match starts it just
  // overlays the existing 'game' view — the board/log/header reuse the
  // single-player UI, only the data source flips.
  const [opponentMode, setOpponentMode] = useState<'ai' | 'friend' | 'local'>('ai');
  // Q.B.2: active PvP match handshake. When non-null, the rest of App
  // sources its board / log / turn state from useMultiplayerSync below
  // instead of the local engine.
  const [activeMatch, setActiveMatch] = useState<MatchDoc | null>(null);
  // Match-completion modal state (separate from the AI GameSummary which
  // is points-driven and doesn't fit the PvP shape).
  const [mpEndOutcome, setMpEndOutcome] = useState<MatchOutcome | null>(null);
  // R13b — reconnect after a refresh. The active match code is read ONCE
  // at mount (the persistence effect below clears the key whenever
  // activeMatch is null, so reading it lazily later would lose the race).
  const mpResumeCodeRef = useRef<string | null>(
    (() => {
      try {
        return localData.get(LOCAL_KEYS.mpActive);
      } catch {
        return null;
      }
    })(),
  );
  const mpSavedGameIdRef = useRef<string | null>(null);
  const mpWroteOutcomeRef = useRef<string | null>(null);
  // QA-04 — the match code this player resigned themselves (the Resign
  // button, not a flag fall), so their own end text can say so.
  const mpSelfResignedRef = useRef<string | null>(null);
  // T2: review can be entered for the LIVE game (default — reads the `log`
  // alias) OR with a snapshot loaded via the MP completion modal or the
  // ?game=<id> URL. activeReviewLog overrides when set; meta gives the
  // review header context ("Alex vs AI", "won/lost/drew").
  const [activeReviewLog, setActiveReviewLog] = useState<GameLog | null>(null);
  const [activeReviewMeta, setActiveReviewMeta] =
    useState<GameReviewMeta | null>(null);
  const [sharedGameError, setSharedGameError] = useState<string | null>(null);
  const { mpSync, isMultiplayer } = useOnlineMatch({
    user,
    setView,
    setOpponentMode,
    activeMatch,
    setActiveMatch,
    setMpEndOutcome,
    mpEndOutcome,
    mpResumeCodeRef,
    mpSavedGameIdRef,
    mpWroteOutcomeRef,
    // Declared further down; the hook only calls it from callbacks, which
    // run after this render, so a wrapper is enough to reach it.
    setMobilePanel: (v) => setMobilePanel(v),
    startNewGame,
  });

  const [watchingGame, setWatchingGame] = useState<WatchingGame | null>(null);
  const watchAutoplayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameBackupRef = useRef<GameBackup | null>(null);
  // V1 — every visit starts from a fresh chess960 position (FIRST_SEED in
  // src/session/session.ts).
  const seed = sess.seed;
  // The game on the board: the online match's while one is on (its
  // document, as the session last read it: session/online.ts), else the
  // solo or hot-seat game. The rest of App reads it through these names.
  const online = isMultiplayer ? sess.online?.game ?? null : null;
  const state: BoardState = online ? online.board : sess.board;
  const initialState = sess.initial;
  const [selected, setSelected] = useState<string | null>(null);
  const legalMoves = (online ? online.legal : sess.legal) as Move[];
  const log: GameLog = online ? online.log : sess.log;
  const gameStatus = statusOf(sess);
  const [previewTopology, setPreviewTopology] = useState<TopologyState | null>(null);
  const lastMove: { from?: SquareId; to?: SquareId } | null = online ? online.lastMove : sess.lastMove;
  const { mobilePanel, setMobilePanel, closeMobilePanel } = useMobileDrawers();

  const [showHelp, setShowHelp] = useState(false);
  const {
    showTutorial,
    setShowTutorial,
    showWelcome,
    dismissWelcome,
    closeTutorial,
  } = useOnboarding();
  /* V1 — busy overlay. Some transitions (leaving a replay, loading a saved
   * game) do their work inside one React commit, so the tab simply stops
   * repainting for a moment and reads as a hang. beginBusy paints a labelled
   * spinner first and clears it after the browser has had two frames plus a
   * short beat, which is long enough for the commit to land and short enough
   * that a fast machine sees a deliberate blink, not a stutter. */
  // V1 — the overlay itself lives in src/ui/busy.ts and is mounted next to
  // <App/>, so it exists on every screen, not only the board.
  const beginBusy = useCallback((label: string) => busy.begin(label), []);

  const [copied, setCopied] = useState(false);
  // Sprint 3.7 (rev 2) — Threat / Support toggles restored after the
  // 3.6 hover-insight experiment didn't stick. Manual toggles read
  // more like deliberate training aids than a hover gimmick.
  const [showThreats, setShowThreats] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  // S2.4 — master switch for the coaching tools (support / threat / hint).
  // Players who want "pure" chess can collapse the whole group; persisted
  // so the choice survives reloads.
  const [helpToolsEnabled, setHelpToolsEnabled] = useState<boolean>(() => {
    try {
      return localData.get(LOCAL_KEYS.helpTools) !== '0';
    } catch {
      return true;
    }
  });
  // S2.4 — engine hint: best move for the current position, shown as a
  // pulsing from→to pair on the board. Cleared whenever the position
  // changes. `rotate: true` means the engine recommends Rotate itself.
  const [hintMove, setHintMove] = useState<
    { from: SquareId; to: SquareId } | { rotate: true } | null
  >(null);
  const {
    showTwitch,
    setShowTwitch,
    twitchVoteMode,
    voteRound,
    guessCloud,
    settleGuessRound,
    settleGuessRotate,
  } = useTwitchState();
  const { showMusicDock, setShowMusicDock, vizOn, bgGridOn } = useMusicState();
  // The streaming integrations (music, Twitch): null until loaded, and
  // always without STREAMING_UI.
  const live = useStreaming();
  // Stitch layout: optional solo time control in seconds.
  // null = free play (chips keep showing elapsed). With a value the chips
  // show remaining = tc - elapsed, floored at 0. Display-only in solo.
  const soloTcSec = useSession((s) => s.timeControlSec);
  const { botLevel, botLevelRef, setBotLevel } = useBotLevel();
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
  // Online the picker belongs to the match, not to the solo session.
  const [mpPendingPromotion, setMpPendingPromotion] = useState<{
    from: SquareId;
    to: SquareId;
  } | null>(null);
  const pendingPromotion: { from: SquareId; to: SquareId } | null = isMultiplayer
    ? mpPendingPromotion
    : sess.phase.tag === 'promotion'
      ? sess.phase
      : null;
  // PvP gameMode flows from the match doc — host picks it at create time.
  // Q.D.2: the SAME solo roulette UI/logic reads gameMode, the bag and
  // what is left of it from the game on the board, solo or online.
  const gameMode: GameMode = online ? online.mode : sess.mode;
  // Q.D.8: roulette is now a capture-the-king variant — no check enforcement.
  // Every legal-move query routes through this wrapper so the option flips
  // automatically based on mode. Classic mode always returns the strict
  // check-respecting set; roulette returns pseudo-legal verbatim.
  function getLegalMoves(s: BoardState): Move[] {
    return generateLegalMoves(s, { allowSelfCheck: gameMode === 'roulette' });
  }
  // The roulette turn (src/session/types.ts RouletteState): the spun bag
  // and what is left of it, and whether the wheel is turning. Online, the
  // live match doc carries the full 4-slot bag, action counter and used
  // slot indices, so the same solo UI (Spin button, slot chips, "Move a
  // knight" hint) renders verbatim in PvP roulette.
  // While a bag lands (session RouletteReveal, the solo game's or the
  // online match's) it is not the bag yet: the panel shows it slot by slot,
  // nothing is lit and nothing can be picked until it has landed.
  const rouletteBag = sess.roulette.bag;
  const rouletteReveal = isMultiplayer ? sess.online?.reveal ?? null : sess.roulette.reveal;
  const allowedPieceTypes = (
    online ? (rouletteReveal ? null : online.slots) : rouletteBag?.slots ?? null
  ) as PieceType[] | null;
  const isRouletteSpinning = rouletteReveal !== null || sess.phase.tag === 'rouletteSpin';
  const rouletteActionsLeft = online ? online.actionsLeft : rouletteBag?.actionsLeft ?? 0;
  const usedRouletteSlots = (online ? online.used : rouletteBag?.used ?? NO_SLOTS) as number[];
  // First roulette spin per game requires a manual click on the Spin
  // Roulette button. Subsequent spins auto-fire via a useEffect after a
  // short delay. Online, my spin count off the match doc, so both players
  // track independently across reloads.
  const firstRouletteSpinDone = online ? online.firstSpinDone : sess.roulette.firstSpinDone;
  const {
    captureFxSquare,
    setCaptureFxSquare,
    captureShake,
    setCaptureShake,
    captureStrobe,
    setCaptureStrobe,
    rotationDust,
    setRotationDust,
    checkVignette,
    setCheckVignette,
    fxIntensity,
    registerFx,
    victoryFreeze,
    setVictoryFreeze,
    victoryFreezeTimer,
    enPassantExplosionSquare,
    setEnPassantExplosionSquare,
  } = useBoardFxState();

  const formationInputRef = useRef<HTMLInputElement>(null);
  // SP-3 — true while a Beat-Mode move is queued to land on the next
  // beat; blocks board input so the snap can't be raced.
  const beatSnapPendingRef = useRef(false);
  // M.12 — the queued snap target (from/to + ms to the beat) so the UI
  // can show a ring filling to the beat for a crisp, on-beat landing.
  const [beatSnap, setBeatSnap] = useState<{ from: SquareId; to: SquareId; ms: number } | null>(null);
  // Stage P addendum 7: wall-clock when the current game began. Used to
  // compute durationMs on save. Set in startNewGame (and on initial mount
  // for the first game).
  const gameStartedAtRef = useRef<number>(Date.now());
  const savedForLogIdRef = useRef<string | null>(null);
  const liveSavedGameIdRef = useRef<string>(
    `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  const {
    searchEvalFromWhite,
    setSearchEvalFromWhite,
    searchMateInPlies,
    setSearchMateInPlies,
    currentEval,
    myColor,
    myPerspectiveEval,
    prevEvalRef,
  } = useEval({ isMultiplayer, mpSync, state });
  // The element whose CSS variables drive the gradient. Setting via ref
  // (rather than inline style) so React doesn't churn the style object every
  // render and break the @property transition.
  const shellRef = useRef<HTMLDivElement>(null);
  // Worker-backed classify can resolve AFTER subsequent moves have been
  // played — we read this ref in each .then() to decide whether the analysis
  // is still "current" (visuals fire) or stale (log patched, visuals skipped).
  const logLengthRef = useRef<number>(0);

  const { dock, uiScale, pickUiScale, boardSize } = useBoardSize();

  // R5 — encouragement in a losing position.
  const toast = useToast();

  usePresenceHeartbeat({ user, displayName });

  // V1 — the solo time-control flag-fall effect lives further down, right
  // after `isLocalMode` is declared (TDZ: hooks here can't read it yet).
  const encourageBadStreakRef = useRef(0);
  const encourageLastMoveRef = useRef(-99);
  const encourageCheckedMoveRef = useRef(-1);
  const [encourageRotate, setEncourageRotate] = useState(false);
  // R15 step 4-lite — one-shot-per-game coaching beats, deduped by log.id
  // (fresh id per game, survives re-renders).
  const earlyTipLogIdRef = useRef<string | null>(null);
  const rotateTipLogIdRef = useRef<string | null>(null);

  // R6 — worst eval the human faced this game (most negative from white's
  // side). A tense, come-from-behind win triggers the victory cinematic.
  const worstHumanEvalRef = useRef(0);
  // V1 — the endgame cut currently on screen (win or loss), or null.
  // `king` is where the losing king stood, in viewport pixels, so the
  // cinematic can start by lifting THAT piece off THAT square; `prelude`
  // is the dark lead-in the scene has to play itself when the checkmate
  // iris did not already black the room out.
  // The launcher lives further down, next to mateKingPos — it needs the
  // king's board position and that is declared around line 4400 (TDZ).
  const [endgameCut, setEndgameCut] = useState<{
    kind: EndgameKind;
    theme: VictoryTheme;
    king: KingOrigin | null;
    prelude: number;
  } | null>(null);
  useEffect(() => {
    if (searchEvalFromWhite !== null && searchEvalFromWhite < worstHumanEvalRef.current) {
      worstHumanEvalRef.current = searchEvalFromWhite;
    }
  }, [searchEvalFromWhite]);
  useConsoleSeams({
    setCheckVignette,
    setCaptureStrobe,
    setRotationDust,
    toast,
    setEncourageRotate,
  });

  useEffect(() => {
    if (formationInputMode) formationInputRef.current?.focus();
  }, [formationInputMode]);

  useMemoryAutosave({
    importedLogIdRef,
    resumedLogIdRef,
    opponentMode,
    isMultiplayer,
    gameStatus,
    soloTcSec,
    botLevel,
    gameMode,
    state,
    log,
    savedForLogIdRef,
    liveSavedGameIdRef,
  });

  // Game-completion pipeline: the session's gameEnd event, handled after the
  // render that shows the ending, computes points, opens the GameSummary
  // modal, and kicks the async Firestore save.
  // The ref guards against double-fires (StrictMode, a game ending twice).
  // Auto mode handles completion via its own effect — never enters this path.
  useSessionEventsAfterCommit((events) => {
    if (!events.some((e) => e.type === 'gameEnd')) return;
    if (isAutoMode) return;
    if (isMultiplayer) return; // MP completion runs through a separate effect
    // R13/BUG-5 — local hot-seat is two humans on one device: its results
    // must never reach finishGame (solo leaderboard, personal best,
    // "human-win" attribution are all meaningless there). The game-over
    // banner is the whole ending.
    if (isLocalMode) return;
    if (gameStatus === 'active') return;
    if (log.moves.length === 0) return;
    // One completion per game, keyed by the log id alone. Resign stamps the
    // id itself before flipping the status, so it is skipped here too. This
    // used to also bail on any gameOutcome, which leaked the previous
    // game's ending into the next one (QA-01).
    if (completedLogIdRef.current === log.id) return;
    completedLogIdRef.current = log.id;

    void finishGame(soloOutcome(gameStatus, state.sideToMove));
  });

  // A spin with nothing to do passes the turn as it lands: drop the
  // selection it left (it used to be dropped in doSpinRouletteNow's timer).
  useSessionEventsAfterCommit((events) => {
    if (events.some((e) => e.type === 'rouletteSpin' && e.slots === null)) setSelected(null);
  });

  useOnlineMatchEnd({
    user,
    mpEndOutcome,
    setMpEndOutcome,
    mpSavedGameIdRef,
    mpWroteOutcomeRef,
    isMultiplayer,
    mpSync,
    toast,
  });

  useDrawDeclinedToast({ isMultiplayer, mpSync, toast });

  useSharedGame({
    sharedGameId,
    setView,
    setActiveReviewLog,
    setActiveReviewMeta,
    setSharedGameError,
  });

  async function finishGame(outcome: GameOutcome) {
    const computed = computeGamePoints(log, outcome, HUMAN_COLOR, gameMode);
    // V1 — only full-strength games are ranked. Practice levels still get
    // the full breakdown on screen and are saved (with their level) for the
    // data pipeline, but never touch personal best / leaderboard stats.
    const rankedLevel = botLevel === 'strong';
    // QA-02 — nor is a game loaded from a pasted log, at any level: its
    // moves were never played here. counted: false also keeps strongWins
    // (gated on counted in saveCompletedGame) from growing.
    const imported = importedLogIdRef.current === log.id;
    setLastGameImported(imported);
    // N-1 — nor is a game restored from Memory. A Memory entry does not say
    // who the moves were played against: a position played out for both
    // sides in Local can be resumed against the bot and won in a move.
    const resumed = resumedLogIdRef.current === log.id;
    setLastGameResumed(resumed);
    const points: GamePoints =
      rankedLevel && !imported && !resumed ? computed : { ...computed, counted: false };
    const durationMs = Date.now() - gameStartedAtRef.current;
    setGameOutcome(outcome);
    setLastGamePoints(points);
    setLastGameDurationMs(durationMs);
    setSummaryOpen(true);
    setSaveError(null);
    setIsNewBest(false);
    setCurrentRank(null);

    const job: FinishedGameSave = {
      outcome,
      points,
      durationMs,
      log,
      gameMode,
      botLevel,
      chess960Id: positionLabel,
      seed,
    };
    if (!user || !displayName) {
      // N-6 — the page has only just opened (a reload, a new tab) and the
      // sign-in has not answered yet: the game on the board came back from
      // Memory in ~0.2 s, the user takes a moment longer, and a game that
      // ends in between used to show its summary and never be saved (this
      // runs once per game). Keep the finished game and save it as soon as
      // the sign-in resolves. Signed out for good / no name yet: show the
      // summary locally and skip Firestore, as before.
      if (authLoading) {
        pendingSaveRef.current.push(job);
        setSavingGame(true);
      }
      return;
    }
    await queueSave(job, user.uid, displayName);
  }
  const { queueSave, pendingSaveRef } = useGameSaveQueue({
    authLoading,
    user,
    displayName,
    setSavingGame,
    setSaveError,
    setCurrentRank,
    setIsNewBest,
    setPersonalBest,
    setLastGameId,
    completedLogIdRef,
  });

  const { stopAuto } = useAutoPlay({
    isAutoMode,
    maxGames,
    setAutoGamesCompleted,
    autoGamesCompleted,
    setAutoLastOutcome,
    setAutoMoveHistory,
    autoStopped,
    setAutoStopped,
    setAutoStoppedReason,
    autoNextGameTimerRef,
    autoLastMoveAtRef,
    autoSavedLogIdRef,
    seed,
    initialState,
    gameStatus,
    state,
    log,
    gameStartedAtRef,
    startNewGame,
  });

  async function startWatching(gameId: string, playerName: string) {
    // S2.1 — while a multiplayer match is live, the board is driven by
    // mpSync.boardState, so the replay projection below would clobber
    // log/gameStatus while the board keeps showing the match: a
    // split-brain. The Leaderboard disables Watch in that case; this is
    // the backstop.
    if (isMultiplayer) return;
    // A game that cannot be shown says so on the board, as a broken
    // ?game=<id> link does (the same banner), instead of nothing at all.
    const refuse = (message: string) => {
      setSharedGameError(message);
      setView('game');
    };
    try {
      const saved = await gamesRepo.fetchSaved(gameId);
      if (!saved) {
        console.warn('[watch] game not found', gameId);
        refuse('Game not found.');
        return;
      }
      const replayLog = deserializeGameLog(saved);
      // Every frame is projected again as the replay is stepped through
      // (seekWatchTo, inside a state update), where a log entry the board
      // cannot be built from threw in render and took the app to the error
      // screen. Build the whole replay once, here, where that is caught.
      replayBoardAt(replayLog, replayLog.moves.length);

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

      if (watchAutoplayRef.current) clearTimeout(watchAutoplayRef.current);

      // Project frame 0 of the replay.
      const projected = replayBoardAt(replayLog, 0);
      session.dispatch({
        type: 'load',
        game: {
          board: projected,
          initial: replayLog.initialState,
          seed: replayLog.randomSeed,
          log: { ...replayLog, moves: [] },
          status: 'active',
          lastMove: null,
        },
      });
      setSelected(null);
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
      refuse('Could not load this game.');
    }
  }

  // Called from the transport buttons and the autoplay timer, both with
  // the watched game of their render.
  function seekWatchTo(idx: number) {
    const cur = watchingGame;
    if (!cur) return;
    const clamped = Math.max(0, Math.min(idx, cur.log.moves.length));
    const projected = replayBoardAt(cur.log, clamped);
    const lastEntry = clamped > 0 ? cur.log.moves[clamped - 1] : null;
    session.dispatch({
      type: 'load',
      game: {
        board: projected,
        log: { ...cur.log, moves: cur.log.moves.slice(0, clamped) },
        lastMove:
          lastEntry && lastEntry.move.from && lastEntry.move.to
            ? { from: lastEntry.move.from, to: lastEntry.move.to }
            : null,
      },
      replayStep: true,
    });
    setSelected(null);
    setWatchingGame((w) => (w ? { ...w, currentMoveIdx: clamped } : w));
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
    // V1 — restoring the paused game re-derives the board, legal moves and
    // eval in one commit, which can visibly stall on a slow machine. Cover
    // it so the app never looks frozen with no explanation.
    beginBusy('Restoring your game');
    setWatchingGame(null);
    if (!backup) return;

    session.dispatch({
      type: 'load',
      game: {
        seed: backup.seed,
        board: backup.state,
        initial: backup.initialState,
        legal: backup.legalMoves,
        log: backup.log,
        status: backup.gameStatus,
        lastMove: backup.lastMove,
      },
    });
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

  /** QA-11 — `side` is the seat whose Resign was pressed (hot-seat has
   *  one per player). Solo it is always the human; online the match knows. */
  function requestResign(side?: Color) {
    if (watchingGame) return;
    if (isMultiplayer) {
      if (!mpSync || mpSync.matchState.status !== 'active') return;
      setConfirmingResign(mpSync.myColor);
      return;
    }
    if (gameStatus !== 'active') return;
    if (log.moves.length === 0) return;
    // Solo, the bot's move is in flight: resigning now would race it (the
    // move still landed afterwards). The button is disabled meanwhile.
    if (botThinking) return;
    setConfirmingResign(isLocalMode ? side ?? state.sideToMove : HUMAN_COLOR);
  }

  function confirmResign() {
    const side = confirmingResign;
    setConfirmingResign(null);
    // PvP resign: route through the match doc so the opponent sees the
    // status flip; their listener will mirror the outcome. Local engine
    // state stays untouched (gameStatus etc.).
    if (isMultiplayer) {
      if (!mpSync) return;
      // Remembered only if this resignation is what ended the match: a
      // failed write, or a flag fall that landed first, is not one.
      const code = mpSync.matchState.code;
      mpSelfResignedRef.current = code;
      void mpSync.resign().then((wrote) => {
        if (!wrote && mpSelfResignedRef.current === code) mpSelfResignedRef.current = null;
      });
      return;
    }
    if (!side || gameStatus !== 'active' || botThinking) return;
    // Stamped before the status flips, so the completion effect skips it.
    completedLogIdRef.current = log.id;
    session.dispatch({ type: 'resign', side });
    // R13/BUG-5 — hot-seat resign: either seat may press it, so a solo
    // "human-resign" record would blame the wrong player half the time.
    // Just end the game; the banner is the ending, nothing is saved.
    if (isLocalMode) return;
    setGameOutcome('human-resign');
    void finishGame('human-resign');
  }

  /** Hot-seat: the draw offers of the game on the board. */
  function localDrawTable(): DrawTable<Color> {
    return drawTableOf(sess);
  }

  /** Hot-seat: `side` offers a draw; the other seat sees it on its side. */
  function offerLocalDraw(side: Color) {
    if (!isLocalMode || gameStatus !== 'active') return;
    const table = localDrawTable();
    if (!canOfferDraw(table, side, log.moves.length)) return;
    // The move landing on the beat would retire the offer at once and
    // leave `side` waiting for its own next move.
    if (beatSnapPendingRef.current) {
      toast.show('A move is landing on the beat. Offer the draw once it has.', 'info', 2400);
      return;
    }
    session.dispatch({ type: 'offerDraw', side });
  }

  /** Hot-seat: `side` answers the offer standing against it. */
  function answerLocalDraw(side: Color, accept: boolean) {
    if (!isLocalMode || gameStatus !== 'active') return;
    const table = localDrawTable();
    if (!canAnswerDraw(table.offer, side, log.moves.length)) return;
    // A move already on its way to the beat (music sync) lands first, and
    // a move retires the offer: there is nothing left to answer.
    if (beatSnapPendingRef.current) {
      toast.show('A move is landing on the beat. It takes the offer off the table.', 'info', 2400);
      return;
    }
    if (!accept) {
      session.dispatch({ type: 'answerDraw', side, accept: false });
      toast.show(`${side === 'white' ? 'White' : 'Black'} declined the draw.`, 'info', 2400);
      return;
    }
    // Stamped before the status flips, like a resignation (nothing saves).
    completedLogIdRef.current = log.id;
    setSelected(null);
    session.dispatch({ type: 'answerDraw', side, accept: true });
  }

  useRoomGradient({
    view,
    activeMatch,
    state,
    myPerspectiveEval,
    prevEvalRef,
    currentEval,
    shellRef,
  });

  const { logIdRef, classifyRunRef } = useClassifyGuards({ log, logLengthRef });

  useWatchAutoplay({ watchingGame, setWatchingGame, watchAutoplayRef, seekWatchTo });

  useAdaptiveTheme({ state });

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

  useMoveMilestones({
    isAutoMode,
    milestoneShown,
    setMilestoneShown,
    setShowMilestoneModal,
    opponentMode,
    isMultiplayer,
    watchingGame,
    gameStatus,
    log,
    toast,
  });

  // Square to pulse-highlight after a blunder/brilliant. Cleared after the
  // animation duration (4 cycles × 600ms = 2.4s, rounded to 2500).
  const [classifiedSquare, setClassifiedSquare] = useState<{
    square: SquareId;
    classification: 'blunder' | 'brilliant';
  } | null>(null);
  const classifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sprint 2.7 — separate "sacrifice" highlight, fires in parallel with
  // the brilliant flag when analysis flags the move as a true sacrifice
  // (piece walked onto attacked square + position still holds). Distinct
  // visual (violet burst + sparkles) so a sacrifice reads differently
  // from an ordinary tactical brilliancy.
  const [sacrificeSquare, setSacrificeSquare] = useState<SquareId | null>(null);
  const sacrificeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useAdaptiveMusic({
    watchingGame,
    gameStatus,
    state,
    currentEval,
    searchMateInPlies,
    myPerspectiveEval,
    sacrificeSquare,
  });
  const { moveLogScrollRef } = useMoveLogScroll({ log });

  const { rotateHintShown, showRotateHint, dismissRotateHint } = useRotateHint({ gameStatus });

  // Sprint 3.4.1 — captures no longer trigger their own visual burst.
  // The per-take flash from Sprint 3.2 fired too often and read as
  // noise; only the classifier reactions (?? shake / !! sparkles) and
  // the en-passant explosion remain. The captureSquare state and the
  // log-length useEffect that drove it have been removed.

  // Sprint 3.6 — right-click annotations (chess.com / lichess style).
  // Right-click a square to highlight it (cycles colour by modifier:
  // none=green, shift=red, alt=yellow, ctrl/meta=blue). Right-drag
  // from one square to another draws an arrow in the same colour
  // scheme. Repeat the same gesture with the same colour to clear.
  // All annotations clear automatically when a move is played — they
  // are a per-position scratch pad, not a persistent layer.
  const [squareAnnotations, setSquareAnnotations] = useState<Map<SquareId, AnnotationColor>>(
    () => new Map(),
  );
  const [arrowAnnotations, setArrowAnnotations] = useState<ArrowAnnotation[]>([]);
  const annotationStartRef = useRef<SquareId | null>(null);
  const { flashEffect, sparklePositions, commitAnalysis, classifyImportedLog } = useClassifier({
    setSearchEvalFromWhite,
    setSearchMateInPlies,
    shellRef,
    logLengthRef,
    logIdRef,
    classifyRunRef,
    setClassifiedSquare,
    classifyTimerRef,
    setSacrificeSquare,
    sacrificeTimerRef,
  });

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
    const initial = createPositionFromBackRankKey(raw);
    // A new log, named after now; the seed stays (the code names the board).
    session.dispatch({ type: 'newGame', initial, now: Date.now() });
    setSelected(null);
    setPreviewTopology(null);
    setFormationLocked(true);
    setLockedFormationKey(raw);
    setFormationInputMode(false);
    setFormationInputValue('');
    setSearchEvalFromWhite(null);
    setSearchMateInPlies(null);
    resetGameEndState();

    // New play session => new live snapshot id.
    liveSavedGameIdRef.current = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function cancelFormationInput() {
    setFormationInputMode(false);
    setFormationInputValue('');
  }

  /**
   * V1 — blur means "I'm done", so it must always leave the editor.
   *
   * `applyFormationCode` returns early on an invalid code without
   * clearing the mode, which used to keep the field open forever. That
   * was survivable while a separate "Set position" button existed; now
   * that the code chip IS the control and the only place the starting
   * rank is shown, a stuck editor hides the position behind a half-typed
   * string. Clicking away on garbage just gives up, like Escape.
   */
  function commitFormationOnBlur() {
    const raw = formationInputValue.trim().toUpperCase();
    if (raw && !isValidChess960Key(raw)) {
      cancelFormationInput();
      return;
    }
    applyFormationCode();
  }

  const tileBase = boardSize / 8;

  /** V1 — the rook's half of the last castle, so it glides like the king
   *  does instead of jumping. Null unless the latest move was a castle
   *  whose rook actually changed square (in Chess960 it may not). */
  const castleRookSlide = useMemo(() => {
    const last = log.moves[log.moves.length - 1]?.move;
    if (!last || last.kind !== 'castle' || !last.castleRookFrom || !last.castleRookTo) {
      return null;
    }
    if (last.castleRookFrom === last.castleRookTo) return null;
    if (!lastMove || lastMove.to !== last.to) return null; // stale log vs board
    return { from: last.castleRookFrom, to: last.castleRookTo };
  }, [log.moves, lastMove]);

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
    // The first click of the game is the manual spin: after it the
    // auto-spin effect takes over on subsequent turns.
    doSpinRouletteNow(true);
  }

  function doSpinRouletteNow(manual = false) {
    // v1.1.6: the roll is made as the wheel starts and lands slot by slot,
    // one every 400 ms with a beat each (session/reveal.ts times it,
    // services/spinSounds.ts sounds it); the turn waits until it has.
    session.dispatch({ type: 'spinStart', now: Date.now(), manual });
  }

  /** The ending this board is in under the current mode's rules, if any. */
  function boardEnding(
    nextState: BoardState,
    lastMoveWasRotation: boolean = false,
  ): Exclude<GameStatus, 'active'> | null {
    return gameEnding(gameMode, nextState, lastMoveWasRotation);
  }

  function startNewGame() {
    // Reset the transposition table so positions from the previous game can't
    // bias the new search. (TT is reused across moves WITHIN one game.)
    clearSearchTable();
    const newSeed = Date.now();
    const initial =
      formationLocked && lockedFormationKey
        ? createPositionFromBackRankKey(lockedFormationKey)
        : createStartingPosition(newSeed);
    session.dispatch({ type: 'newGame', initial, now: newSeed, seed: newSeed });
    setSelected(null);
    savedForLogIdRef.current = null;
    setPreviewTopology(null);
    setSearchEvalFromWhite(null);
    setSearchMateInPlies(null);
    resetGameEndState();
    autoSavedLogIdRef.current = null;
    autoLastMoveAtRef.current = Date.now();

    // New play session => new live snapshot id.
    liveSavedGameIdRef.current = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * QA-01 — everything the previous game left behind.
   *
   * Every way into a new board (New game, a 960 code, Load replay, a Memory
   * resume) calls this. Only New game used to, so after a closed summary a
   * game started any other way inherited the old gameOutcome and finished
   * with no summary and no save.
   *
   * N-3 — that includes Roulette's turn state (the spun pieces, the
   * actions left, whether the first spin was done). A 960 code or a Load
   * replay used to keep the last game's spin on a fresh board, with no
   * Spin button and nothing the spun pieces could move. That state is the
   * session's now: a new game and a fresh load clear it (step.ts).
   */
  function resetGameEndState() {
    worstHumanEvalRef.current = 0; // R6 — reset the tense-win detector
    setEndgameCut(null);
    if (victoryFreezeTimer.current) clearTimeout(victoryFreezeTimer.current);
    setVictoryFreeze(false);
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
    setLastGameImported(false);
    setLastGameResumed(false);
    completedLogIdRef.current = null;
    gameStartedAtRef.current = Date.now();
  }

  // S2.4 — any change to the position invalidates a shown hint.
  useEffect(() => {
    setHintMove(null);
  }, [sess.log.moves.length, state.topologyState, gameStatus]);

  const { mpMatchLive, mpClock } = useGameClocks({
    isMultiplayer,
    mpSync,
    watchingGame,
    soloLog: sess.log,
    gameStatus,
  });

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
    // Sprint 4.1 — first actual rotation dismisses the hint for good.
    if (!rotateHintShown) dismissRotateHint();

    // Multiplayer: send a topologyToggle move through Firestore — the
    // opponent's listener re-derives the board (rebuildBoardFromMatch
    // skips toggle entries today; T1 unblocks them once Q.B.2 picks them
    // up via the same applyRotationMove path). King-safety check first
    // so we don't push an illegal rotation across the wire.
    if (isMultiplayer && mpSync) {
      if (mpSync.matchState.status !== 'active') return;
      if (!mpSync.isMyTurn) return;
      if (rouletteReveal) return; // the bag is still landing
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
    // Classic: the king must stay safe and the rotation is the whole turn.
    // Roulette: it costs one action of the spun bag and spends no slot.
    // The rules are step()'s (src/session/step.ts rotate).
    const events = turns.act({ type: 'rotate', actor: 'human', now: Date.now() });
    if (events.length === 0) return;
    setSelected(null);
    setPreviewTopology(null);
    // R10 — the streamer rotated: settle the chat's guess round.
    if (gameMode !== 'roulette') settleGuessRotate();
  }

  // In MP currentPlayer reflects whose turn it is from MY seat: 'human' when
  // I can act, 'ai' otherwise. Keeping the same vocabulary lets the existing
  // canRotate / scheduler / UI-disable code work unchanged.
  // Sprint 4.1 — `local` opponent mode means both colours are played
  // from this device, so the engine should never schedule an AI turn.
  // Cached here so the AI scheduler, classifier, and downstream UI
  // can short-circuit on a single flag.
  // V1 — a replay is nobody's hot-seat game. Without `!watchingGame`, a
  // replay started while "Local" was selected rendered the mirrored top
  // controls and flipped the board for "black's turn" in someone else's
  // game. The opponent choice is kept, so stopping the replay brings the
  // hot-seat UI straight back.
  const isLocalMode = opponentMode === 'local' && !isMultiplayer && !watchingGame;

  // Hot-seat draw offers: what each seat's button says, and whose row the
  // answer prompt replaces while an offer stands. Only while the game
  // runs: an accepted offer is still "standing" on the final ply.
  const localDrawOpen = isLocalMode && gameStatus === 'active';
  const localStandingDraw = localDrawOpen
    ? standingDrawOffer(localDrawTable().offer, log.moves.length)
    : null;
  const localWhiteAnswers = localStandingDraw?.by === 'black';
  const localBlackAnswers = localStandingDraw?.by === 'white';
  const localWhiteBlock = localDrawOpen ? drawOfferBlock(localDrawTable(), 'white', log.moves.length) : null;
  const localBlackBlock = localDrawOpen ? drawOfferBlock(localDrawTable(), 'black', log.moves.length) : null;

  // The draw offer of the bottom row: white's seat in hot-seat, my own
  // seat online (the match doc holds the offer, the hook my lock).
  const mpDrawOpen =
    isMultiplayer && !!mpSync && mpSync.matchState.status === 'active' && !mpSync.matchState.outcome;
  const mpPlies = mpSync?.matchState.log.moves.length ?? 0;
  const mpStandingDraw = mpDrawOpen ? standingDrawOffer(mpSync!.drawTable.offer, mpPlies) : null;
  const rowDraw: {
    open: boolean;
    block: DrawOfferBlock | null;
    answers: boolean;
    opponent: string;
    busy: boolean;
    offer: () => void;
    answer: (accept: boolean) => void;
  } | null = isLocalMode
    ? {
        open: localDrawOpen,
        block: localWhiteBlock,
        answers: localWhiteAnswers,
        opponent: 'Black',
        busy: false,
        offer: () => offerLocalDraw('white'),
        answer: (accept) => answerLocalDraw('white', accept),
      }
    : isMultiplayer && mpSync
      ? {
          open: mpDrawOpen,
          block: mpDrawOpen ? drawOfferBlock(mpSync.drawTable, mpSync.myUid, mpPlies) : null,
          answers: !!mpStandingDraw && mpStandingDraw.by !== mpSync.myUid,
          opponent: mpSync.opponentDisplayName,
          busy: mpSync.drawBusy,
          offer: () => void mpSync.offerDraw(),
          answer: (accept) => void mpSync.answerDraw(accept),
        }
      : null;

  useSoloFlagFall({
    isAutoMode,
    completedLogIdRef,
    isMultiplayer,
    watchingGame,
    setSelected,
    toast,
    isLocalMode,
  });
  // Local hot-seat's own "game over" modal dismiss flag (see the render
  // site near the MP completion dialog). Reset per game via the effect
  // below, keyed on log.id like the other one-shot-per-game flags in
  // this file (earlyTipLogIdRef etc.).
  const [localGameOverDismissed, setLocalGameOverDismissed] = useState(false);
  useEffect(() => {
    setLocalGameOverDismissed(false);
  }, [log.id]);
  // Sprint 4.3.1 — derived "the user has committed to this game" flag.
  // Used to (a) hide the duplicate bottom action group in local 2P and
  // (b) lock the opponent / mode toggles so a misclick can't reset
  // mid-game state.
  const gameInProgress = log.moves.length > 0 && gameStatus === 'active';

  const {
    requestOpponentChange,
    applyOpponentChange,
    pendingLeave,
    setPendingLeave,
    guardLeave,
  } = useNavigationGuards({
    setPendingOpponentChange,
    setView,
    opponentMode,
    setOpponentMode,
    isMultiplayer,
    watchingGame,
    setMobilePanel,
    mpMatchLive,
    gameInProgress,
  });
  const currentPlayer = isMultiplayer
    ? mpSync!.isMyTurn
      ? 'human'
      : 'ai'
    : isLocalMode
      ? 'human'
      : state.sideToMove === 'white'
        ? 'human'
        : 'ai';
  /** QA-11 — solo only: the bot's move is in flight. */
  const botThinking =
    !isMultiplayer && !isLocalMode && gameStatus === 'active' && currentPlayer === 'ai';

  useAfkNudge({ setShowAfkAlert, lastActivityRef, gameStatus, currentPlayer });

  useMoveFeedback({
    gameStatus,
    log,
    setSquareAnnotations,
    setArrowAnnotations,
    annotationStartRef,
  });

  useRouletteAutoSpin({
    isMultiplayer,
    mpSync,
    watchingGame,
    gameStatus,
    gameMode,
    isRouletteSpinning,
    allowedPieceTypes,
    firstRouletteSpinDone,
    doSpinRouletteNow,
    currentPlayer,
  });

  // Mode can only be switched before the first move — otherwise rules would
  // change mid-game (e.g. switching out of Roulette skips a spin).
  const modeToggleLocked = log.moves.length > 0 || state.fullmoveNumber > 1;

  // Who plays each side: the player here (whose moves, rotations and
  // promotions go through turns.act), the bot, or a self-play run's bot
  // on both sides (src/session/players).
  useSeats({
    isMultiplayer,
    onlineColor: mpSync?.myColor ?? null,
    watchingGame,
    isAutoMode,
    autoStopped,
    isLocalMode,
    twitchVoteMode,
    botLevelRef,
    setSelected,
    setSearchEvalFromWhite,
    setSearchMateInPlies,
    setPreviewTopology,
    commitAnalysis,
    autoLastMoveAtRef,
  });

  const { materialBreakdown, materialScore } = useMaterial({ state, myColor });




  useCaptureFx({
    setEnPassantExplosionSquare,
    registerFx,
    setCaptureFxSquare,
    setCaptureShake,
    setCaptureStrobe,
    setRotationDust,
    toast,
  });

  const {
    highlightedTargets,
    enPassantTargets,
    checkSquares,
    displayTopology,
    threatenedSquares,
    supportPairs,
    threateningPieceSquares,
    hoverSupporters,
  } = useBoardMarks({
    watchingGame,
    selected,
    previewTopology,
    showThreats,
    showSupport,
    previewLocked,
    lockedPreviewTopology,
    hoveredSquare,
    registerFx,
    setCheckVignette,
    state,
    legalMoves,
  });

  // Sprint 3.7 (rev 2) — Sprint 3.6's hoverInsights useMemo and the
  // .attacker-of-hovered / .defender-of-hovered tile classes are
  // gone; the restored Threat / Support toggle buttons drive the
  // overlay via the existing supportPairs / threatenedSquares /
  // threateningPieceSquares pipeline instead.

  // Sprint 3.6 — right-click annotation handlers. Bound on every tile
   // alongside onClick. Left-click logic is untouched: button !== 2
   // exits these helpers immediately.
  function handleTileContextMenu(e: React.MouseEvent) {
    e.preventDefault();
  }

  function handleTileMouseDown(e: React.MouseEvent, sq: SquareId) {
    if (e.button !== 2) return;
    e.preventDefault();
    annotationStartRef.current = sq;
  }

  function handleTileMouseUp(e: React.MouseEvent, sq: SquareId) {
    if (e.button !== 2) return;
    const start = annotationStartRef.current;
    annotationStartRef.current = null;
    if (!start) return;
    const color = colorFromMouseEvent(e);
    if (start === sq) {
      setSquareAnnotations((prev) => {
        const next = new Map(prev);
        if (next.get(sq) === color) {
          next.delete(sq);
        } else {
          next.set(sq, color);
        }
        return next;
      });
    } else {
      setArrowAnnotations((prev) => {
        const existing = prev.findIndex(
          (a) => a.from === start && a.to === sq && a.color === color,
        );
        if (existing >= 0) {
          return prev.filter((_, i) => i !== existing);
        }
        return [...prev, { from: start, to: sq, color }];
      });
    }
  }

  function onSquareClick(square: string) {
    if (watchingGame) return; // replay mode is read-only.
    // SP-3 Beat Mode — a move is queued to land on the next beat; ignore
    // further board input until it commits so the snap can't be raced.
    if (beatSnapPendingRef.current) return;

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
      if (isMpRoulette && rouletteReveal) return; // the bag is still landing
      const canSelect = (type: PieceType): boolean =>
        !isMpRoulette ||
        isPieceMovableInRoulette(
          type,
          state,
          'roulette',
          mpSync.rouletteSlots,
          mpSync.usedRouletteSlots,
        );
      if (!selected) {
        if (
          piece &&
          piece.color === mpSync.myColor &&
          canSelect(piece.type)
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
          canSelect(piece.type)
        ) {
          setSelected(square);
        } else {
          setSelected(null);
        }
        return;
      }
      // R13b — classic MP gets the same promotion picker as solo (the
      // auto-queen shortcut made underpromotion impossible in PvP).
      // Roulette keeps auto-queen to preserve the multi-action flow.
      if (
        move.kind === 'promotion' &&
        move.from &&
        move.to &&
        mpSync.matchState.gameMode !== 'roulette'
      ) {
        setMpPendingPromotion({ from: move.from, to: move.to });
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

    // Q.D.5: route every piece-type gate through isPieceMovableInRoulette
    // so the in-check override applies uniformly to selection, legal-move
    // computation, and re-selection on miss-click.
    const activeMoves: Move[] =
      gameMode === 'roulette'
        ? getLegalMoves(state).filter((m) => {
            if (!m.from) return false;
            const p = state.pieces[m.from];
            if (!p) return false;
            return isPieceMovableInRoulette(
              p.type,
              state,
              gameMode,
              allowedPieceTypes,
              usedRouletteSlots,
            );
          })
        : legalMoves;
    const canSelectSolo = (type: PieceType): boolean =>
      isPieceMovableInRoulette(
        type,
        state,
        gameMode,
        allowedPieceTypes,
        usedRouletteSlots,
      );

    if (!selected) {
      if (gameMode === 'roulette') {
        const p = state.pieces[square as SquareId];
        if (!p || p.color !== state.sideToMove) return;
        if (!canSelectSolo(p.type)) return;
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
        if (!canSelectSolo(p.type)) return;
      }
      setSelected(square);
      return;
    }
    // Promotion picker (classic only — in roulette we auto-queen to keep the
    // multi-action flow uninterrupted).
    if (move.kind === 'promotion' && move.from && move.to && gameMode !== 'roulette') {
      turns.act({ type: 'requestPromotion', from: move.from, to: move.to });
      return;
    }
    const resolvedMove: Move =
      gameMode === 'roulette' && move.kind === 'promotion' && !move.promotion
        ? { ...move, promotion: 'queen' }
        : move;

    // SP-3 / M.14 Beat Mode — in classic solo play the piece GLIDES into
    // place exactly on the beat. The commit closure captures this render's
    // state/log; nothing mutates them during the <1-beat hold (human's
    // turn), so deferring is safe. Roulette/MP excluded.
    //
    // Earlier the move committed ON the beat and the slide started then,
    // so the piece arrived a slide-length late and felt laggy. Now we
    // figure out whether this move will visually slide (both tiles
    // unrotated in the current topology) and, if so, commit a slide-
    // length EARLY so the glide LANDS on the beat. The ring keeps filling
    // until the beat, popping as the piece touches down.
    if (gameMode === 'classic' && !isMultiplayer) {
      const from = resolvedMove.from!;
      const to = resolvedMove.to!;
      const willSlide =
        from !== to &&
        tilePixelCenter(to, displayTopology, layout).angle === 0 &&
        tilePixelCenter(from, displayTopology, layout).angle === 0;
      const slideMs = willSlide ? BEAT_SLIDE_MS : 0;
      const beat = streaming();
      const plan = beat ? beat.beatMode.snapPlan(slideMs) : null;
      if (beat && plan) {
        const { beatEngine } = beat;
        beatSnapPendingRef.current = true;
        setBeatSnap({ from, to, ms: plan.landMs });
        // R15-bug — the hold used to be ONE fixed setTimeout computed at
        // click time, but since M.26/27 the grid is alive under it: an
        // essentia re-lock (every ~6s) or a PLL nudge moves the beats,
        // and the pre-computed hold landed where the beat USED to be —
        // "Beat Mode лагає". The hold now TRACKS the live grid, waking
        // shortly before each estimated land and re-reading
        // msToNextBeat(); a hard cap (~1.6 beats from click) commits
        // regardless, so a re-anchoring grid can never chase the move
        // away from the player.
        const commitSnap = () => {
          beatSnapPendingRef.current = false;
          setSelected(null);
          commitMove();
          setBeatSnap(null);
        };
        const deadline =
          performance.now() + Math.min(plan.landMs, beatEngine.getIntervalMs() * 1.6);
        const track = () => {
          if (!beatEngine.isRunning()) {
            commitSnap(); // grid stopped mid-hold — play immediately
            return;
          }
          const msLeft = beatEngine.msToNextBeat();
          if (msLeft <= slideMs + 45 || performance.now() >= deadline) {
            // Beat within glide reach (or cap hit): commit so the piece
            // lands on it.
            window.setTimeout(commitSnap, Math.max(0, msLeft - slideMs));
            return;
          }
          window.setTimeout(track, Math.min(60, msLeft - slideMs - 40));
        };
        track();
        return;
      }
    }
    commitMove();
    return;

    // ── commit closure ──────────────────────────────────────────────
    function commitMove() {
    const san = computeSAN(state, resolvedMove);
    // R2 — settle the chat's "guess the streamer" round on the actual move.
    settleGuessRound(resolvedMove, san);
    const afterMove = applyMove(state, resolvedMove);
    // The move itself (the board, the log, the roulette turn, the end of
    // the game) is step()'s: src/session/step.ts.
    turns.act({ type: 'move', move: resolvedMove, actor: 'human', now: Date.now() });
    // Defer classify so the click feels instant — main thread is still
    // single-threaded but the DOM paints first, then the analysis lands
    // ~300 ms later as if the engine is "thinking".
    // Worker-backed classify: keeps the main thread responsive while the
    // ~1 s depth-7 search runs. moveIdx is captured pre-append so the .then
    // can patch by index even if the user / AI has moved on by the time the
    // analysis lands. Visuals are gated to "still the latest move".
    // B3 — bump the previous search-eval by the material delta instead
    // of dropping to the static fallback (the bar was flickering).
    setSearchEvalFromWhite((prev) => bumpEvalForMove(prev, state, resolvedMove));
    setSearchMateInPlies(null);
    const moveIdx = log.moves.length;
    // Sprint 4.1 — local hot-seat skips the classifier worker. The
    // analysis pipeline is tied to leaderboard / review of solo games
    // vs the AI; in local 2P play there's no scoring and both sides
    // are human, so the cost / noise isn't worth it.
    if (!isLocalMode) {
      classifyAsync(state, resolvedMove, afterMove, {
        budgetMs: scaleBudgetMs(1000),
        maxDepth: 7,
        allowSelfCheck: gameMode === 'roulette',
      })
        .then((analysis) => {
          commitAnalysis(moveIdx, analysis, resolvedMove.to);
        });
    }

    setSelected(null);
    } // end commitMove
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
    // R13b — MP: the picked piece rides the match doc; the local commit
    // below is solo-only (the MP board re-derives from the shared log).
    if (isMultiplayer && mpSync) {
      setSelected(null);
      setMpPendingPromotion(null);
      void mpSync.sendMove(move);
      return;
    }
    const san = computeSAN(state, move);
    // R2 — promotion commits bypass commitMove; settle the guess round here too.
    settleGuessRound(move, san);
    const next = applyMove(state, move);
    turns.act({ type: 'promote', piece: pieceType, now: Date.now() });
    setSelected(null);
    // B3 — material-delta bump instead of static-fallback flicker.
    setSearchEvalFromWhite((prev) => bumpEvalForMove(prev, state, move));
    setSearchMateInPlies(null);
    const moveIdx = log.moves.length;
    classifyAsync(state, move, next, {
      budgetMs: scaleBudgetMs(1000),
      maxDepth: 7,
      allowSelfCheck: gameMode === 'roulette',
    }).then((analysis) => {
      commitAnalysis(moveIdx, analysis, move.to);
    });
  }

  function cancelPromotion() {
    if (isMultiplayer) setMpPendingPromotion(null);
    else turns.act({ type: 'cancelPromotion' });
  }

  const squares = useMemo(() => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    return ranks.flatMap((rank) =>
      files.map((file) => `${file}${rank}`),
    );
  }, []);

  const { canRotate } = useCanRotate({
    watchingGame,
    gameMode,
    state,
    allowedPieceTypes,
    rouletteActionsLeft,
    currentPlayer,
  });

  useCoachNudges({
    isMultiplayer,
    watchingGame,
    gameStatus,
    helpToolsEnabled,
    gameMode,
    log,
    searchEvalFromWhite,
    toast,
    encourageBadStreakRef,
    encourageLastMoveRef,
    encourageCheckedMoveRef,
    setEncourageRotate,
    earlyTipLogIdRef,
    rotateTipLogIdRef,
    isLocalMode,
    currentPlayer,
    canRotate,
  });

  const {
    layout,
    scale,
    mateKingPos,
    irisKingPos,
    mateSeq,
    mateSeqActive,
    endgameSceneActive,
  } = useEndgame({
    isAutoMode,
    mpEndOutcome,
    isMultiplayer,
    mpSync,
    watchingGame,
    gameStatus,
    victoryFreezeTimer,
    setVictoryFreeze,
    victoryFreeze,
    state,
    log,
    boardSize,
    setEndgameCut,
    endgameCut,
    tileBase,
    isLocalMode,
    displayTopology,
    checkSquares,
  });

  const recentPlyHighlights = useMemo(() => recentPlies(log.moves, gameMode), [log.moves, gameMode]);

  // QA-09 — online, the position and seed are the MATCH's (log is derived
  // from the match doc); initialState / seed still hold the last solo game,
  // which is what the chip and the copied header used to show.
  const positionLabel = backRankString(isMultiplayer ? log.initialState : initialState);
  const notationSeed = isMultiplayer ? log.randomSeed : seed;

  useGameStartPing({
    isAutoMode,
    user,
    displayName,
    isMultiplayer,
    seed,
    gameMode,
    log,
    positionLabel,
  });

  const { onMemoryGameActivate } = useResumeGame({
    isAutoMode,
    sharedGameId,
    importedLogIdRef,
    resumedLogIdRef,
    setOpponentMode,
    mpResumeCodeRef,
    setSelected,
    setPreviewTopology,
    beginBusy,
    setBotLevel,
    setFormationLocked,
    setLockedFormationKey,
    savedForLogIdRef,
    liveSavedGameIdRef,
    setSearchEvalFromWhite,
    setSearchMateInPlies,
    classifyImportedLog,
    resetGameEndState,
  });

  function importReplayFromNotation() {
    try {
      // QA-02 — strict: every entry has to be a move the live game would
      // have allowed at that point, or the whole log is refused with the
      // move it failed on. See replayFromNotation.
      const replay = replayFromNotation(replayText, { roulette: gameMode === 'roulette' });
      const { initial, final: current, log: replayLog } = replay;

      const id = `replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const snapshot = buildSavedGameSnapshot(replayLog, id, true);
      if (localStorageAdapter.saveOrUpdateGame) {
        localStorageAdapter.saveOrUpdateGame(snapshot);
      } else {
        localStorageAdapter.saveGame(snapshot);
      }

      // Load into the board as an unfinished game so it can be continued.
      liveSavedGameIdRef.current = id;
      setFormationLocked(true);
      setLockedFormationKey(replay.config960);
      // A log that already ends the game loads as over (settle).
      session.dispatch({
        type: 'load',
        game: { initial, board: current, log: replayLog, lastMove: null },
        fresh: true,
        settle: { lastWasRotation: replay.lastWasRotation },
      });
      setSelected(null);
      setPreviewTopology(null);
      savedForLogIdRef.current = null;
      setSearchEvalFromWhite(null);
      setSearchMateInPlies(null);
      resetGameEndState();
      // QA-02 — an imported game is never ranked, whatever the bot level.
      // The mark lives here and in the Memory entry (never in /games), so a
      // resume from Memory keeps it.
      importedLogIdRef.current = replayLog.id;
      // A log that already ends the game loads as over. That ending is not
      // one the player just reached, so it gets no summary and no save.
      if (boardEnding(current, replay.lastWasRotation)) completedLogIdRef.current = replayLog.id;
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

  const { notationString, copyNotation, liveReviewLog, gameOverMessage } = useNotation({
    gameStatus,
    setCopied,
    gameMode,
    state,
    log,
    positionLabel,
    notationSeed,
  });

  if (isStatsMode) {
    return (
      <Suspense fallback={<div className="view-loading"><span className="spinner" /></div>}>
        <StatsPage />
      </Suspense>
    );
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
      <AutoBoard
        isMultiplayer={isMultiplayer}
        squares={squares}
        recentRotation={recentRotation}
        boardSize={boardSize}
        displayTopology={displayTopology}
        layout={layout}
        tileBase={tileBase}
        scale={scale}
      />
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
      <div className="app-shell" key={view} ref={shellRef}>
        <Suspense fallback={<div className="view-loading"><span className="spinner" /></div>}>
        <GameReview
          log={activeReviewLog ?? liveReviewLog}
          meta={activeReviewMeta ?? undefined}
          gameId={sharedGameId ?? lastGameId ?? null}
          onBack={() =>
            // V1 — leaving the review rebuilds the whole board view in one
            // commit: the board, 64 tiles, the panels and whatever
            // analysis was mid-flight. On a long game that is a few
            // hundred milliseconds during which the tab stops repainting,
            // which reads as a hang with no explanation. busy.navigate
            // paints the spinner FIRST and runs the switch after.
            busy.navigate('Back to the board', () => {
              setView('game');
              // F7 — moves of the game on the board that are not classified yet
              // (the review took the classifier for a while, or dropped some
              // of its requests when it started or closed) are classified
              // now, with no action from the player.
              if (
                !activeReviewLog &&
                !isMultiplayer &&
                !watchingGame &&
                unclassifiedMoveIndexes(log).length > 0
              ) {
                classifyImportedLog(log);
              }
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
            })
          }
        />
        </Suspense>
      </div>
    );
  }

  if (view === 'leaderboard') {
    return (
      <div className="app-shell" key={view} ref={shellRef}>
        <Suspense fallback={<div className="view-loading"><span className="spinner" /></div>}>
        <Leaderboard
          currentUid={user?.uid ?? null}
          watchDisabled={isMultiplayer}
          onBack={() => busy.navigate('Back to the board', () => setView('game'))}
          onWatchGame={(gameId, playerName) => {
            void startWatching(gameId, playerName);
          }}
        />
        </Suspense>
      </div>
    );
  }

  if (view === 'friend-lobby') {
    return (
      <div className="app-shell" key={view} ref={shellRef}>
        <Suspense fallback={<div className="view-loading"><span className="spinner" /></div>}>
        <FriendLobby
          uid={user?.uid ?? null}
          displayName={displayName}
          onBack={() =>
            busy.navigate('Back to the board', () => {
              setView('game');
              setOpponentMode('ai');
            })
          }
          onMatchReady={(match) => {
            // Q.B.2: hand the live match over to the regular game view.
            // The board / log / header all reuse the single-player UI,
            // sourcing their data from useMultiplayerSync.
            //
            // R15-bug — reset the solo world FIRST: a finished solo game
            // leaves a terminal gameStatus behind, and the MP UI reads it
            // (its "Checkmate!" banner covered the fresh match and hid
            // the clock strip, which is gated on gameStatus==='active').
            startNewGame();
            setActiveMatch(match);
            // fix/v1.1.4 — the drawer state outlives the lobby screen, so
            // a drawer left open when the lobby was entered came back
            // over the board of the new match. Close it on the way in.
            setMobilePanel('none');
            setView('game');
            // Reset any stale completion state from a previous match.
            setMpEndOutcome(null);
            mpSavedGameIdRef.current = null;
            mpWroteOutcomeRef.current = null;
          }}
        />
        </Suspense>
      </div>
    );
  }

  return (
    <div
      className={`app-shell${flashEffect ? ` is-${flashEffect}-flash` : ''}`}
      // Motion scaffold: keyed by the coarse `view` enum (not opponentMode/
      // isMultiplayer) so React remounts the shell — and replays the
      // view-enter crossfade — only on a real screen switch (game <->
      // review/leaderboard/friend-lobby). Switching opponent mode or
      // starting an MP match while still in 'game' must NOT retrigger
      // this, or the board would look like it reset.
      key={view}
      // Sprint 4.3.1 — data-opponent-mode + data-game-active drive CSS
      // selectors that hide duplicate / irrelevant controls in local
      // 2P hot-seat mode (the standard action group, standalone rotate,
      // material-score chip). Gated on game-active so the controls
      // reappear once the local game finishes and the user needs the
      // New Game / Lock buttons again.
      data-opponent-mode={opponentMode}
      data-game-active={gameInProgress ? '1' : '0'}
      // R3 — reserved widths of docked side panels; CSS pads the shell by
      // them (media-gated to desktop) so content slides clear.
      style={
        { '--dock-left': `${dock.left}px`, '--dock-right': `${dock.right}px` } as React.CSSProperties
      }
      ref={shellRef}
    >
    {bgGridOn && (
      <Suspense fallback={null}>
        <BackgroundWaveGrid />
      </Suspense>
    )}
    <ScreenFlash flashEffect={flashEffect} sparklePositions={sparklePositions} />
    <div
      className="app-root"
      data-mobile-panel={mobilePanel}
      style={{ '--board-size': `${boardSize}px` } as React.CSSProperties}
    >
      {/* Closes whichever drawer is open; inert while both are shut. */}
      <div
        className="mobile-scrim"
        onClick={closeMobilePanel}
        role="presentation"
        aria-hidden
      />
      <AppHeader
        isMultiplayer={isMultiplayer}
        mpSync={mpSync}
        opponentMode={opponentMode}
        mobilePanel={mobilePanel}
        setMobilePanel={setMobilePanel}
        showMusicDock={showMusicDock}
        setShowMusicDock={setShowMusicDock}
        showTwitch={showTwitch}
        setShowTwitch={setShowTwitch}
        user={user}
        displayName={displayName}
        setShowFeedbackModal={setShowFeedbackModal}
        setShowHelp={setShowHelp}
        setShowNameModal={setShowNameModal}
        guardLeave={guardLeave}
        setView={setView}
      />

      {watchingGame && (
        <WatchBanner
          watchingGame={watchingGame}
          onSeek={seekWatchTo}
          onToggleAutoplay={toggleWatchAutoplay}
          onStop={stopWatching}
        />
      )}

      <MatchBanners
        sharedGameError={sharedGameError}
        onDismissSharedError={() => setSharedGameError(null)}
        isMultiplayer={isMultiplayer}
        mpSync={mpSync}
      />

      {/* Sprint 4.1 / V1 — the hot-seat turn banner that used to float
          above the board now lives INSIDE each player's own button row
          (see LocalTurnSlot), so "whose move" reads as part of the
          controls in front of you rather than a notice pinned over both
          of them. */}
      <div className="app-body">
      <div className="board-area">
      {/* S2.5 — per-side clocks. Elapsed time normally; in a timed MP
          match (B8) they switch to countdown, glowing red under 30s.
          V1 — shaped like the clock that actually sits on a tournament
          table: one housing, two faces split by a dashed seam, the
          running side lit. The readout itself stays digital (an unlit
          88:88 ghost with the live digits burning through it), which is
          how a DGT reads in the hall — the housing is the analogue part,
          not the numbers. */}
      {gameStatus === 'active' && !watchingGame && (
        <GameClocks isMultiplayer={isMultiplayer} mpClock={mpClock} myColor={myColor} />
      )}
      {/* Sprint 2.7.1 — the roulette panel now only renders when there
          is actual slot or spinning state to show. Pre-spin attention
          is handled by the compact .spin-roulette-btn-compact in the
          board-actions row, so the wide banner is gone. */}
      {gameMode === 'roulette' &&
        gameStatus === 'active' &&
        !watchingGame &&
        (allowedPieceTypes || isRouletteSpinning) && (
        <RoulettePanel isMultiplayer={isMultiplayer} mpSync={mpSync} />
      )}
      {/* Sprint 4.2 — black's hot-seat row (features/local/LocalTopActions). */}
      {isLocalMode && gameStatus === 'active' && (
        <LocalTopActions
          localBlackAnswers={localBlackAnswers}
          localBlackBlock={localBlackBlock}
          answerLocalDraw={answerLocalDraw}
          requestResign={requestResign}
          offerLocalDraw={offerLocalDraw}
          previewLocked={previewLocked}
          setPreviewLocked={setPreviewLocked}
          setLockedPreviewTopology={setLockedPreviewTopology}
          encourageRotate={encourageRotate}
          canRotate={canRotate}
          handleRotate={handleRotate}
        />
      )}
      <div className="board-with-eval">
        <EvalBar
          evalCp={myPerspectiveEval}
          mateInPlies={searchMateInPlies}
          isPending={!isMultiplayer && searchEvalFromWhite === null}
        />
      <div
        className={`board-with-coords${showAfkAlert && currentPlayer === 'human' && gameStatus === 'active' ? ' is-afk-nudge' : ''}${captureShake ? ' is-capture-shake' : ''}`}
        style={{ width: boardSize, '--fx-intensity': fxIntensity } as React.CSSProperties}
        data-tour="board"
      >
      {/* SP — mic-driven spectrum ring; mounts only while the
          equalizer listens. Self-driving (no App re-renders). */}
      {vizOn && live && <live.PerimeterEqualizer />}
      <div
        className={`board${previewTopology || previewLocked ? ' previewing' : ''}${recentRotation ? ' is-rotated' : ''}${
          recentRotation && live?.beatMode.isEnabled() && live.beatEngine.isRunning() ? ' is-rotated-beat' : ''
        }`}
        data-topology={displayTopology}
        style={
          {
            width: boardSize,
            height: boardSize,
            // M.15 — in Beat Mode the rotate "swings" in time: one beat
            // long, springy. --rotate-ms = the live beat period.
            ...(recentRotation && live?.beatMode.isEnabled() && live.beatEngine.getIntervalMs() > 0
              ? { '--rotate-ms': `${Math.round(live.beatEngine.getIntervalMs())}ms` }
              : null),
          } as React.CSSProperties
        }
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
          const flip = myColor === 'black';
          const cxView = flip ? boardSize - cx : cx;
          const cyView = flip ? boardSize - cy : cy;
          const tx = cxView - tileBase / 2;
          const ty = cyView - tileBase / 2;

          // Sprint 4.2 — coordinate labels moved out of the tiles into
          // a sibling overlay (.board-coords-overlay below) so they no
          // longer rotate with .board. The per-tile showRankLabel /
          // showFileLabel locals + the corresponding <span> children
          // removed accordingly.

          // Sprint 3.2 / M.20 — piece slide-in. When this tile is
          // lastMove.to in classic mode, compute the pixel offset from the
          // lastMove.from tile so the piece starts at the "from" position
          // and glides back to its real center. M.20 lifted the old
          // angle === 0 restriction: that guard meant every move made
          // while topology B was active (EVERY tile has angle ±90 there —
          // see getSquarePosition — so the old check could never pass)
          // silently skipped the slide entirely, i.e. after the game's own
          // signature rotation mechanic fired even once, no move ever
          // animated again. The dx/dy pixel math itself never depended on
          // either tile's angle — only the piece GLYPH's own counter-
          // rotation does, and that's now animated in parallel below
          // (slideRotFromDeg / .is-rotating-in) instead of gating the
          // slide off entirely.
          let slideDx = 0;
          let slideDy = 0;
          let isSliding = false;
          let slideMs = 260;
          // Angle the piece glyph should rotate FROM (its counter-rotation
          // on the origin tile) so App can animate the glyph's rotation in
          // sync with the wrapper's translate. null when not sliding.
          let slideRotFromAngle: number | null = null;
          // V1 — where this tile's piece should glide in from, if anywhere.
          // Two gaps used to make pieces teleport:
          //   · the slide was gated on `gameMode === 'classic'`, so EVERY
          //     roulette move — both of the bot's sub-moves included — just
          //     appeared on its new square;
          //   · a castle only animated the king; the rook jumped.
          const slideFrom: SquareId | null =
            lastMove?.to === sq && lastMove.from && lastMove.from !== lastMove.to
              ? lastMove.from
              : castleRookSlide?.to === sq
                ? castleRookSlide.from
                : null;
          if (piece && slideFrom) {
            const fromTile = tilePixelCenter(slideFrom, displayTopology, layout);
            const fromCxView = flip ? boardSize - fromTile.cx : fromTile.cx;
            const fromCyView = flip ? boardSize - fromTile.cy : fromTile.cy;
            const viewDx = fromCxView - cxView;
            const viewDy = fromCyView - cyView;
            // V1 — the offset is applied INSIDE the tile, and in topology B
            // every tile is rotated ±90° and scaled. A board-space offset
            // used as-is came out rotated by the tile's own angle, so a
            // piece glided in from the side instead of from the square it
            // left — which reads as a jump, not a move. Express it in the
            // tile's own frame instead.
            const local = toTileFrame(viewDx, viewDy, angle, scale);
            slideDx = local.x;
            slideDy = local.y;
            isSliding = true;
            slideRotFromAngle = fromTile.angle;
            // M.20 — scale duration with travel distance: a one-square hop
            // stays snappy, a board-spanning glide gets a touch more time
            // to read as a real "flight" rather than a blur. Narrow band
            // (220-330ms) so it never reads as sluggish.
            const dist = Math.hypot(viewDx, viewDy);
            slideMs = Math.round(
              Math.min(330, Math.max(220, 220 + (dist / (tileBase * 7)) * 110)),
            );
          }

          return (
            <button
              key={sq}
              type="button"
              className={[
                'tile',
                isDark ? 'dark' : 'light',
                isSelected ? 'selected' : '',
                isEnPassantTarget ? 'target-enpassant' : isTarget ? 'target' : '',
                /* V1 — a destination that holds an enemy piece is not the
                   same offer as an empty square, and until now both got
                   the identical 4px ring. A capture keeps the ring; a
                   quiet move becomes a dot in the middle, so the piece
                   underneath a capture target stays fully visible. */
                isTarget && piece && piece.color !== state.sideToMove
                  ? 'is-capture-target'
                  : '',
                isEnPassantExplosion ? 'enpassant-explosion' : '',
                captureFxSquare === sq ? 'is-capture-burst' : '',
                isLastFrom ? 'last-from' : '',
                isLastTo ? 'last-to' : '',
                olderHighlight ? 'last-older' : '',
                isCheckedKing ? (gameStatus === 'checkmate' ? 'mated-king' : 'checked-king') : '',
                /* V1 — while the iris closes, the mated king rises off
                   the board, so the endgame cut picks up a piece that is
                   already in the air instead of one appearing from
                   nowhere. Uses the existing [data-3d] perspective; with
                   3D off there is no Z to rise along and the rule does
                   not apply. */
                mateSeq === 'iris' && irisKingPos?.sq === sq ? 'is-mate-rise' : '',
                /* Sprint 4.1 — pulse own pieces whose type matches an
                   unused roulette slot for THIS turn. Only on the
                   active client (currentPlayer === 'human') so the
                   opponent doesn't see hints in MP. isPieceMovable
                   InRoulette handles the slot-used + in-check filter. */
                gameMode === 'roulette' &&
                currentPlayer === 'human' &&
                allowedPieceTypes !== null &&
                piece &&
                piece.color === state.sideToMove &&
                isPieceMovableInRoulette(
                  piece.type,
                  state,
                  'roulette',
                  allowedPieceTypes,
                  usedRouletteSlots,
                )
                  ? 'is-roulette-match'
                  : '',
                isCheckingPiece ? (gameStatus === 'checkmate' ? 'mating-piece' : 'checking-piece') : '',
                threatCount > 0 ? 'threatened' : '',
                isThreateningPiece ? 'threatening-piece' : '',
                classifiedSquare?.square === sq
                  ? `classified-${classifiedSquare.classification}`
                  : '',
                sacrificeSquare === sq ? 'is-sacrifice' : '',
                hintMove && 'from' in hintMove && hintMove.from === sq ? 'hint-from' : '',
                hintMove && 'from' in hintMove && hintMove.to === sq ? 'hint-to' : '',
                beatSnap && beatSnap.to === sq ? 'beat-snap-to' : '',
                beatSnap && beatSnap.from === sq ? 'beat-snap-from' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                width: tileBase,
                height: tileBase,
                transform: `translate(${tx}px, ${ty}px) rotate(${angle}deg) scale(${scale})`,
                ...(threatCount > 0 ? { '--threat-n': threatCount } as React.CSSProperties : {}),
                ...(beatSnap && (beatSnap.to === sq || beatSnap.from === sq)
                  ? ({ '--snap-ms': `${beatSnap.ms}ms` } as React.CSSProperties)
                  : {}),
              }}
              onClick={() => onSquareClick(sq)}
              onContextMenu={handleTileContextMenu}
              onMouseDown={(e) => handleTileMouseDown(e, sq as SquareId)}
              onMouseUp={(e) => handleTileMouseUp(e, sq as SquareId)}
              onMouseEnter={() => setHoveredSquare(sq)}
              onMouseLeave={() => setHoveredSquare(null)}
              aria-label={piece ? `${piece.color} ${piece.type} on ${sq}` : sq}
            >
              {squareAnnotations.get(sq as SquareId) && (
                <span
                  className={`tile-annotation tile-annotation-${squareAnnotations.get(sq as SquareId)}`}
                  aria-hidden
                />
              )}
              {piece ? (
                <span
                  className={`piece-slide-wrap${isSliding ? ' is-sliding-in' : ''}`}
                  /* Glyph is decorative — the tile button's aria-label
                     already says "white pawn on e2"; exposing the raw
                     ♟ char would make the visible text mismatch it. */
                  aria-hidden
                  style={isSliding ? ({
                    '--slide-dx': `${slideDx}px`,
                    '--slide-dy': `${slideDy}px`,
                    '--slide-ms': `${slideMs}ms`,
                  } as React.CSSProperties) : undefined}
                >
                  {(() => {
                    // Sprint 4.2 — in local 2P mode flip black pieces 180°
                    // so the opposite-sitting player sees their own
                    // pieces upright. Composes with the existing
                    // topology-B counter-rotation (`-angle`); MP / AI
                    // modes are untouched.
                    const localBlackFlip =
                      opponentMode === 'local' && piece.color === 'black';
                    const totalRot = (angle ? -angle : 0) + (localBlackFlip ? 180 : 0);
                    // M.20 — if this move's origin tile had a different
                    // counter-rotation than the destination (crossing a
                    // topology-B boundary, or simply moving while B is
                    // already active), animate the glyph's OWN rotation in
                    // parallel with the wrapper's slide instead of letting
                    // it snap straight to totalRot on arrival.
                    const fromRot =
                      slideRotFromAngle !== null
                        ? (slideRotFromAngle ? -slideRotFromAngle : 0) + (localBlackFlip ? 180 : 0)
                        : totalRot;
                    const rotSliding = isSliding && fromRot !== totalRot;
                    // M.21 — the mated king fades/shatters in place once
                    // the death cinematic reaches its shatter phase (see
                    // .checkmate-iris/.checkmate-shatter render site and
                    // the mateSeq state machine above the board render).
                    const isMatedKing =
                      mateSeq === 'shatter' && mateKingPos?.sq === sq;
                    return (
                      <span
                        className={[
                          'piece',
                          piece.color === 'white'
                            ? 'piece-white'
                            : 'piece-black',
                          rotSliding ? 'is-rotating-in' : '',
                          isMatedKing ? 'checkmate-king-fade' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{
                          ...(totalRot !== 0 ? { transform: `rotate(${totalRot}deg)` } : {}),
                          ...(rotSliding
                            ? ({
                                '--slide-rot-from': `${fromRot}deg`,
                                '--slide-rot-to': `${totalRot}deg`,
                                '--slide-ms': `${slideMs}ms`,
                              } as React.CSSProperties)
                            : {}),
                        }}
                      >
                        {glyphForPiece(piece.color, piece.type)}
                      </span>
                    );
                  })()}
                </span>
              ) : null}
            </button>
          );
        })}
        <BoardOverlays
          showSupport={showSupport}
          hoveredSquare={hoveredSquare}
          supportPairs={supportPairs}
          hoverSupporters={hoverSupporters}
          arrowAnnotations={arrowAnnotations}
          voteRound={voteRound}
          guessCloud={guessCloud}
          checkVignette={checkVignette}
          captureStrobe={captureStrobe}
          rotationDust={rotationDust}
          fxIntensity={fxIntensity}
          irisKingPos={irisKingPos}
          mateSeqActive={mateSeqActive}
          mateKingPos={mateKingPos}
          mateSeq={mateSeq}
          myColor={myColor}
          displayTopology={displayTopology}
          layout={layout}
          boardSize={boardSize}
          tileBase={tileBase}
        />
      </div>
      <BoardCoords
        myColor={myColor}
        previewTopology={previewTopology}
        previewLocked={previewLocked}
        displayTopology={displayTopology}
        boardSize={boardSize}
        tileBase={tileBase}
      />
      </div>
      </div>

      {/* V1 — the white seat uses the standard .board-actions row below,
          exactly like every other mode. The mirrored row above the board
          is the only local-mode extra (it serves the player sitting on the
          far side). The old duplicate bottom row is gone: it repeated
          resign / preview / rotate one row above the real one and pushed
          the layout past the board's frame. */}

      {pendingPromotion && (
        <PromotionDialog
          isMultiplayer={isMultiplayer}
          handlePromotion={handlePromotion}
          cancelPromotion={cancelPromotion}
        />
      )}

      {gameOverMessage && (
        <div className="game-over-banner">{gameOverMessage}</div>
      )}

      <BoardActions
        isMultiplayer={isMultiplayer}
        isLocalMode={isLocalMode}
        opponentMode={opponentMode}
        watchingGame={watchingGame}
        currentPlayer={currentPlayer}
        botThinking={botThinking}
        rowDraw={rowDraw}
        guardLeave={guardLeave}
        startNewGame={startNewGame}
        formationLocked={formationLocked}
        toggleFormationLock={toggleFormationLock}
        requestResign={requestResign}
        helpToolsEnabled={helpToolsEnabled}
        toggleHelpTools={toggleHelpTools}
        showSupport={showSupport}
        setShowSupport={setShowSupport}
        showThreats={showThreats}
        setShowThreats={setShowThreats}
        hintMove={hintMove}
        computeHint={computeHint}
        previewLocked={previewLocked}
        setPreviewLocked={setPreviewLocked}
        setLockedPreviewTopology={setLockedPreviewTopology}
        setPreviewTopology={setPreviewTopology}
        handleSpinRoulette={handleSpinRoulette}
        canRotate={canRotate}
        showRotateHint={showRotateHint}
        encourageRotate={encourageRotate}
        handleRotate={handleRotate}
        dismissRotateHint={dismissRotateHint}
        materialScore={materialScore}
        materialBreakdown={materialBreakdown}
      />

      <PositionCodeRow
        isMultiplayer={isMultiplayer}
        watchingGame={watchingGame}
        guardLeave={guardLeave}
        setReplayError={setReplayError}
        setShowReplayDialog={setShowReplayDialog}
        positionLabel={positionLabel}
        formationInputMode={formationInputMode}
        setFormationInputMode={setFormationInputMode}
        formationInputRef={formationInputRef}
        formationInputValue={formationInputValue}
        setFormationInputValue={setFormationInputValue}
        applyFormationCode={applyFormationCode}
        cancelFormationInput={cancelFormationInput}
        commitFormationOnBlur={commitFormationOnBlur}
      />
      </div>
      <aside className="right-sidebar">
        {/* fix/mobile-ui — the player's name and "Change name" at the top
            of this panel. fix/v1.1.4: on a phone only (CSS), where this
            panel is the setup drawer; wider screens have UserMenu in the
            header. Outside the setup section so a replay's inert does not
            lock it. The phone drawer (z 940) would cover the name modal,
            so it closes first. */}
        {displayName && (
          <section className="sidebar-panel sidebar-user" aria-label="Player">
            <PlayerRow
              displayName={displayName}
              onChangeName={() => {
                setMobilePanel('none');
                setShowNameModal(true);
              }}
            />
          </section>
        )}
        <GameSetupPanel
          isMultiplayer={isMultiplayer}
          watchingGame={watchingGame}
          gameInProgress={gameInProgress}
          mpMatchLive={mpMatchLive}
          opponentMode={opponentMode}
          requestOpponentChange={requestOpponentChange}
          user={user}
          displayName={displayName}
          modeToggleLocked={modeToggleLocked}
          botLevel={botLevel}
          setBotLevel={setBotLevel}
        />

        <MovesPanel
          isMultiplayer={isMultiplayer}
          notationString={notationString}
          copyNotation={copyNotation}
          copied={copied}
          logRef={moveLogScrollRef}
        />

        <AnalysisPanel
          isMultiplayer={isMultiplayer}
          myColor={myColor}
          searchMateInPlies={searchMateInPlies}
          searchEvalFromWhite={searchEvalFromWhite}
          myPerspectiveEval={myPerspectiveEval}
          onReview={() =>
            busy.navigate('Opening review', () => {
              // fix/v1.1.4 — the drawer would still be open on the way back.
              setMobilePanel('none');
              setView('review');
            })
          }
        />
      </aside>
      </div>

      {showReplayDialog && (
        <ReplayDialog
          replayText={replayText}
          setReplayText={setReplayText}
          replayError={replayError}
          importReplayFromNotation={importReplayFromNotation}
          setShowReplayDialog={setShowReplayDialog}
        />
      )}

      <StatusBar
        isMultiplayer={isMultiplayer}
        mpSync={mpSync}
        watchingGame={watchingGame}
        isLocalMode={isLocalMode}
        currentPlayer={currentPlayer}
        gameOverMessage={gameOverMessage}
      />

      {!isMultiplayer && (
        <MemoryPanel
          onGameActivate={(g) =>
            guardLeave('Open this saved game', true, () => onMemoryGameActivate(g))
          }
        />
      )}

      <AppDialogs
        authLoading={authLoading}
        user={user}
        displayName={displayName}
        setDisplayName={setDisplayName}
        showWelcome={showWelcome}
        showTutorial={showTutorial}
        showNameModal={showNameModal}
        setShowNameModal={setShowNameModal}
        confirmingResign={confirmingResign}
        setConfirmingResign={setConfirmingResign}
        confirmResign={confirmResign}
        pendingLeave={pendingLeave}
        setPendingLeave={setPendingLeave}
        pendingOpponentChange={pendingOpponentChange}
        setPendingOpponentChange={setPendingOpponentChange}
        applyOpponentChange={applyOpponentChange}
        startNewGame={startNewGame}
      />

      {isMultiplayer && mpSync && mpEndOutcome && !endgameSceneActive && (
        <MatchCompleteDialog
          mpSync={mpSync}
          mpEndOutcome={mpEndOutcome}
          selfResigned={mpSelfResignedRef.current === mpSync.matchState.code}
          displayName={displayName}
          setMpEndOutcome={setMpEndOutcome}
          setActiveMatch={setActiveMatch}
          setOpponentMode={setOpponentMode}
          setView={setView}
          setMobilePanel={setMobilePanel}
          mpSavedGameIdRef={mpSavedGameIdRef}
          mpWroteOutcomeRef={mpWroteOutcomeRef}
          setActiveReviewLog={setActiveReviewLog}
          setActiveReviewMeta={setActiveReviewMeta}
        />
      )}

      {isLocalMode && gameStatus !== 'active' && !localGameOverDismissed && !endgameSceneActive && log.moves.length > 0 && (
        <LocalGameOver
          gameOverMessage={gameOverMessage}
          setLocalGameOverDismissed={setLocalGameOverDismissed}
          startNewGame={startNewGame}
        />
      )}

      {summaryOpen && lastGamePoints && gameOutcome && !endgameSceneActive && (
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
          uncountedReason={
            lastGameImported
              ? 'Loaded from a replay log. Imported games are never ranked.'
              : lastGameResumed
                ? 'Resumed from a saved position. Only games played from the first move against the Strong bot are ranked.'
                : botLevel !== 'strong'
                  ? `Played vs the ${BOT_STRENGTH_LABEL[botLevel]} bot. Only Strong-bot games are ranked.`
                  : undefined
          }
          uncountedTitle={lastGameImported ? 'Imported game' : undefined}
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
            requestResign();
          }}
        />
      )}

      {showHelp && (
        <HelpDialog
          uiScale={uiScale}
          pickUiScale={pickUiScale}
          onClose={() => setShowHelp(false)}
          onReplayTutorial={() => {
            setShowHelp(false);
            setShowTutorial(true);
          }}
        />
      )}

      {/* S2.2 — first-launch tour. Only meaningful over the live game
          screen; suppressed in replays, multiplayer, and sub-views. */}
      {/* V1 — first visit: one screen, two doors, then (optionally) the
          tour. Never for a shared-game link or the kiosk/auto modes. */}
      {showWelcome && view === 'game' && !watchingGame && !sharedGameId && (
        <WelcomeScreen
          onStart={() => dismissWelcome(true)}
          onSkip={() => dismissWelcome(false)}
        />
      )}


      {showTutorial && view === 'game' && !isMultiplayer && !watchingGame && (
        <TutorialOverlay onClose={closeTutorial} />
      )}

      {/* T3 — Twitch chat + predictions overlay. What chat does in the
          game follows the session (integrations/twitch/game.ts). */}
      {/* SP — Spotify dock: embed player + tap-tempo beat sync + mic
          equalizer controls. */}
      {STREAMING_UI && showMusicDock && (
        <Suspense fallback={null}>
          <MusicDock onClose={() => setShowMusicDock(false)} />
        </Suspense>
      )}
      {/* SP-2 — on-beat combo overlay; renders null while idle. */}
      {live && <live.BeatCombo />}
      {/* R12 — session beat-points tally (compact pill, click to expand). */}
      {live && <live.MusicScorePanel />}

      {/* R17b — the held-breath beat: a dim freeze before the cinematic. */}
      {victoryFreeze && <div className="victory-freeze" aria-hidden />}
      {/* V1 — the endgame cut: the losing king lifts off its square as
          pixels and the win or the loss plays out around it. */}
      {endgameCut && (
        <Suspense fallback={null}>
          <EndgameScene
            kind={endgameCut.kind}
            theme={endgameCut.theme}
            king={endgameCut.king}
            prelude={endgameCut.prelude}
            onDone={() => setEndgameCut(null)}
          />
        </Suspense>
      )}

      {STREAMING_UI && showTwitch && (
        <Suspense fallback={null}>
          <TwitchPanel
            onClose={() => {
              // Closing the overlay also stops gating AI moves —
              // otherwise the game would silently pause 15s per move.
              streaming()?.moveVoting.setMode('off');
              setShowTwitch(false);
            }}
          />
        </Suspense>
      )}

    </div>
    </div>
  );
}

export default App;
