import './App.css';
import type { BoardState, Color, Move, PieceType, SquareId } from './engine';
import { createStartingPosition, createPositionFromBackRankKey } from './engine';
import {
  generateLegalMoves,
} from './engine/moves';
import { clearSearchTable } from './ai/searchClient';
import { useToast } from './components/Toast';
import type { EndgameKind, KingOrigin, VictoryTheme } from './components/EndgameScene';
import { STREAMING_UI } from './featureFlags';
import { FeedbackModal } from './components/FeedbackModal';
import { MilestoneDialog } from './features/endgame/MilestoneDialog';
import { SoloSummary } from './features/endgame/SoloSummary';
import { useGameResult } from './features/endgame/useGameResult';
import { PlayerRow } from './components/PlayerRow';
import { EvalBar } from './features/game/EvalBar';
import { HelpDialog } from './app/HelpDialog';
import { ScreenFlash } from './features/game/ScreenFlash';
import { WatchBanner } from './features/review/WatchBanner';
import { MatchBanners } from './features/online/MatchBanners';
import { StatusBar } from './app/StatusBar';
import { AutoRun } from './features/autoplay/AutoRun';
import { GameClocks } from './features/game/GameClocks';
import { MovesPanel } from './features/game/MovesPanel';
import { AnalysisPanel } from './features/game/AnalysisPanel';
import { ReplayDialog } from './memory/ReplayDialog';
import { LocalGameOver } from './features/local/LocalGameOver';
import { PromotionDialog } from './features/game/PromotionDialog';
import { RoulettePanel } from './features/game/RoulettePanel';
import { nowMs } from './utils/nowMs';
import { newLiveSnapshotId } from './memory/liveSnapshotId';
import { GameSetupPanel } from './features/game/GameSetupPanel';
import { PositionCodeRow } from './features/game/PositionCodeRow';
import { AppHeader } from './app/AppHeader';
import { LocalTopActions } from './features/local/LocalTopActions';
import { AppDialogs } from './app/AppDialogs';
import { MatchCompleteDialog } from './features/online/MatchCompleteDialog';
import { BoardActions } from './features/game/BoardActions';
import { BoardCoords } from './features/game/BoardCoords';
import { BoardOverlays } from './features/game/BoardOverlays';
import { BoardTiles } from './features/game/BoardTiles';
import { useBoardInput } from './features/game/useBoardInput';
import { useBoardUi } from './features/game/useBoardUi';
import { useWatching } from './features/review/useWatching';
import { useResignAndDraw } from './features/game/useResignAndDraw';
import { useFormation } from './features/game/useFormation';
import { useCoachTools } from './features/game/useCoachTools';
import { useRotate } from './features/game/useRotate';
import { useReplayImport } from './memory/useReplayImport';
import { drawRows } from './features/game/drawRows';
import { useScreenNavigation } from './app/useScreenNavigation';
import { TutorialOverlay } from './components/TutorialOverlay';
import { WelcomeScreen } from './components/WelcomeScreen';
import { useAuth } from './firebase/useAuth';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameLog } from './recording/log';
import { MemoryPanel } from './memory/MemoryPanel';
// rotateIsLegal (R10) decides whether chat rounds accept "rotate"; it lives
// with the replay importer, which checks rotations the same way (QA-02).
import { busy } from './ui/busy';
import { streaming, useStreaming } from './integrations';
import { type GameMode, type GameStatus } from './shared/game';
import {
  backRankString,
  gameEnding,
} from './features/game/position';
import { recentPlies } from './features/game/boardMarks';
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
import { useScreens } from './app/useScreens';
import { useAutoPlay } from './features/autoplay/useAutoPlay';
import { useRoomGradient } from './app/useRoomGradient';
import { useClassifyGuards } from './features/game/useClassifyGuards';
import { useAdaptiveTheme } from './app/useAdaptiveTheme';
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
import { useMaterial } from './features/game/useMaterial';
import { useCanRotate } from './features/game/useCanRotate';
import { session } from './session/session';
import { useSession, useSessionFatal } from './session/useSession';
import { useSessionEventsAfterCommit } from './session/useSessionEvents';
import { statusOf } from './session/step';

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

function App() {
  const { isAutoMode, maxGames, isStatsMode, sharedGameId } = useUrlModes();

  // When App mounted: what the timers below start from (a lazy state, so
  // the clock is read once, not on every render).
  const [mountedAt] = useState(() => Date.now());

  const { user, displayName, loading: authLoading, setDisplayName } = useAuth();
  const [showNameModal, setShowNameModal] = useState(false);
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
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  // Sprint 2.5 — local AFK detector. Independent of the MP afk-watchdog
  // (mpSync.selfAfkWarning) which forfeits the match after 30s; this one
  // is a UX nag that surfaces a pulsing banner when the player's been
  // idle on their own turn for 20s. Resets on any pointer / key activity.
  const [showAfkAlert, setShowAfkAlert] = useState(false);
  const lastActivityRef = useRef<number>(mountedAt);
  // The log id whose ending has been handled (useGameResult); Watch, Resign,
  // the flag fall and Load replay stamp it too.
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
  // Which screen is up, and the Review's own game (useScreens).
  const {
    view, setView, activeReviewLog, setActiveReviewLog,
    activeReviewMeta, setActiveReviewMeta, sharedGameError, setSharedGameError,
  } = useScreens({ sharedGameId });
  // Stage Q.A: opponent selector in the header. 'ai' keeps the existing
  // solo flow; 'friend' opens the PvP lobby. Once a match starts it just
  // overlays the existing 'game' view — the board/log/header reuse the
  // single-player UI, only the data source flips.
  const [opponentMode, setOpponentMode] = useState<'ai' | 'friend' | 'local'>('ai');
  // The online match and its state (useOnlineMatch).
  const mp = useOnlineMatch({
    user,
    setView,
    setOpponentMode,
    // Declared further down; the hook only calls it from callbacks, which
    // run after this render, so a wrapper is enough to reach it.
    setMobilePanel: (v) => setMobilePanel(v),
    startNewGame,
  });
  const { mpSync, isMultiplayer, activeMatch, mpEndOutcome, mpResumeCodeRef } = mp;

  // V1 — every visit starts from a fresh chess960 position (FIRST_SEED in
  // src/session/session.ts).
  const seed = sess.seed;
  // The game on the board: the online match's while one is on (its
  // document, as the session last read it: session/online.ts), else the
  // solo or hot-seat game. The rest of App reads it through these names.
  const online = isMultiplayer ? sess.online?.game ?? null : null;
  const state: BoardState = online ? online.board : sess.board;
  const initialState = sess.initial;
  // The board's own UI state: selection, previews, coaching tools, the
  // formation lock and code editor, annotations, Load replay (useBoardUi).
  const ui = useBoardUi();
  const {
    setSelected, previewTopology, setPreviewTopology, showSupport, helpToolsEnabled,
    setHintMove, previewLocked, setPreviewLocked, setLockedPreviewTopology, hoveredSquare,
    formationLocked, lockedFormationKey, formationInputMode, setFormationInputMode,
    formationInputValue, setFormationInputValue, showReplayDialog, setShowReplayDialog,
    replayText, setReplayText, replayError, setReplayError, mpPendingPromotion,
    formationInputRef, beatSnapPendingRef, arrowAnnotations,
  } = ui;
  const log: GameLog = online ? online.log : sess.log;
  const gameStatus = statusOf(sess);
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
  const boardFx = useBoardFxState();
  const {
    setCaptureFxSquare,
    captureShake,
    setCaptureShake,
    setCaptureStrobe,
    setRotationDust,
    setCheckVignette,
    fxIntensity,
    registerFx,
    victoryFreeze,
    setVictoryFreeze,
    victoryFreezeTimer,
    setEnPassantExplosionSquare,
  } = boardFx;

  // Stage P addendum 7: wall-clock when the current game began. Used to
  // compute durationMs on save. Set in startNewGame (and on initial mount
  // for the first game).
  const gameStartedAtRef = useRef<number>(mountedAt);
  const savedForLogIdRef = useRef<string | null>(null);
  // The live snapshot's id (Memory's autosave): a lazy state, so the
  // first one is made once, on mount.
  const [initialLiveSnapshotId] = useState(newLiveSnapshotId);
  const liveSavedGameIdRef = useRef<string>(initialLiveSnapshotId);

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
  }, [formationInputMode, formationInputRef]);

  useMemoryAutosave({
    importedLogIdRef,
    resumedLogIdRef,
    opponentMode,
    isMultiplayer,
    soloTcSec,
    botLevel,
    savedForLogIdRef,
    liveSavedGameIdRef,
  });

  // Watching a leaderboard game (useWatching): its state, start, step, auto
  // play, stop. Before isLocalMode, which reads watchingGame.
  const { watchingGame, startWatching, seekWatchTo, toggleWatchAutoplay, stopWatching } = useWatching({
    ui,
    isMultiplayer,
    searchEvalFromWhite,
    searchMateInPlies,
    setSearchEvalFromWhite,
    setSearchMateInPlies,
    setSharedGameError,
    setView,
    beginBusy,
    liveSavedGameIdRef,
    savedForLogIdRef,
    completedLogIdRef,
  });

  // Sprint 4.1 — `local` opponent mode means both colours are played
  // from this device, so the engine should never schedule an AI turn.
  // Cached here so the AI scheduler, classifier, and downstream UI
  // can short-circuit on a single flag.
  // V1 — a replay is nobody's hot-seat game. Without `!watchingGame`, a
  // replay started while "Local" was selected rendered the mirrored top
  // controls and flipped the board for "black's turn" in someone else's
  // game. The opponent choice is kept, so stopping the replay brings the
  // hot-seat UI straight back.
  // Declared here, before the completion handler below reads it.
  const isLocalMode = opponentMode === 'local' && !isMultiplayer && !watchingGame;
  // In MP currentPlayer reflects whose turn it is from MY seat: 'human' when
  // I can act, 'ai' otherwise. Keeping the same vocabulary lets the existing
  // canRotate / scheduler / UI-disable code work unchanged.
  // Declared here with isLocalMode, before the handlers below that read them.
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

  // QA-09 — online, the position and seed are the MATCH's (log is derived
  // from the match doc); initialState / seed still hold the last solo game,
  // which is what the chip and the copied header used to show.
  const positionLabel = backRankString(isMultiplayer ? log.initialState : initialState);

  // The end of a solo game: the summary, the save, the 50-move dialog
  // (useGameResult). Its completion handler runs here, before useSoloFlagFall.
  const result = useGameResult({
    isAutoMode,
    isMultiplayer,
    isLocalMode,
    opponentMode,
    watchingGame,
    positionLabel,
    botLevel,
    authLoading,
    user,
    displayName,
    toast,
    gameStartedAtRef,
    completedLogIdRef,
    importedLogIdRef,
    resumedLogIdRef,
  });
  const { finishGame, setGameOutcome } = result;

  // A spin with nothing to do passes the turn as it lands: drop the
  // selection it left (it used to be dropped in doSpinRouletteNow's timer).
  useSessionEventsAfterCommit((events) => {
    if (events.some((e) => e.type === 'rouletteSpin' && e.slots === null)) setSelected(null);
  });

  useOnlineMatchEnd({ user, mp, toast });

  useDrawDeclinedToast({ isMultiplayer, mpSync, toast });

  // The self-play run (?auto) and its state (useAutoPlay).
  const auto = useAutoPlay({
    isMultiplayer,
    isAutoMode,
    maxGames,
    mountedAt,
    gameStartedAtRef,
    startNewGame,
  });
  const { autoStopped, autoLastMoveAtRef, autoSavedLogIdRef } = auto;

  // Resigning, and hot-seat draw offers (useResignAndDraw).
  const { requestResign, confirmResign, localDrawTable, offerLocalDraw, answerLocalDraw } = useResignAndDraw({
    isMultiplayer,
    mpSync,
    isLocalMode,
    watchingGame,
    botThinking,
    confirmingResign,
    setConfirmingResign,
    setGameOutcome,
    setSelected,
    finishGame,
    toast,
    beatSnapPendingRef,
    completedLogIdRef,
    setMpSelfResigned: mp.setMpSelfResigned,
  });

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

  useAdaptiveTheme({ state });

  // Brief glowing outline on the board container whenever topology flips,
  // so rotations don't feel invisible. Fires for both manual rotates and
  // Roulette-driven auto-rotations.
  const [recentRotation, setRecentRotation] = useState(false);
  const prevTopologyRef = useRef(state.topologyState);
  useEffect(() => {
    if (prevTopologyRef.current === state.topologyState) return;
    prevTopologyRef.current = state.topologyState;
    // The glow starts in the commit after the one that shows the rotation and ends on this effect's
    // timer; worked out in render it would start one render earlier (one of App's small effects, left as it is).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see the two lines above
    setRecentRotation(true);
    const t = setTimeout(() => setRecentRotation(false), 2500);
    return () => clearTimeout(t);
  }, [state.topologyState]);

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
    isMultiplayer,
    watchingGame,
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
    const newSeed = nowMs();
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
    autoLastMoveAtRef.current = nowMs();

    // New play session => new live snapshot id.
    liveSavedGameIdRef.current = newLiveSnapshotId();
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
    result.reset();
    completedLogIdRef.current = null;
    gameStartedAtRef.current = nowMs();
  }

  // S2.4 — any change to the position invalidates a shown hint.
  useEffect(() => {
    setHintMove(null);
  }, [sess.log.moves.length, state.topologyState, gameStatus, setHintMove]);

  const { mpMatchLive, mpClock } = useGameClocks({ isMultiplayer, mpSync, watchingGame });

  // Locking the formation, and the Rotate button (useRotate).
  const { toggleFormationLock, handleRotate } = useRotate({
    ui,
    isMultiplayer,
    mpSync,
    watchingGame,
    currentPlayer,
    rotateHintShown,
    dismissRotateHint,
    settleGuessRotate,
  });

  // Draw offers in each player's row (drawRows): the hot-seat seats', and mine online.
  const { localBlackAnswers, localBlackBlock, rowDraw } = drawRows({
    isLocalMode,
    isMultiplayer,
    mpSync,
    gameStatus,
    log,
    localDrawTable,
    offerLocalDraw,
    answerLocalDraw,
  });

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
    // A new game brings the hot-seat "Game over" card back in the commit after the one that shows it;
    // keyed to the log id in render it would be one render earlier (one of App's small effects, left as it is).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see the two lines above
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

  useAfkNudge({ setShowAfkAlert, lastActivityRef, gameStatus, currentPlayer });

  useMoveFeedback({
    ui,
    isMultiplayer,
  });

  useRouletteAutoSpin({
    isMultiplayer,
    mpSync,
    watchingGame,
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

  const boardMarks = useBoardMarks({
    ui,
    isMultiplayer,
    watchingGame,
    registerFx,
    setCheckVignette,
  });
  const {
    checkSquares,
    displayTopology,
  } = boardMarks;

  // Sprint 3.7 (rev 2) — Sprint 3.6's hoverInsights useMemo and the
  // .attacker-of-hovered / .defender-of-hovered tile classes are
  // gone; the restored Threat / Support toggle buttons drive the
  // overlay via the existing supportPairs / threatenedSquares /
  // threateningPieceSquares pipeline instead.


  const squares = useMemo(() => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    return ranks.flatMap((rank) =>
      files.map((file) => `${file}${rank}`),
    );
  }, []);

  const { canRotate } = useCanRotate({
    isMultiplayer,
    watchingGame,
    currentPlayer,
  });

  useCoachNudges({
    isMultiplayer,
    watchingGame,
    helpToolsEnabled,
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

  const endgame = useEndgame({
    isAutoMode,
    mpEndOutcome,
    isMultiplayer,
    mpSync,
    watchingGame,
    victoryFreezeTimer,
    setVictoryFreeze,
    victoryFreeze,
    boardSize,
    setEndgameCut,
    endgameCut,
    tileBase,
    isLocalMode,
    displayTopology,
    checkSquares,
  });
  const {
    layout,
    scale,
    endgameSceneActive,
  } = endgame;

  const recentPlyHighlights = useMemo(() => recentPlies(log.moves, gameMode), [log.moves, gameMode]);

  // QA-09 — online the seed is the MATCH's, like positionLabel above.
  const notationSeed = isMultiplayer ? log.randomSeed : seed;

  useGameStartPing({
    isAutoMode,
    user,
    displayName,
    isMultiplayer,
    positionLabel,
  });

  const { onMemoryGameActivate } = useResumeGame({
    ui,
    isAutoMode,
    sharedGameId,
    importedLogIdRef,
    resumedLogIdRef,
    setOpponentMode,
    mpResumeCodeRef,
    beginBusy,
    setBotLevel,
    savedForLogIdRef,
    liveSavedGameIdRef,
    setSearchEvalFromWhite,
    setSearchMateInPlies,
    classifyImportedLog,
    resetGameEndState,
  });

  // Leaving the review, and a match starting from the lobby (useScreenNavigation).
  const { backFromReview, startMatchFromLobby } = useScreenNavigation({
    isMultiplayer,
    watchingGame,
    activeReviewLog,
    setActiveReviewLog,
    setActiveReviewMeta,
    classifyImportedLog,
    startNewGame,
    mp,
    setMobilePanel,
    setView,
  });

  // Load replay: a pasted log becomes the game on the board (useReplayImport).
  const { importReplayFromNotation } = useReplayImport({
    ui,
    gameMode,
    setSearchEvalFromWhite,
    setSearchMateInPlies,
    boardEnding,
    resetGameEndState,
    classifyImportedLog,
    importedLogIdRef,
    completedLogIdRef,
    savedForLogIdRef,
    liveSavedGameIdRef,
  });

  const { notationString, copyNotation, liveReviewLog, gameOverMessage } = useNotation({
    isMultiplayer,
    setCopied,
    positionLabel,
    notationSeed,
  });

  // The coaching tools' switch and the engine hint (useCoachTools).
  const { toggleHelpTools, computeHint } = useCoachTools({
    ui,
    isMultiplayer,
    watchingGame,
    currentPlayer,
    canRotate,
  });

  // The 960 code chip's editor: apply, cancel, leave (useFormation).
  const { applyFormationCode, cancelFormationInput, commitFormationOnBlur } = useFormation({
    ui,
    setSearchEvalFromWhite,
    setSearchMateInPlies,
    resetGameEndState,
    liveSavedGameIdRef,
  });

  // The board's input: a click on a tile, a promotion, right-click
  // annotations (useBoardInput). Handlers that read the game from the
  // session and add no effect: called here, after everything else they
  // read is declared (layout, displayTopology).
  const { handleTileContextMenu, handleTileMouseDown, handleTileMouseUp, onSquareClick, handlePromotion, cancelPromotion } =
    useBoardInput({
      ui,
      isMultiplayer,
      mpSync,
      isLocalMode,
      watchingGame,
      currentPlayer,
      getLegalMoves,
      pendingPromotion,
      layout,
      displayTopology,
      commitAnalysis,
      settleGuessRound,
      setSearchEvalFromWhite,
      setSearchMateInPlies,
    });

  if (isStatsMode) {
    return (
      <Suspense fallback={<div className="view-loading"><span className="spinner" /></div>}>
        <StatsPage />
      </Suspense>
    );
  }

  if (isAutoMode) {
    return (
      <div className="app-shell auto-shell-root" ref={shellRef}>
        <AutoRun
          auto={auto}
          maxGames={maxGames}
          board={{ isMultiplayer, squares, recentRotation, boardSize, displayTopology, layout, tileBase, scale }}
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
          gameId={sharedGameId ?? result.lastGameId ?? null}
          onBack={backFromReview}
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
          onMatchReady={startMatchFromLobby}
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
        <BoardTiles
          ui={ui}
          isMultiplayer={isMultiplayer}
          squares={squares}
          classifiedSquare={classifiedSquare}
          sacrificeSquare={sacrificeSquare}
          opponentMode={opponentMode}
          currentPlayer={currentPlayer}
          myColor={myColor}
          recentPlyHighlights={recentPlyHighlights}
          castleRookSlide={castleRookSlide}
          boardSize={boardSize}
          tileBase={tileBase}
          onSquareClick={onSquareClick}
          handleTileContextMenu={handleTileContextMenu}
          handleTileMouseDown={handleTileMouseDown}
          handleTileMouseUp={handleTileMouseUp}
          marks={boardMarks}
          fx={boardFx}
          endgame={endgame}
        />
        <BoardOverlays
          showSupport={showSupport}
          hoveredSquare={hoveredSquare}
          arrowAnnotations={arrowAnnotations}
          voteRound={voteRound}
          guessCloud={guessCloud}
          myColor={myColor}
          boardSize={boardSize}
          tileBase={tileBase}
          marks={boardMarks}
          fx={boardFx}
          endgame={endgame}
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
        ui={ui}
        isMultiplayer={isMultiplayer}
        isLocalMode={isLocalMode}
        opponentMode={opponentMode}
        watchingGame={watchingGame}
        currentPlayer={currentPlayer}
        botThinking={botThinking}
        rowDraw={rowDraw}
        guardLeave={guardLeave}
        startNewGame={startNewGame}
        toggleFormationLock={toggleFormationLock}
        requestResign={requestResign}
        toggleHelpTools={toggleHelpTools}
        computeHint={computeHint}
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
          mp={mp}
          displayName={displayName}
          setOpponentMode={setOpponentMode}
          setView={setView}
          setMobilePanel={setMobilePanel}
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

      {!endgameSceneActive && (
        <SoloSummary
          result={result}
          positionLabel={positionLabel}
          user={user}
          displayName={displayName}
          gameMode={gameMode}
          botLevel={botLevel}
          startNewGame={startNewGame}
        />
      )}

      {showFeedbackModal && user && displayName && (
        <FeedbackModal
          playerId={user.uid}
          playerName={displayName}
          onClose={() => setShowFeedbackModal(false)}
        />
      )}

      <MilestoneDialog result={result} isMultiplayer={isMultiplayer} requestResign={requestResign} />

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
