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
  BOT_STRENGTHS,
  BOT_STRENGTH_LABEL,
} from './ai/agents';
import { searchPosition, ttClear } from './ai/search';
import { classifyAsync } from './analysis/classifyClient';
import { NamePicker } from './components/NamePicker';
import { useToast } from './components/Toast';
import type { EndgameKind, KingOrigin, VictoryTheme } from './components/EndgameScene';
import { GameSummary } from './components/GameSummary';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ClockFace } from './components/ClockFace';
import { STREAMING_UI } from './featureFlags';
import { serverNow } from './firebase/serverClock';
import { FeedbackModal } from './components/FeedbackModal';
import { MilestoneModal } from './components/MilestoneModal';
import { AutoPlayView } from './components/AutoPlayView';
import { ThemeToggle } from './components/ThemeToggle';
import { NeonLogo } from './components/NeonLogo';
import { UserMenu } from './components/UserMenu';
import { PlayerRow } from './components/PlayerRow';
import { Effects3DToggle } from './components/Effects3DToggle';
import { AudioToggle } from './components/AudioToggle';
import { MusicToggle } from './components/MusicToggle';
import { audio } from './audio/AudioController';
import { Icon } from './components/Icon';
import { Tooltip } from './components/Tooltip';
import { TutorialOverlay } from './components/TutorialOverlay';
import { WelcomeScreen } from './components/WelcomeScreen';
import {
  AlarmClock,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  Crosshair,
  Dices,
  Disc3,
  Eye,
  Flag,
  GraduationCap,
  Handshake,
  HelpCircle,
  Lightbulb,
  Lock,
  MessageSquare,
  Pencil,
  Menu,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Cast,
  Upload,
  Users,
  UsersRound,
} from 'lucide-react';
import type { GameReviewMeta } from './components/GameReview';
import { mpResignCause } from './firebase/matchEnd';
import type { MatchDoc, MatchOutcome } from './firebase/matches';
import {
  translateOutcomeForPlayer,
} from './firebase/multiplayerGames';
import { useAuth } from './firebase/useAuth';
import {
  fetchSavedGame,
  deserializeGameLog,
} from './firebase/games';
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
import { moveVoting } from './twitch/moveVoting';
import { busy } from './ui/busy';
import { PerimeterEqualizer } from './components/PerimeterEqualizer';
import { BackgroundWaveGrid } from './components/BackgroundWaveGrid';
import { beatBridge } from './music/beatBridge';
import { beatEngine } from './music/beatEngine';
import { beatMode } from './music/beatMode';
import { BeatCombo } from './components/BeatCombo';
import { MusicScorePanel } from './components/MusicScorePanel';
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
import {
  ROULETTE_MAX_ACTIONS,
  ROULETTE_SLOT_COUNT,
  isPieceMovableInRoulette,
} from './features/game/roulette';
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
import { drawOfferTitle } from './features/game/drawOfferTitle';
import { BOT_STRENGTH_HINT, BOT_STRENGTH_SUMMARY } from './features/game/botLevel';
import { deriveMpLastMove, deriveMpLog } from './features/online/matchLog';
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
import { useBotScheduler } from './features/game/useBotScheduler';
import { useBotTurn } from './features/game/useBotTurn';
import { useChatVsBot } from './features/twitch/useChatVsBot';
import { useGuessTheStreamer } from './features/twitch/useGuessTheStreamer';
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
import { session } from './session/session';
import { useSession } from './session/useSession';
import { drawTableOf, statusOf } from './session/step';

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
// R6 — pixel victory cinematic; loaded only when a tense win triggers it.
// importEndgameScene (in useEndgame) lets the iris warm the chunk early.
const EndgameScene = lazy(() =>
  importEndgameScene().then((m) => ({ default: m.EndgameScene })),
);

/** The roulette turn's used slots when no bag is spun: one array, so a
 *  hook that depends on it sees no change while nothing changes. */
const NO_SLOTS: number[] = [];

// M.14 — beat-mode glide length. MUST match the .piece-slide-in CSS
// animation duration so the slide lands exactly on the beat.
const BEAT_SLIDE_MS = 260;

// S2.5 — mm:ss elapsed-time display for the per-side clocks.
/**
 * V1 — the hot-seat turn indicator, as part of a player's own row.
 *
 * Each player gets one, in the row of buttons in front of them (black's
 * row is drawn upside down, so black reads theirs upright). It lights and
 * says "Your move" for the side that is to play; the other one dims and
 * names whose turn it is instead.
 */
function LocalTurnSlot({ side, toMove }: { side: 'white' | 'black'; toMove: 'white' | 'black' }) {
  const mine = side === toMove;
  return (
    <span
      className={`local-turn-slot is-${side}${mine ? ' is-to-move' : ''}`}
      role="status"
      aria-live={mine ? 'polite' : undefined}
    >
      <span className="local-turn-lamp" aria-hidden />
      {mine ? 'Your move' : `${toMove === 'white' ? 'White' : 'Black'} to move`}
    </span>
  );
}

/** A draw offer as the player it is made to sees it: in place of that
 *  player's own row, so the board does not move when it appears. */
function DrawOfferPrompt({
  text,
  onAnswer,
  disabled = false,
}: {
  text: string;
  onAnswer: (accept: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="draw-offer-prompt" role="group" aria-label="Draw offer">
      <Icon icon={Handshake} size="md" aria-hidden />
      <span className="draw-offer-text" role="status">{text}</span>
      <button
        type="button"
        className="mp-btn mp-btn-primary"
        onClick={() => onAnswer(true)}
        disabled={disabled}
      >
        Accept
      </button>
      <button
        type="button"
        className="mp-btn mp-btn-secondary"
        onClick={() => onAnswer(false)}
        disabled={disabled}
      >
        Decline
      </button>
    </div>
  );
}

function App() {
  const { isAutoMode, maxGames, isStatsMode, sharedGameId } = useUrlModes();

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
        return localStorage.getItem('subutai_mp_active');
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
  const { mpSync, isMultiplayer, isMultiplayerRef } = useOnlineMatch({
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
  // Local single-player engine state. In multiplayer (Q.B.2) the rest of
  // App reads through the `state` / `legalMoves` / `log` / `lastMove`
  // const aliases below, which swap to mpSync-derived values.
  const stateLocal = sess.board;
  const initialState = sess.initial;
  const [selected, setSelected] = useState<string | null>(null);
  const legalMovesLocal = sess.legal as Move[];
  const logLocal = sess.log;
  const gameStatus = statusOf(sess);
  const [previewTopology, setPreviewTopology] = useState<TopologyState | null>(null);
  const lastMoveLocal = sess.lastMove;
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

  const [showMaterialPopup, setShowMaterialPopup] = useState(false);
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
      return localStorage.getItem('subutai_help_tools') !== '0';
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
    announceGuessWinners,
  } = useTwitchState();
  const { showMusicDock, setShowMusicDock, vizOn, bgGridOn } = useMusicState();
  // S2.5 — per-side elapsed clocks. Pure UX (no flag-fall): the active
  // side's clock accumulates wall time while the game is live. Reset on
  // every new game log.
  const [clockMs, setClockMs] = useState<{ white: number; black: number }>({
    white: 0,
    black: 0,
  });
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
  const gameModeLocal = useSession((s) => s.mode);
  // PvP gameMode flows from the match doc — host picks it at create time.
  // Q.D.2: reuse the SAME solo roulette UI/logic by aliasing gameMode,
  // allowedPieceTypes, rouletteActionsLeft, etc. through to MP-derived
  // values. Single-player still drives those from local state below.
  const gameMode: GameMode = isMultiplayer
    ? mpSync?.isRouletteMode
      ? 'roulette'
      : 'classic'
    : gameModeLocal;
  // Q.D.8: roulette is now a capture-the-king variant — no check enforcement.
  // Every legal-move query routes through this wrapper so the option flips
  // automatically based on mode. Classic mode always returns the strict
  // check-respecting set; roulette returns pseudo-legal verbatim.
  function getLegalMoves(s: BoardState): Move[] {
    return generateLegalMoves(s, { allowSelfCheck: gameMode === 'roulette' });
  }
  // The roulette turn (src/session/types.ts RouletteState): the spun bag
  // and what is left of it, and whether the wheel is turning.
  const rouletteBag = sess.roulette.bag;
  const allowedPieceTypesLocal = (rouletteBag?.slots ?? null) as PieceType[] | null;
  const isRouletteSpinning = sess.phase.tag === 'rouletteSpin';
  const rouletteActionsLeftLocal = rouletteBag?.actionsLeft ?? 0;
  const usedRouletteSlotsLocal = (rouletteBag?.used ?? NO_SLOTS) as number[];
  // First roulette spin per game requires a manual click on the Spin
  // Roulette button. Subsequent spins auto-fire via a useEffect after a
  // short delay.
  const firstRouletteSpinDoneLocal = sess.roulette.firstSpinDone;
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
    ? getLegalMoves(state)
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
  const formationInputRef = useRef<HTMLInputElement>(null);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Game-completion pipeline: detects terminal gameStatus transitions, computes
  // points, opens the GameSummary modal, and kicks the async Firestore save.
  // The ref guards against double-fires (StrictMode + deps that move together).
  // Auto mode handles completion via its own effect — never enters this path.
  useEffect(() => {
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
    // finishGame closes over current state/log/user/displayName; we want this
    // to fire once per terminal transition, hence the ref-guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStatus, log.id, log.moves.length, isAutoMode]);

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
    autoTimerRef,
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
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
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
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
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
    // Sprint 3.8 — fire the roulette spin SFX at the same moment the
    // visual roll starts; the synth's decelerating clicks + final
    // chime line up with the spin animation.
    // Sprint 4.0 — slowed visual reveal from 400ms to 2500ms so the
    // wheel reads as a real "gambling" deceleration. Audio extended
    // to ~2.5–3s in synths.ts to match.
    // Sprint 4.1 — pulled back to 2300ms (~1.5× faster than 4.0)
    // after the 2.5s felt sluggish in repeated play; still reads as
    // a deliberate deceleration rather than a quick blip.
    audio.play('rouletteSpin');
    session.dispatch({ type: 'spinStart', now: Date.now(), manual });
    setTimeout(() => {
      // Rolls only from pieces the player actually has on the board, and
      // passes the turn if nothing at all can be done with the bag
      // (step.ts spinLand).
      const events = session.dispatch({ type: 'spinLand' });
      if (events.some((e) => e.type === 'rouletteSpin' && e.slots === null)) setSelected(null);
    }, 2300);
  }

  /** The ending this board is in under the current mode's rules, if any. */
  function boardEnding(
    nextState: BoardState,
    lastMoveWasRotation: boolean = false,
  ): Exclude<GameStatus, 'active'> | null {
    return gameEnding(gameMode, nextState, lastMoveWasRotation);
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
  }, [logLocal.moves.length, state.topologyState, gameStatus]);

  const { mpMatchLive, mpClock } = useGameClocks({
    isMultiplayer,
    mpSync,
    watchingGame,
    logLocal,
    gameStatus,
    setClockMs,
    soloTcSec,
    state,
  });

  function toggleHelpTools() {
    setHelpToolsEnabled((v) => {
      const next = !v;
      try {
        localStorage.setItem('subutai_help_tools', next ? '1' : '0');
      } catch { /* private mode */ }
      if (!next) {
        setShowSupport(false);
        setShowThreats(false);
        setHintMove(null);
      }
      return next;
    });
  }

  // S2.4 — engine hint. A short synchronous search (~0.5s) is fine for a
  // deliberate button press. Classic mode only: roulette's slot
  // restrictions aren't modeled by the bare search, so its "best move"
  // could be illegal this turn.
  function computeHint() {
    if (currentPlayer !== 'human' || gameStatus !== 'active' || watchingGame) return;
    if (gameMode !== 'classic') return;
    const result = searchPosition(state, {
      budgetMs: 500,
      maxDepth: 5,
      lastMoveWasRotation: state.lastMoveWasRotation,
    });
    const best = result.bestMove;
    if (!best) return;
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
      const reply = searchPosition(rotated, {
        budgetMs: 300,
        maxDepth: 4,
        lastMoveWasRotation: true,
      });
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
    const events = session.dispatch({ type: 'rotate', now: Date.now() });
    if (events.length === 0) return;
    setSelected(null);
    setPreviewTopology(null);
    // R10 — the streamer rotated: settle the chat's guess round.
    if (gameMode !== 'roulette') announceGuessWinners(moveVoting.resolveGuessRotate());
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
    gameStatus,
    clockMs,
    soloTcSec,
    log,
    aiTimerRef,
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

  const {
    applyAiSpin,
    executeAiRouletteAction,
    scheduleAiMove,
    scheduleAutoMove,
  } = useBotScheduler({
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
  });

  const lastMoveWasRotation =
    log.moves.length > 0 &&
    log.moves[log.moves.length - 1]?.move.kind === 'topologyToggle';

  const { materialBreakdown, materialScore } = useMaterial({ state, myColor });

  useBotTurn({
    isAutoMode,
    autoStopped,
    autoTimerRef,
    isMultiplayer,
    watchingGame,
    gameStatus,
    gameMode,
    state,
    legalMoves,
    allowedPieceTypes,
    rouletteActionsLeft,
    usedRouletteSlots,
    aiTimerRef,
    currentPlayer,
    scheduleAutoMove,
    scheduleAiMove,
    applyAiSpin,
    executeAiRouletteAction,
    lastMoveWasRotation,
  });

  useChatVsBot({
    isAutoMode,
    isMultiplayer,
    watchingGame,
    setSelected,
    gameStatus,
    twitchVoteMode,
    gameMode,
    state,
    legalMoves,
    setSearchEvalFromWhite,
    setSearchMateInPlies,
    logLengthRef,
    commitAnalysis,
    handleRotate,
    isLocalMode,
    currentPlayer,
  });

  useGuessTheStreamer({
    isAutoMode,
    isMultiplayer,
    watchingGame,
    gameStatus,
    twitchVoteMode,
    gameMode,
    state,
    legalMoves,
    isLocalMode,
    currentPlayer,
  });

  useCaptureFx({
    setEnPassantExplosionSquare,
    registerFx,
    setCaptureFxSquare,
    setCaptureShake,
    setCaptureStrobe,
    setRotationDust,
    state,
    log,
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
      session.dispatch({ type: 'requestPromotion', from: move.from, to: move.to });
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
      const plan = beatMode.snapPlan(slideMs);
      if (plan) {
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
    announceGuessWinners(moveVoting.resolveGuessRound(resolvedMove, san));
    const afterMove = applyMove(state, resolvedMove);
    // The move itself (the board, the log, the roulette turn, the end of
    // the game) is step()'s: src/session/step.ts.
    session.dispatch({ type: 'move', move: resolvedMove, now: Date.now() });
    // SP-2 — score the move against the beat grid (no-op when music
    // sync is off). Display-only combo; leaderboard points untouched.
    beatBridge.reportMove();
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
    announceGuessWinners(moveVoting.resolveGuessRound(move, san));
    const next = applyMove(state, move);
    session.dispatch({ type: 'promote', piece: pieceType, now: Date.now() });
    setSelected(null);
    beatBridge.reportMove(); // SP-2 — promotion path counts too
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
    else session.dispatch({ type: 'cancelPromotion' });
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
    aiTimerRef,
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
    {bgGridOn && <BackgroundWaveGrid />}
    {flashEffect && (
      <div
        className={`screen-flash-effect screen-flash-${flashEffect}`}
        aria-hidden
      />
    )}
    {flashEffect === 'brilliant' && (
      <div className="brilliant-sparkles" aria-hidden>
        {sparklePositions.map((s, i) => (
          <span
            key={i}
            className="brilliant-sparkle"
            style={{
              left: `${s.x}vw`,
              top: `${s.y}vh`,
              animationDelay: `${s.delay}ms`,
              ['--sparkle-rot' as string]: `${s.rot}deg`,
            } as React.CSSProperties}
          >
            <Icon icon={Sparkles} size="md" aria-hidden />
          </span>
        ))}
      </div>
    )}
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
      <header className="app-header">
        {/* V1 — the left drawer opens from the LEFT edge of the header, the
            right one from the right: each button sits on the side its
            panel comes in from. */}
        <button
          type="button"
          className="mobile-panel-btn mobile-panel-btn-menu"
          data-tour="mobile-menu"
          onClick={() => setMobilePanel((v) => (v === 'menu' ? 'none' : 'menu'))}
          aria-expanded={mobilePanel === 'menu'}
          aria-label="Tools and settings"
        >
          <Icon icon={Menu} size="md" aria-hidden />
        </button>
        <div className="app-brand">
          <NeonLogo />
          <h1>subutai</h1>
          {/* Stitch layout: the mock's LIVE strip replaces
              the plain tagline. Solo shows a short seed-derived game tag. */}
          <div className="live-strip">
            {/* V1 — the pill reports the real game state: LIVE while a
                game is running, READY before the first move, OVER after
                the result. */}
            {(() => {
              const mpLive = isMultiplayer && mpSync
                ? mpSync.matchState.status === 'active' && !mpSync.matchState.outcome
                : false;
              const phase: 'live' | 'ready' | 'over' = isMultiplayer
                ? (mpLive ? 'live' : 'over')
                : gameStatus !== 'active'
                  ? 'over'
                  : log.moves.length > 0
                    ? 'live'
                    : 'ready';
              return (
                <span className={`live-pill is-${phase}`}>
                  <span className="live-dot" aria-hidden />
                  {phase === 'live' ? 'LIVE' : phase === 'over' ? 'OVER' : 'READY'}
                </span>
              );
            })()}
            {(() => {
              // V1 — this line is the first thing to go when the header
              // runs out of room. It is context, not a control: which
              // opponent and which game id. Below 600px it moves into the
              // LIVE pill's own tooltip, where a hover or a long-press
              // still reaches it, and the header stops being three things
              // fighting over one row.
              // The seed-derived game tag means nothing to read, so it
              // lives in the tooltip only; Classic's goal there is the one
              // Help states (checkmate), not the 50-move survival milestone.
              const label =
                isMultiplayer && mpSync
                  ? `vs ${mpSync.opponentDisplayName} · ${mpSync.matchState.code}`
                  : 'vs AI';
              const gameTag = `Game #${Math.abs(seed).toString(36).toUpperCase().slice(-5) || '0'}`;
              const hint =
                !isMultiplayer && gameMode === 'classic' && opponentMode === 'ai'
                  ? "Checkmate the AI's king to win"
                  : undefined;
              const title = isMultiplayer && mpSync ? label : hint ? `${hint} · ${gameTag}` : gameTag;
              return (
                <span className="live-title" title={title} data-label={label}>
                  {isMultiplayer && mpSync ? (
                    <>
                      vs <strong>{mpSync.opponentDisplayName}</strong> · {mpSync.matchState.code}
                    </>
                  ) : (
                    label
                  )}
                </span>
              );
            })()}
          </div>
        </div>
        <div className="mobile-panel-buttons">
          <button
            type="button"
            className="mobile-panel-btn"
            data-tour="mobile-setup"
            onClick={() => setMobilePanel((v) => (v === 'setup' ? 'none' : 'setup'))}
            aria-expanded={mobilePanel === 'setup'}
            aria-label="Game setup"
          >
            <Icon icon={SlidersHorizontal} size="md" aria-hidden />
          </button>
        </div>
        <div className="header-controls" data-tour="header">
          {STREAMING_UI && (
            <>
          <Tooltip text={showMusicDock ? 'Hide music dock' : 'Spotify + beat sync (beta)'} side="bottom">
            <button
              type="button"
              className={`header-action-btn${showMusicDock ? ' is-active' : ''}`}
              onClick={() => setShowMusicDock((v) => !v)}
              aria-label="Toggle music dock (beta)"
              aria-pressed={showMusicDock}
              data-tour="music"
            >
              <Icon icon={Disc3} size="md" aria-hidden />
              <span className="beta-corner" aria-hidden>β</span>
            </button>
          </Tooltip>
          <Tooltip text={showTwitch ? 'Hide Twitch chat' : 'Twitch chat + predictions (beta)'} side="bottom">
            <button
              type="button"
              className={`header-action-btn${showTwitch ? ' is-active' : ''}`}
              onClick={() => setShowTwitch((v) => !v)}
              aria-label="Toggle Twitch chat (beta)"
              aria-pressed={showTwitch}
              data-tour="twitch"
            >
              <Icon icon={Cast} size="md" aria-hidden />
              <span className="beta-corner" aria-hidden>β</span>
            </button>
          </Tooltip>
          <span className="rail-sep" aria-hidden />
            </>
          )}
          {/* fix/v1.1.4 — on a phone these two sit in the left drawer, and
              their dialogs render under it (and its scrim): close it first,
              as Change name does. */}
          <Tooltip
            text={user && displayName ? 'Send feedback' : 'Sign in to send feedback'}
            side="bottom"
            disabled={!user || !displayName}
          >
            <button
              type="button"
              className="header-action-btn"
              onClick={() => {
                setMobilePanel('none');
                setShowFeedbackModal(true);
              }}
              disabled={!user || !displayName}
              aria-label="Send feedback"
            >
              <Icon icon={MessageSquare} size="md" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip text="Rules & info" side="bottom">
            <button
              type="button"
              className="header-action-btn"
              onClick={() => {
                setMobilePanel('none');
                setShowHelp(true);
              }}
              aria-label="Rules & info"
            >
              <Icon icon={HelpCircle} size="md" aria-hidden />
            </button>
          </Tooltip>
          <span className="rail-sep rail-sep-tray" aria-hidden />
          <MusicToggle />
          <AudioToggle />
          <Effects3DToggle />
          <ThemeToggle />
        </div>
        {/* V1 — the two things a player reaches for most often stay in the
            top bar on every viewport: the leaderboard and their own name.
            Everything else lives in the left rail (desktop) / header row
            (mobile). */}
        <div className="topbar-actions">
          <button
            type="button"
            className="topbar-btn"
            onClick={() =>
              guardLeave('Open leaderboard', false, () =>
                busy.navigate('Opening leaderboard', () => setView('leaderboard')),
              )
            }
            aria-label="Leaderboard"
            title="Leaderboard"
          >
            <Icon icon={Trophy} size="md" aria-hidden />
            <span className="topbar-btn-label">Leaderboard</span>
          </button>
          {/* fix/v1.1.4 — the name is back here from 721px, where the
              header has room; CSS hides it on a phone, where PlayerRow
              in the setup drawer carries it. */}
          {displayName && (
            <UserMenu
              displayName={displayName}
              onChangeName={() => setShowNameModal(true)}
            />
          )}
        </div>
      </header>

      {watchingGame && (
        <div className="watch-banner">
          <span className="watch-banner-label">
            <Icon icon={Eye} size="sm" aria-hidden /> Watching <strong>{watchingGame.playerName}</strong>’s game ·
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

      {/* Sprint 4.0 — persistent "Your turn / Waiting" MP banner removed
          again (re-grew during the post-3.0 rewrites). Whose turn it is
          reads from the board + opponent panel; the local AFK alert
          covers the attention case. The waiting-for-opponent spinner
          is kept as a slim, non-text indicator so users still know the
          other side is acting — without the heavy banner. */}
      {isMultiplayer
        && mpSync
        && mpSync.matchState.status === 'active'
        && !mpSync.isMyTurn && (
        <div className="mp-banner mp-banner-wait">
          <span className="mp-spinner" aria-hidden />
          {mpSync.isRouletteMode && mpSync.rouletteSlots
            ? `${mpSync.opponentDisplayName} is acting…`
            : `Waiting for ${mpSync.opponentDisplayName}…`}
        </div>
      )}

      {isMultiplayer &&
        mpSync &&
        mpSync.selfAfkWarning &&
        mpSync.matchState.status === 'active' && (
          <div className="mp-banner mp-banner-warn">
            <Icon icon={AlarmClock} size="sm" aria-hidden /> Make a move soon — auto-forfeit in ~30s.
          </div>
        )}

      {isMultiplayer && mpSync && mpSync.error && (
        <div className="mp-banner mp-banner-error">{mpSync.error}</div>
      )}

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
        <div className="tournament-clock" aria-label="Game clocks">
          {(['white', 'black'] as const).map((side) => {
            const soloCountdown = mpClock === null && soloTcSec !== null;
            // V1 — the running half is lit in the theme accent when it is
            // YOUR clock and in the opponent accent when it is not, so the
            // two are never confusable at a glance. Online it follows the
            // colour you were actually dealt; in hot-seat nobody is "you",
            // so the two seats simply get the two colours.
            const mine = side === (isMultiplayer ? mpSync?.myColor ?? 'white' : 'white');
            return (
              <ClockFace
                key={side}
                side={side}
                running={state.sideToMove === side}
                mine={mine}
                countdown={mpClock ? mpClock.countdown : soloCountdown}
                ms={
                  soloCountdown
                    ? Math.max(0, soloTcSec * 1000 - clockMs[side])
                    : clockMs[side]
                }
                mp={mpClock ? { clock: mpClock, now: serverNow } : null}
              />
            );
          })}
        </div>
      )}
      {/* Sprint 2.7.1 — the roulette panel now only renders when there
          is actual slot or spinning state to show. Pre-spin attention
          is handled by the compact .spin-roulette-btn-compact in the
          board-actions row, so the wide banner is gone. */}
      {gameMode === 'roulette' &&
        gameStatus === 'active' &&
        !watchingGame &&
        (allowedPieceTypes || isRouletteSpinning) && (
        <div className="roulette-panel">
          <div className="roulette-display">
            {allowedPieceTypes ? (
              allowedPieceTypes.map((t, i) => {
                const isUsed = usedRouletteSlots.includes(i);
                // Sprint 4.0 — render the piece in the *turn-owner's*
                // colour, not in state.sideToMove. During action 2 of
                // an MP roulette turn the local engine flips
                // sideToMove only on the active client (Q.D.3 override
                // in the `state` IIFE above); on the opposite client
                // sideToMove still reads as the just-flipped value,
                // so the bag visualised in the wrong colour. Deriving
                // owner from mpSync.isMyTurn + myColor keeps both
                // clients in sync.
                const rouletteOwner: 'white' | 'black' = isMultiplayer && mpSync
                  ? (mpSync.isMyTurn
                      ? mpSync.myColor
                      : (mpSync.myColor === 'white' ? 'black' : 'white'))
                  : state.sideToMove;
                return (
                  <span
                    key={i}
                    className={`roulette-face roulette-face-${t}${isUsed ? ' slot-used' : ''}`}
                  >
                    <span className={`piece piece-${rouletteOwner}`}>
                      {glyphForPiece(rouletteOwner, t)}
                    </span>
                  </span>
                );
              })
            ) : (
              Array.from({ length: ROULETTE_SLOT_COUNT }, (_, i) => (
                <span key={i} className="roulette-face roulette-face-rolling">?</span>
              ))
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
        </div>
      )}
      {/* Sprint 4.2 — per-side action rows in local 2P mode. Top row
          mirrors the bottom one but is visually flipped 180° so the
          opposite-sitting player sees it upright. Buttons mirror the
          subset of the main action row that matters during a hot-seat
          game (resign / draw offer / preview rotation / commit rotation).
          A draw offer made to black takes the place of black's turn chip
          and Offer button until black answers it or a move retires it;
          the rest of the row stays, so black can still resign, or rotate
          if it is black's turn. */}
      {isLocalMode && gameStatus === 'active' && (
        <div
          className="local-actions local-actions-top"
          aria-hidden={state.sideToMove !== 'black' && !localBlackAnswers}
        >
          {localBlackAnswers ? (
            <DrawOfferPrompt
              text="White offers a draw"
              onAnswer={(accept) => answerLocalDraw('black', accept)}
            />
          ) : (
            <LocalTurnSlot side="black" toMove={state.sideToMove} />
          )}
          <button
            type="button"
            className="action-btn resign-btn"
            onClick={() => requestResign('black')}
            disabled={log.moves.length === 0}
            aria-label="Resign (black)"
            title="Resign"
          >
            <Icon icon={Flag} size="md" aria-hidden />
          </button>
          {!localBlackAnswers && (
            <button
              type="button"
              className={`action-btn draw-offer-btn${localBlackBlock === 'offered' ? ' is-pending' : ''}`}
              onClick={() => offerLocalDraw('black')}
              disabled={localBlackBlock !== null}
              aria-label="Offer a draw (black)"
              title={drawOfferTitle(localBlackBlock, 'White')}
            >
              <Icon icon={Handshake} size="md" aria-hidden />
            </button>
          )}
          <button
            type="button"
            className={`action-btn preview-btn${previewLocked ? ' active' : ''}`}
            onClick={() => {
              if (previewLocked) {
                setPreviewLocked(false);
                setLockedPreviewTopology(null);
              } else {
                setPreviewLocked(true);
                setLockedPreviewTopology(state.topologyState === 'A' ? 'B' : 'A');
              }
            }}
            aria-label={previewLocked ? 'Unlock rotation preview' : 'Preview rotation'}
            title={previewLocked ? 'Unlock preview' : 'Preview rotation'}
          >
            <Icon icon={Eye} size="md" aria-hidden />
          </button>
          <button
            type="button"
            className={`rotate-btn-icon${encourageRotate && canRotate && state.sideToMove === 'black' ? ' is-hint-pulsing' : ''}`}
            onClick={handleRotate}
            // Black's own move only: handleRotate rotates for the side to
            // move, and this row is lit on white's turn too while black
            // has a draw offer to answer.
            disabled={!canRotate || state.sideToMove !== 'black'}
            aria-label={`Rotate ${state.topologyState} to ${state.topologyState === 'A' ? 'B' : 'A'}`}
            title="Rotate board"
          >
            <Icon icon={RotateCw} size="md" aria-hidden />
            <span className="rotate-label-text" aria-hidden>
              {state.topologyState}{' → '}{state.topologyState === 'A' ? 'B' : 'A'}
            </span>
          </button>
        </div>
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
      {vizOn && <PerimeterEqualizer />}
      <div
        className={`board${previewTopology || previewLocked ? ' previewing' : ''}${recentRotation ? ' is-rotated' : ''}${
          recentRotation && beatMode.isEnabled() && beatEngine.isRunning() ? ' is-rotated-beat' : ''
        }`}
        data-topology={displayTopology}
        style={
          {
            width: boardSize,
            height: boardSize,
            // M.15 — in Beat Mode the rotate "swings" in time: one beat
            // long, springy. --rotate-ms = the live beat period.
            ...(recentRotation && beatMode.isEnabled() && beatEngine.getIntervalMs() > 0
              ? { '--rotate-ms': `${Math.round(beatEngine.getIntervalMs())}ms` }
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
          const flip = isMultiplayer && mpSync?.myColor === 'black';
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
                  stroke="var(--support-stroke, var(--accent-teal-bright))"
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
                  stroke="var(--support-hover-stroke, var(--accent-orange))"
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
        {arrowAnnotations.length > 0 && (
          <svg
            className="annotation-overlay"
            width={boardSize}
            height={boardSize}
            viewBox={`0 0 ${boardSize} ${boardSize}`}
            aria-hidden
          >
            <defs>
              {(['green', 'red', 'yellow', 'blue'] as const).map((c) => (
                <marker
                  key={c}
                  id={`annotation-arrowhead-${c}`}
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="4"
                  markerHeight="4"
                  orient="auto"
                >
                  <path
                    d="M 0 0 L 10 5 L 0 10 z"
                    className={`annotation-arrow-head annotation-color-${c}`}
                  />
                </marker>
              ))}
            </defs>
            {arrowAnnotations.map((arrow, i) => {
              const annFlip = isMultiplayer && mpSync?.myColor === 'black';
              const fromC = tilePixelCenter(arrow.from, displayTopology, layout);
              const toC = tilePixelCenter(arrow.to, displayTopology, layout);
              const fromX = annFlip ? boardSize - fromC.cx : fromC.cx;
              const fromY = annFlip ? boardSize - fromC.cy : fromC.cy;
              const toX = annFlip ? boardSize - toC.cx : toC.cx;
              const toY = annFlip ? boardSize - toC.cy : toC.cy;
              // Pull the arrow tip in by ~30% of a tile so it doesn't
              // bury itself in the destination piece.
              const dx = toX - fromX;
              const dy = toY - fromY;
              const dist = Math.hypot(dx, dy) || 1;
              const inset = tileBase * 0.3;
              const endX = toX - (dx / dist) * inset;
              const endY = toY - (dy / dist) * inset;
              return (
                <line
                  key={`${arrow.from}-${arrow.to}-${arrow.color}-${i}`}
                  x1={fromX}
                  y1={fromY}
                  x2={endX}
                  y2={endY}
                  className={`annotation-arrow annotation-color-${arrow.color}`}
                  markerEnd={`url(#annotation-arrowhead-${arrow.color})`}
                />
              );
            })}
          </svg>
        )}
        {voteRound && (() => {
          // R1 — variant arrows: the live vote round on the board. Slate
          // rounds (predict / vs-streamer) keep candidate order — the color
          // IS the ballot slot (!1 green, !2 red, !3 yellow, !4 blue), so
          // arrows must not reshuffle as counts change. Freeform rounds
          // (chat-vs-bot) have an unbounded slate — show the top 4 by
          // votes, labelled with the count instead of a slot number.
          const VARIANT_COLORS = ['green', 'red', 'yellow', 'blue'] as const;
          const withIdx = voteRound.candidates
            .map((c, idx) => ({ c, idx, count: voteRound.counts[idx] ?? 0 }))
            .filter((x) => x.c.move.from && x.c.move.to);
          const shown = voteRound.freeform
            ? [...withIdx].sort((a, b) => b.count - a.count || a.idx - b.idx).slice(0, 4)
            : withIdx.slice(0, 4);
          if (shown.length === 0) return null;
          const maxCount = Math.max(1, ...shown.map((x) => x.count));
          const revealed = voteRound.revealIdx !== null;
          return (
            <svg
              className="variant-overlay"
              width={boardSize}
              height={boardSize}
              viewBox={`0 0 ${boardSize} ${boardSize}`}
              aria-hidden
            >
              <defs>
                {VARIANT_COLORS.map((c) => (
                  <marker
                    key={c}
                    id={`variant-arrowhead-${c}`}
                    viewBox="0 0 10 10"
                    refX="6"
                    refY="5"
                    markerWidth="3.2"
                    markerHeight="3.2"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" className={`annotation-color-${c}`} />
                  </marker>
                ))}
              </defs>
              {shown.map(({ c, idx, count }, slot) => {
                const from = c.move.from as SquareId;
                const to = c.move.to as SquareId;
                const color = VARIANT_COLORS[voteRound.freeform ? slot : idx];
                const fromC = tilePixelCenter(from, displayTopology, layout);
                const toC = tilePixelCenter(to, displayTopology, layout);
                const dx = toC.cx - fromC.cx;
                const dy = toC.cy - fromC.cy;
                const dist = Math.hypot(dx, dy) || 1;
                const inset = tileBase * 0.32;
                const endX = toC.cx - (dx / dist) * inset;
                const endY = toC.cy - (dy / dist) * inset;
                // Vote share drives the stroke: even a losing option stays
                // readable, the leader visibly bulks up.
                const width = tileBase * (0.09 + 0.1 * (count / maxCount));
                const isWinner = revealed && voteRound.revealIdx === idx;
                const cls = revealed
                  ? isWinner
                    ? 'variant-arrow variant-arrow-winner'
                    : 'variant-arrow variant-arrow-loser'
                  : 'variant-arrow';
                // Label sits a third of the way along the arrow, nudged
                // perpendicular so it doesn't ride the line itself.
                const lx = fromC.cx + dx * 0.33 - (dy / dist) * tileBase * 0.28;
                const ly = fromC.cy + dy * 0.33 + (dx / dist) * tileBase * 0.28;
                const label = voteRound.freeform ? `×${count}` : `!${idx + 1}`;
                return (
                  <g key={`${from}-${to}-${idx}`}>
                    <line
                      x1={fromC.cx}
                      y1={fromC.cy}
                      x2={endX}
                      y2={endY}
                      className={`${cls} annotation-color-${color}`}
                      style={
                        {
                          strokeWidth: width,
                          strokeDasharray: isWinner
                            ? 'none'
                            : `${tileBase * 0.22} ${tileBase * 0.16}`,
                          // R9 — the march animation must shift by EXACTLY
                          // one dash+gap cycle or the loop restart jumps.
                          '--dash-cycle': `${tileBase * 0.38}px`,
                        } as React.CSSProperties
                      }
                      markerEnd={`url(#variant-arrowhead-${color})`}
                    />
                    <text
                      x={lx}
                      y={ly}
                      className={`variant-arrow-label annotation-color-${color}`}
                      style={{ fontSize: tileBase * 0.3 }}
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      {label}
                    </text>
                  </g>
                );
              })}
            </svg>
          );
        })()}
        {checkVignette && (
          <div
            className="check-vignette"
            style={{ '--fx-intensity': fxIntensity } as React.CSSProperties}
            aria-hidden
          />
        )}
        {captureStrobe && (
          <div
            className={`capture-strobe is-${captureStrobe}`}
            style={{ '--fx-intensity': fxIntensity } as React.CSSProperties}
            aria-hidden
          />
        )}
        {rotationDust && <div className="rotation-dust" aria-hidden />}
        {irisKingPos && mateSeqActive && (
          <div
            className="checkmate-iris"
            style={{
              '--iris-cx': `${irisKingPos.cx}px`,
              '--iris-cy': `${irisKingPos.cy}px`,
            } as React.CSSProperties}
            aria-hidden
          />
        )}
        {mateKingPos && mateSeq === 'shatter' && (
          <div
            className="checkmate-shatter"
            style={{ left: `${mateKingPos.cx}px`, top: `${mateKingPos.cy}px` } as React.CSSProperties}
            aria-hidden
          />
        )}
        {guessCloud.length > 0 && (
          <div className="guess-cloud" aria-live="polite">
            {guessCloud.map((n) => (
              <span
                key={n.key}
                className="guess-cloud-nick"
                style={
                  {
                    left: `${n.x}%`,
                    top: `${n.y}%`,
                    fontSize: `${n.size}rem`,
                    animationDelay: `${n.delay}ms`,
                    '--nick-rot': `${n.rot}deg`,
                    ...(n.color ? { color: n.color } : null),
                  } as React.CSSProperties
                }
              >
                {n.name}
              </span>
            ))}
          </div>
        )}
      </div>
      {/* Sprint 4.2 — coords overlay lives OUTSIDE .board so the labels
          stay still while the board itself can rotate / preview-rotate.
          Earlier attempts kept the labels inside the tiles, which meant
          the .board rotation transform dragged them along. */}
      {(() => {
        const flip = isMultiplayer && mpSync?.myColor === 'black';
        const previewing = !!(previewTopology || previewLocked);
        return (
          <div
            className={`board-coords-overlay${previewing ? ' previewing' : ''}`}
            data-topology={displayTopology}
            aria-hidden
            style={{ width: boardSize, height: boardSize }}
          >
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
              const rankChar = flip ? String(i + 1) : String(8 - i);
              const fileChar = flip
                ? String.fromCharCode('a'.charCodeAt(0) + (7 - i))
                : String.fromCharCode('a'.charCodeAt(0) + i);
              return (
                <span key={`coord-row-${i}`}>
                  <span
                    className="board-coord board-coord-rank"
                    style={{ top: i * tileBase + 3, left: 4 }}
                  >
                    {rankChar}
                  </span>
                  <span
                    className="board-coord board-coord-file"
                    style={{ left: (i + 1) * tileBase - 12, bottom: 3 }}
                  >
                    {fileChar}
                  </span>
                </span>
              );
            })}
          </div>
        );
      })()}
      </div>
      </div>

      {/* V1 — the white seat uses the standard .board-actions row below,
          exactly like every other mode. The mirrored row above the board
          is the only local-mode extra (it serves the player sitting on the
          far side). The old duplicate bottom row is gone: it repeated
          resign / preview / rotate one row above the real one and pushed
          the layout past the board's frame. */}

      {pendingPromotion && (
        <div className="promotion-backdrop" onClick={cancelPromotion}>
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
                  {/* DEF-12: the promoting side owns the pawn on the last
                      rank = the side to move while the dialog is open. The
                      old code hardcoded white, so Black's picker showed white
                      glyphs (cosmetic; the committed piece was always right). */}
                  <span className={`piece piece-${state.sideToMove}`}>
                    {glyphForPiece(state.sideToMove, type)}
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
        {/* A draw offer made to this row's player (white in hot-seat, me
            online) takes the place of the turn chip (and the Offer
            button), as in black's hot-seat row above. */}
        {rowDraw?.answers ? (
          <DrawOfferPrompt
            text={`${rowDraw.opponent} offers a draw`}
            onAnswer={rowDraw.answer}
            disabled={rowDraw.busy}
          />
        ) : (
          isLocalMode &&
          gameStatus === 'active' && <LocalTurnSlot side="white" toMove={state.sideToMove} />
        )}
        {/* Sprint 3.2.1 \u2014 six icon buttons consolidated into one
            cohesive bar with a single divider between the meta-controls
            (Reset / Lock / Resign) and the in-game toggles (Support /
            Threat / Preview). Lock no longer reads as a stray button \u2014
            it's middle-of-the-row inside the same container. */}
        <div className="action-buttons-group">
          <Tooltip text="New game" side="top">
            <button
              type="button"
              className="action-btn"
              onClick={() => guardLeave('Start a new game', true, startNewGame)}
              aria-label="New game"
            >
              <Icon icon={RotateCw} size="md" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip
            text={formationLocked ? 'Unlock formation (next game random)' : 'Lock formation (keep this 960)'}
            side="top"
          >
            <button
              type="button"
              className={`action-btn${formationLocked ? ' active' : ''}`}
              onClick={toggleFormationLock}
              aria-label={formationLocked ? 'Unlock formation' : 'Lock formation'}
            >
              <Icon icon={Lock} size="md" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip text="Resign \u2014 half points, no bonus" side="top">
            <button
              type="button"
              className="action-btn resign-btn"
              onClick={() => requestResign('white')}
              disabled={!!watchingGame || gameStatus !== 'active' || log.moves.length === 0 || botThinking}
              aria-label="Resign"
            >
              <Icon icon={Flag} size="md" aria-hidden />
            </button>
          </Tooltip>
          {rowDraw && !rowDraw.answers && (
            <Tooltip text={drawOfferTitle(rowDraw.block, rowDraw.opponent)} side="top">
              <button
                type="button"
                className={`action-btn draw-offer-btn${rowDraw.block === 'offered' ? ' is-pending' : ''}`}
                onClick={rowDraw.offer}
                disabled={!rowDraw.open || rowDraw.block !== null || rowDraw.busy}
                aria-label="Offer a draw"
              >
                <Icon icon={Handshake} size="md" aria-hidden />
              </button>
            </Tooltip>
          )}
          {/* Sprint 4.2 — hide threat/support insight tools in local
              2P mode for a cleaner hot-seat UX (one device, two humans
              sharing the screen; coaching arrows are distracting). */}
          {opponentMode !== 'local' && (
            <>
              <span className="action-group-divider" aria-hidden />
              {/* S2.4 — master switch for the coaching group. Off hides
                  (and deactivates) support / threat / hint so the row
                  reads as plain chess. */}
              <Tooltip
                text={helpToolsEnabled ? 'Hide coaching tools' : 'Show coaching tools (support, threats, hint)'}
                side="top"
              >
                <button
                  type="button"
                  className={`action-btn${helpToolsEnabled ? ' active' : ''}`}
                  onClick={toggleHelpTools}
                  data-tour="coach"
                  aria-label="Toggle coaching tools"
                  aria-pressed={helpToolsEnabled}
                >
                  <Icon icon={GraduationCap} size="md" aria-hidden />
                </button>
              </Tooltip>
              {helpToolsEnabled && (
                <>
                  <Tooltip text="Support map (who backs whom)" side="top">
                    <button
                      type="button"
                      className={`action-btn${showSupport ? ' active' : ''}`}
                      onClick={() => setShowSupport((v) => !v)}
                      aria-label="Toggle support map"
                      aria-pressed={showSupport}
                    >
                      <Icon icon={ArrowRight} size="md" aria-hidden />
                    </button>
                  </Tooltip>
                  <Tooltip text="Threat map" side="top">
                    <button
                      type="button"
                      className={`action-btn${showThreats ? ' active' : ''}`}
                      onClick={() => setShowThreats((v) => !v)}
                      aria-label="Toggle threat map"
                      aria-pressed={showThreats}
                    >
                      <Icon icon={AlertTriangle} size="md" aria-hidden />
                    </button>
                  </Tooltip>
                  {/* V1 — no engine hints against another person. The
                      support and threat maps read the position you can
                      already see; the hint runs a search and hands you a
                      move, which in an online game is just an engine at
                      the board. Hot-seat keeps it: both players share the
                      screen and can see it being used. */}
                  {gameMode === 'classic' && !isMultiplayer && (
                    <Tooltip text="Hint: engine suggests a move" side="top">
                      <button
                        type="button"
                        className={`action-btn${hintMove ? ' active' : ''}`}
                        onClick={computeHint}
                        disabled={currentPlayer !== 'human' || gameStatus !== 'active' || !!watchingGame}
                        aria-label="Show a hint"
                      >
                        <Icon icon={Lightbulb} size="md" aria-hidden />
                      </button>
                    </Tooltip>
                  )}
                </>
              )}
            </>
          )}
          <Tooltip
            text={previewLocked ? 'Unlock rotation preview' : 'Preview rotation (click locks it)'}
            side="top"
          >
            <button
              type="button"
              className={`action-btn preview-btn${previewLocked ? ' active' : ''}`}
              disabled={currentPlayer !== 'human'}
              data-tour="preview"
              aria-label={previewLocked ? 'Unlock rotation preview' : 'Preview rotation'}
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
            <Icon icon={Eye} size="md" aria-hidden />
          </button>
          </Tooltip>
        </div>

        {/* Sprint 2.7.1 \u2014 compact spin button replaces the old wide
            roulette banner. Lives inline among the board-actions row.
            Sprint 3.2 \u2014 the auto-spin effects (solo + MP) take over
            after the first manual spin, so before that the button is
            briefly visible every turn and immediately unmounted by
            auto-spin ~500ms later, producing a flicker + layout shift.
            Gating on `!firstRouletteSpinDone` means the button is only
            rendered for the literal first turn of the game (where it
            actually needs to be clicked); afterwards auto-spin handles
            every subsequent turn without the button mounting at all. */}
        {gameMode === 'roulette' &&
          gameStatus === 'active' &&
          !watchingGame &&
          allowedPieceTypes === null &&
          !isRouletteSpinning &&
          currentPlayer === 'human' &&
          !firstRouletteSpinDone && (
          <div className="action-group">
            <button
              type="button"
              className="spin-roulette-btn-compact"
              onClick={handleSpinRoulette}
              title="Spin the roulette for this turn"
            >
              <Icon icon={Dices} size="md" aria-hidden /> Spin
            </button>
          </div>
        )}

        <Tooltip
          text={`Rotate topology ${state.topologyState} → ${state.topologyState === 'A' ? 'B' : 'A'}`}
          side="top"
          disabled={!canRotate}
        >
          <button
            type="button"
            className={`rotate-btn-icon${(showRotateHint || (hintMove && 'rotate' in hintMove) || encourageRotate) && canRotate ? ' is-hint-pulsing' : ''}`}
            onClick={handleRotate}
            disabled={!canRotate}
            data-tour="rotate"
            aria-label={`Rotate topology ${state.topologyState} → ${state.topologyState === 'A' ? 'B' : 'A'}`}
          >
            <Icon icon={RotateCw} size="md" aria-hidden />
            <span className="rotate-label-text" aria-hidden>
              {state.topologyState}{' → '}{state.topologyState === 'A' ? 'B' : 'A'}
            </span>
            {/* Not over a draw offer: on a phone the row wraps and the
                bubble would sit on the Accept / Decline card. */}
            {showRotateHint && canRotate && !rowDraw?.answers && (
              <span className="rotate-hint-tooltip" role="status">
                <span>Try rotating the board! +15 pts, +25 more if it sets up a capture</span>
                {/* span-as-button: a real <button> here would nest inside
                    the rotate <button>, which is invalid HTML (React 19
                    logs hydration errors for it). */}
                <span
                  role="button"
                  tabIndex={0}
                  className="rotate-hint-dismiss"
                  aria-label="Dismiss hint"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissRotateHint();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      dismissRotateHint();
                    }
                  }}
                >
                  ×
                </span>
              </span>
            )}
          </button>
        </Tooltip>
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
      </div>

      <div className="position-label-wrap">
        {/* S2.1 — Replay import and formation editing clobber local game
            state, which in MP would split-brain against the Firestore
            board, and while watching would corrupt the stop-restore
            backup. Both controls are live-local-game-only. */}
        {!isMultiplayer && !watchingGame && (
        <button
          type="button"
          className="position-replay-btn"
          onClick={() =>
            guardLeave('Load a replay', true, () => {
              setReplayError(null);
              setShowReplayDialog(true);
            })
          }
          title="Paste a move log to replay a game"
        >
          <Icon icon={Upload} size={12} aria-hidden /> Load replay
        </button>
        )}
        {/* V1 rev 3 — the code IS the control.
            It used to be a read-only label with a separate "Set position"
            button next to it, which put two objects on screen for one
            idea. The code now sits quiet and flat until you touch it;
            clicking it grows the chip and turns the code itself into the
            field you type in. Nothing else on the row changes size, so
            the growth is the whole affordance. */}
        {isMultiplayer || watchingGame ? (
          <span className="position-code is-static" title="This game's Chess960 starting rank">
            <span className="position-label-key">960</span>
            <span className="position-code-value">{positionLabel}</span>
          </span>
        ) : formationInputMode ? (
          <span className="position-code is-editing">
            <span className="position-label-key">960</span>
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
              onBlur={commitFormationOnBlur}
              placeholder="RQKRNBBN"
              maxLength={8}
              aria-label="Chess960 starting rank"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="characters"
            />
            {formationInputValue && !isValidChess960Key(formationInputValue.trim().toUpperCase()) && (
              <span className="position-input-error">Invalid 960 code</span>
            )}
          </span>
        ) : (
          <button
            type="button"
            className="position-code"
            onClick={() =>
              guardLeave('Set a new position', true, () => {
                setFormationInputValue(positionLabel);
                setFormationInputMode(true);
              })
            }
            title="Click to start from a specific Chess960 position"
          >
            <span className="position-label-key">960</span>
            <span className="position-code-value">{positionLabel}</span>
            <Icon icon={Pencil} size={11} className="position-code-pencil" aria-hidden />
          </button>
        )}
      </div>
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
        {/* V1 — while a replay is playing, the whole setup panel is inert.
            Its controls used to stay live, so picking "Local" mid-replay
            mounted the hot-seat UI on top of someone else's game and let
            it rotate. Nothing in here means anything until the replay is
            stopped, so nothing in here can be pressed. */}
        <section
          className={`sidebar-panel sidebar-opponent${watchingGame ? ' is-inert' : ''}`}
          inert={watchingGame ? true : undefined}
        >
          <h2 className="sidebar-panel-title">Game setup</h2>
          {watchingGame && (
            <p className="setup-inert-note">
              Replay in progress. Stop it to change the game setup.
            </p>
          )}
          <h3 className="setup-sub-label">Opponent</h3>
          {/* Sprint 4.3.1 — when a local game is in progress, lock all
              non-local opponent tabs behind a confirm dialog so a stray
              tap can't silently abandon the game. The lock is "soft":
              the button is visually dimmed (.is-locked) but still
              dispatches click → confirm, instead of being natively
              disabled (which would also suppress the click handler). */}
          {(() => {
            const oppLocked = gameInProgress && !isMultiplayer && !watchingGame;
            const lockedTitle = 'Finish or resign the current game first';
            // An online match (live, or ended with its result still up)
            // cannot be switched away from here: a hard lock, like the
            // mode cards, since no dialog could leave the match cleanly.
            const oppOnlineLock = isMultiplayer;
            const onlineLockedTitle = mpMatchLive
              ? 'Finish or resign the online match first'
              : 'Close the match result first';
            return (
              <div className="opponent-tabs-vertical">
                <button
                  type="button"
                  className={`opp-tab${opponentMode === 'ai' ? ' is-active' : ''}${oppLocked ? ' is-locked' : ''}`}
                  onClick={() => requestOpponentChange('ai')}
                  aria-disabled={oppLocked || undefined}
                  disabled={oppOnlineLock}
                  title={oppOnlineLock ? onlineLockedTitle : oppLocked ? lockedTitle : 'Play vs the engine'}
                >
                  <Icon icon={Bot} size="md" aria-hidden />
                  <span>vs AI</span>
                </button>
                {/* V1 — "vs Friend" undersold this tab: it is the whole
                    online side (quick match against a stranger, or a
                    private 6-letter code). "Online" pairs naturally with
                    "Local" and matches what the lobby actually offers. */}
                <button
                  type="button"
                  className={`opp-tab${opponentMode === 'friend' ? ' is-active' : ''}${oppLocked ? ' is-locked' : ''}`}
                  onClick={() => requestOpponentChange('friend')}
                  aria-disabled={oppLocked || undefined}
                  title={
                    oppOnlineLock
                      ? onlineLockedTitle
                      : oppLocked
                        ? lockedTitle
                        : 'Play a real opponent: quick match, or a private code'
                  }
                  disabled={!user || !displayName || oppOnlineLock}
                >
                  <Icon icon={Users} size="md" aria-hidden />
                  <span>Online</span>
                </button>
                {/* Sprint 4.1 — Local hot-seat. Both colours play from this
                    device; the AI scheduler short-circuits via the
                    isLocalMode flag in the currentPlayer derivation. */}
                <button
                  type="button"
                  className={`opp-tab${opponentMode === 'local' ? ' is-active' : ''}`}
                  onClick={() => requestOpponentChange('local')}
                  disabled={oppOnlineLock}
                  title={oppOnlineLock ? onlineLockedTitle : 'Hot-seat: both players on this device'}
                >
                  <Icon icon={UsersRound} size="md" aria-hidden />
                  <span>Local</span>
                </button>
              </div>
            );
          })()}

          {/* Stitch layout: mode cards moved here from
              above the board — the mock's GAME SETUP panel owns opponent,
              mode and time control together. */}
          <h3 className="setup-sub-label">Mode</h3>
          <div className="game-mode-cards" data-tour="modes">
            <button
              type="button"
              className={`mode-card${gameMode === 'classic' ? ' is-active' : ''}`}
              disabled={modeToggleLocked}
              title={modeToggleLocked ? 'Finish or restart the game to change modes' : 'Classic chess rules'}
              onClick={() => {
                if (gameMode === 'classic') return;
                // Also drops a spun bag and stops the wheel (step.ts setMode).
                session.dispatch({ type: 'setMode', mode: 'classic' });
              }}
            >
              <span className="mode-card-icon" aria-hidden>
                <Icon icon={Crosshair} size="xl" strokeWidth={1.75} />
              </span>
              <span className="mode-card-content">
                <span className="mode-card-title">Classic</span>
                <span className="mode-card-subtitle">
                  Standard Chess960 + topology rotation
                </span>
              </span>
            </button>
            <button
              type="button"
              className={`mode-card${gameMode === 'roulette' ? ' is-active' : ''}`}
              disabled={modeToggleLocked}
              title={modeToggleLocked ? 'Finish or restart the game to change modes' : 'Spin a 4-slot bag · 2 actions/turn (move or rotate)'}
              onClick={() => {
                if (gameMode === 'roulette') return;
                session.dispatch({ type: 'setMode', mode: 'roulette' });
              }}
            >
              <span className="mode-card-icon" aria-hidden>
                <Icon icon={Dices} size="xl" strokeWidth={1.75} />
              </span>
              <span className="mode-card-content">
                <span className="mode-card-title">Roulette</span>
                <span className="mode-card-subtitle">
                  Capture-the-king · spin the wheel
                </span>
              </span>
            </button>
          </div>

          {/* Solo time control: flips the S2.5 elapsed chips into remaining
              countdowns. Display-only — nobody loses on time vs the bot.
              MP time control comes from the lobby, so the pills lock there. */}
          {/* V1 — bot strength. Solo vs AI only; locked once a game is on
              (a mid-game switch would silently change the opponent). */}
          {opponentMode === 'ai' && !isMultiplayer && (
            <>
              <h3 className="setup-sub-label">Bot strength</h3>
              <div className="tc-pills" role="radiogroup" aria-label="Bot strength">
                {BOT_STRENGTHS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={botLevel === level}
                    className={`tc-pill${botLevel === level ? ' is-active' : ''}${level === 'strong' ? ' is-ranked' : ''}`}
                    disabled={modeToggleLocked}
                    title={
                      modeToggleLocked
                        ? 'Finish or restart the game to change the bot'
                        : BOT_STRENGTH_HINT[level]
                    }
                    onClick={() => setBotLevel(level)}
                  >
                    {BOT_STRENGTH_LABEL[level]}
                  </button>
                ))}
              </div>
              <p className="setup-hint">{BOT_STRENGTH_SUMMARY[botLevel]}</p>
            </>
          )}
          <h3 className="setup-sub-label">Time control</h3>
          <div className="tc-pills" role="radiogroup" aria-label="Time control">
            {([
              [null, 'None'],
              [60, '1 min'],
              [180, '3 min'],
              [600, '10 min'],
            ] as const).map(([sec, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={soloTcSec === sec}
                className={`tc-pill${soloTcSec === sec ? ' is-active' : ''}`}
                disabled={isMultiplayer || modeToggleLocked}
                title={
                  isMultiplayer
                    ? 'Time control is set in the match lobby'
                    : modeToggleLocked
                      ? 'Finish or restart the game to change the clock'
                      : sec === null
                        ? 'Free play: clocks just count time spent'
                        : `Each side gets ${label}. Run out and you lose on time`
                }
                onClick={() => session.dispatch({ type: 'setTimeControl', sec })}
              >
                {label}
              </button>
            ))}
          </div>
          {soloTcSec !== null && !isMultiplayer && (
            <p className="setup-hint">Clocks start on the first move. Out of time = loss.</p>
          )}
        </section>

        <section className="sidebar-panel sidebar-moves">
          <h2 className="sidebar-panel-title">
            Moves ({Math.ceil(log.moves.length / 2)})
          </h2>
          {log.moves.length === 0 ? (
            <div className="move-log-empty">No moves yet.</div>
          ) : (
            <pre ref={moveLogScrollRef} className="move-log-text">
              {notationString}
            </pre>
          )}
          <button
            type="button"
            className="copy-btn"
            onClick={copyNotation}
            disabled={log.moves.length === 0}
          >
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
        </section>

        <section className="sidebar-panel sidebar-analysis" data-tour="analysis">
          <h2 className="sidebar-panel-title">Analysis</h2>
          {(() => {
            if (searchMateInPlies != null) {
              const movesToMate = Math.ceil(Math.abs(searchMateInPlies) / 2);
              const fromMy =
                myColor === 'white' ? searchMateInPlies : -searchMateInPlies;
              const cls = fromMy > 0 ? 'positive' : 'negative';
              return (
                <div className={`analysis-eval ${cls}`}>
                  {fromMy > 0 ? '+' : '-'}M{movesToMate}
                </div>
              );
            }
            if (!isMultiplayer && searchEvalFromWhite === null) {
              return <div className="analysis-eval">…</div>;
            }
            const cp = myPerspectiveEval;
            const cls = cp > 30 ? 'positive' : cp < -30 ? 'negative' : '';
            return (
              <div className={`analysis-eval ${cls}`}>
                {cp >= 0 ? '+' : ''}
                {(cp / 100).toFixed(2)}
              </div>
            );
          })()}
          {log.moves.length > 0 && (
            <div className="analysis-last">
              Last move:&nbsp;
              <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>
                {log.moves[log.moves.length - 1]?.san ??
                  `${log.moves[log.moves.length - 1]?.move.from ?? ''}→${log.moves[log.moves.length - 1]?.move.to ?? ''}`}
              </span>
            </div>
          )}
          {/* Sprint 3.4.1 — Review CTA moved out of the board-actions
              row into the Analysis panel, where it reads as the natural
              next step after viewing the eval. */}
          {/* S2.1 — mid-match the local `log` belongs to the previous
              single-player game, so Review here would open the wrong
              game. Finished matches review via the end-of-match dialog. */}
          <button
            type="button"
            className="panel-action-btn"
            onClick={() =>
              busy.navigate('Opening review', () => {
                // fix/v1.1.4 — the drawer would still be open on the way back.
                setMobilePanel('none');
                setView('review');
              })
            }
            disabled={log.moves.length === 0 || isMultiplayer}
            title={isMultiplayer ? 'Review opens from the end-of-match screen' : undefined}
          >
            <Icon icon={BarChart3} size="md" aria-hidden />
            Review {isMultiplayer ? '(after the match)' : log.moves.length > 0 ? 'this game' : '(no moves yet)'}
          </button>
        </section>
      </aside>
      </div>

      {showReplayDialog && (
        <div className="help-backdrop" onClick={() => setShowReplayDialog(false)}>
          <div className="help-dialog replay-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Replay from log</h2>
            <p>Paste a move log in the same format as “Copy to clipboard”.</p>
            <textarea
              className="replay-textarea"
              value={replayText}
              onChange={(e) => setReplayText(e.target.value)}
              placeholder='[Chess960 "RQKRNBBN"]\n[Seed "123"]\n\n1. e2→e4  e7→e5\n2. A→B  g8→f6\n…'
              rows={10}
              aria-label="Move log to replay"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
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

      {/* V1 — the status bar used to say "Ready" / "In play" and a raw move,
          which told the player nothing they could act on. It now answers the
          one question a status bar should: whose move is it, and how far
          along are we. */}
      <footer className="app-status-bar">
        {(() => {
          const lastEntry = log.moves[log.moves.length - 1];
          const lastText = lastEntry
            ? lastEntry.san ?? `${lastEntry.move.from ?? ''}→${lastEntry.move.to ?? ''}`
            : null;
          const fullMoves = Math.ceil(log.moves.length / 2);
          let tone: 'over' | 'mine' | 'theirs' | 'idle' = 'idle';
          let text: string;
          if (gameStatus !== 'active') {
            tone = 'over';
            text = gameOverMessage ?? 'Game over';
          } else if (watchingGame) {
            text = `Watching ${watchingGame.playerName}'s game`;
          } else if (isMultiplayer && mpSync) {
            tone = mpSync.isMyTurn ? 'mine' : 'theirs';
            text = mpSync.isMyTurn
              ? 'Your move'
              : `${mpSync.opponentDisplayName} is thinking`;
          } else if (isLocalMode) {
            tone = 'mine';
            text = `${state.sideToMove === 'white' ? 'White' : 'Black'} to move`;
          } else if (currentPlayer === 'human') {
            tone = 'mine';
            text = log.moves.length === 0 ? 'Your move: make the first one' : 'Your move';
          } else {
            tone = 'theirs';
            text = 'Bot is thinking';
          }
          return (
            <>
              <span className={`status-chip status-chip-${tone}`}>
                <span className="status-dot" aria-hidden />
                {text}
              </span>
              <span className="status-meta">
                <span className="status-meta-item">
                  Move <strong>{fullMoves}</strong>
                </span>
                {lastText && (
                  <span className="status-meta-item">
                    Last <strong className="status-mono">{lastText}</strong>
                  </span>
                )}
              </span>
            </>
          );
        })()}
      </footer>

      {!isMultiplayer && (
        <MemoryPanel
          onGameActivate={(g) =>
            guardLeave('Open this saved game', true, () => onMemoryGameActivate(g))
          }
        />
      )}

      {/* The name prompt waits its turn behind BOTH the welcome screen and
          the tour. It used to wait only for the welcome screen, so taking
          the "start the tour" button dropped a modal straight on top of
          the first tour step — the field sat over the tooltip and neither
          could be read. The tour teaches; the name is what you pick once
          you have decided to stay, so it comes after. Skipping the tour
          still brings it up immediately. */}
      {!authLoading && user && !displayName && !showWelcome && !showTutorial && (
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
          onCancel={() => setConfirmingResign(null)}
        />
      )}

      {pendingLeave && (
        <ConfirmDialog
          title={pendingLeave.title}
          message={pendingLeave.message}
          confirmLabel={pendingLeave.confirmLabel}
          cancelLabel="Keep playing"
          danger
          onConfirm={() => {
            const go = pendingLeave.run;
            setPendingLeave(null);
            go();
          }}
          onCancel={() => setPendingLeave(null)}
        />
      )}

      {pendingOpponentChange && (
        <ConfirmDialog
          title="Abandon current game?"
          message="Switching opponent will end the game in progress and start fresh."
          confirmLabel="Abandon game"
          cancelLabel="Keep playing"
          danger
          onConfirm={() => {
            const next = pendingOpponentChange;
            setPendingOpponentChange(null);
            applyOpponentChange(next);
            startNewGame();
          }}
          onCancel={() => setPendingOpponentChange(null)}
        />
      )}

      {isMultiplayer && mpSync && mpEndOutcome && !endgameSceneActive && (() => {
        const myView = translateOutcomeForPlayer(
          mpEndOutcome,
          {
            uid: mpSync.myUid,
            displayName: '',
            color: mpSync.myColor,
          },
          mpSync.matchState.host.uid,
        );
        const opp = mpSync.opponentDisplayName;
        // QA-04 — a flag fall or an inactivity forfeit is not a resignation.
        // The match says which it was (endReason); one ended by an older
        // client does not, and falls back to the clock and this tab.
        const endReason = mpSync.matchState.endReason;
        const resignCause =
          endReason === 'flag'
            ? 'timeout'
            : endReason === 'inactive' || endReason === 'resign'
              ? endReason
              : myView === 'human-resign' && mpSelfResignedRef.current === mpSync.matchState.code
                ? 'resign'
                : mpResignCause({ ...mpSync.matchState, outcome: mpEndOutcome });
        const headline =
          myView === 'human-win'
            ? `You won vs ${opp}!`
            : myView === 'human-resign'
              ? resignCause === 'timeout'
                ? `You ran out of time vs ${opp}.`
                : resignCause === 'resign'
                  ? `You resigned vs ${opp}.`
                  : resignCause === 'inactive'
                    ? `You left the game vs ${opp}.`
                    : `You lost vs ${opp}.`
              : myView === 'ai-win'
                ? `You lost vs ${opp}.`
                : `Draw vs ${opp}.`;
        const loserName =
          mpEndOutcome === 'host-resign'
            ? mpSync.matchState.host.displayName
            : mpSync.matchState.guest?.displayName ?? 'Guest';
        const subline =
          mpEndOutcome === 'host-resign' || mpEndOutcome === 'guest-resign'
            ? resignCause === 'timeout'
              ? `${loserName} ran out of time.`
              : resignCause === 'resign'
                ? `${loserName} resigned.`
                : resignCause === 'inactive'
                  ? `${loserName} left the game.`
                  : `${loserName} resigned or left the game.`
            : mpEndOutcome === 'draw'
              ? endReason === 'agreement'
                ? 'Draw by agreement.'
                : 'Match drawn.'
              : `${mpEndOutcome === 'white-win' ? 'White' : 'Black'} wins by checkmate.`;
        function dismiss() {
          busy.navigate('Back to the board', () => {
            setMpEndOutcome(null);
            setActiveMatch(null);
            setOpponentMode('ai');
            setView('game');
          });
        }
        function backToLobby() {
          busy.navigate('Opening the lobby', () => {
            setMobilePanel('none');
            setMpEndOutcome(null);
            setActiveMatch(null);
            mpSavedGameIdRef.current = null;
            mpWroteOutcomeRef.current = null;
            setView('friend-lobby');
          });
        }
        function reviewMatch() {
          if (!mpSync) return;
          // Snapshot the match log so leaving the live match doesn't pull
          // the data out from under the review screen. classifyAsync will
          // populate per-move analysis on the fly inside GameReview.
          // Snapshot NOW, before the deferred switch: the live match is
          // torn down inside it.
          const snapshot = deriveMpLog(mpSync.matchState);
          const meta = {
            playerName: displayName ?? 'You',
            opponentName: mpSync.opponentDisplayName,
            outcome: myView,
          };
          busy.navigate('Opening review', () => {
            setActiveReviewLog(snapshot);
            setActiveReviewMeta(meta);
            setMpEndOutcome(null);
            setActiveMatch(null);
            setView('review');
          });
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
                  <Icon icon={BarChart3} size="md" aria-hidden /> Review this game
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
                Online games don&apos;t affect leaderboard points.
              </p>
            </div>
          </div>
        );
      })()}

      {/* R13/BUG-5 kept local hot-seat OUT of finishGame/GameSummary on
          purpose (a 2-humans-one-device game has no "human" to attribute
          a personal-best/leaderboard entry to) - but that meant its ending
          was just a text banner with no modal and no explicit "new game"
          prompt, unlike every other mode. Reuses the MP completion dialog's
          styling (mp-completion-*) - same shape, no scoring, just the
          outcome + a clear way to start again. */}
      {isLocalMode && gameStatus !== 'active' && !localGameOverDismissed && !endgameSceneActive && log.moves.length > 0 && (
        <div
          className="mp-completion-backdrop"
          onClick={() => setLocalGameOverDismissed(true)}
        >
          <div className="mp-completion-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="mp-completion-title">Game over</h2>
            <p className="mp-completion-headline">{gameOverMessage}</p>
            <div className="mp-completion-actions">
              <button
                type="button"
                className="mp-btn mp-btn-primary"
                onClick={() => {
                  setLocalGameOverDismissed(true);
                  startNewGame();
                }}
              >
                Start new game
              </button>
              <button
                type="button"
                className="mp-btn mp-btn-secondary"
                onClick={() => setLocalGameOverDismissed(true)}
              >
                Keep viewing board
              </button>
            </div>
          </div>
        </div>
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
        <div className="help-backdrop" onClick={() => setShowHelp(false)}>
          <div className="help-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Subutai &mdash; Auxetic Chess960</h2>
            <p>
              Subutai combines <strong>Chess960</strong> (Fischer random chess) with an
              <strong> <a href="https://www.youtube.com/shorts/RLO48ETn6LE" target="_blank" rel="noopener noreferrer"> auxetic board</a></strong> that can rotate between two stable states.
            </p>
            <p><strong>How it works:</strong></p>
            <ul>
              <li>The board is divided into 4&times;4 blocks of 2&times;2 squares.</li>
              <li>Pressing <em>Rotate</em> flips all blocks &plusmn;90&deg;, reshuffling
                which squares are adjacent. This <strong>costs your turn</strong> but
                earns a <strong>+15 point bonus</strong> (up to 4 per game), and
                <strong> +25 more</strong> if you capture within your next two moves.</li>
              <li>Hover the eye button to preview the rotation; <strong>click</strong> the eye to
                temporarily lock the rotated view for inspection (click again to unlock). This is not the move.</li>
              <li><em>Support map</em> (arrow button): shows which of your pieces are backed up by others (arrows from supporter to supported).</li>
              <li><em>Threat map</em> (warning button): tints squares the opponent attacks. Hover a threatened square to highlight the threatening pieces.</li>
              <li>The starting position is a random Chess960 arrangement.</li>
              <li><strong>Classic mode:</strong> standard chess rules — you cannot move into check, checkmate ends the game.</li>
              <li><strong>Roulette mode:</strong> capture-the-king variant. Each turn you spin a 4-slot bag of random
                piece types and get <strong>2 actions</strong>. Each action is either a move (using one of the slot's
                piece types) or a Rotate. There's no check rule — leaving your king attacked is legal, but the
                opponent can capture it on their next move to win.</li>
            </ul>
            <p>
              <a href="https://en.wikipedia.org/wiki/Fischer_random_chess" target="_blank" rel="noopener noreferrer">
                Chess960 on Wikipedia
              </a>
            </p>
            {/* R14 — display scale: CSS zoom on <body>, persisted. The fix
                for "everything is tiny on a big monitor". */}
            <div className="help-scale-row">
              <label htmlFor="ui-scale">
                Display scale
                <span className="help-scale-val">{Math.round(uiScale * 100)}%</span>
              </label>
              <input
                id="ui-scale"
                type="range"
                min={0.8}
                max={1.5}
                step={0.05}
                value={uiScale}
                onChange={(e) => pickUiScale(Number.parseFloat(e.target.value))}
                aria-label="Interface scale"
              />
              {uiScale !== 1 && (
                <button
                  type="button"
                  className="help-scale-reset"
                  onClick={() => pickUiScale(1)}
                  aria-label="Reset interface scale to 100%"
                >
                  100%
                </button>
              )}
            </div>
            <div className="help-dialog-actions">
              <button
                type="button"
                className="help-tour-btn"
                onClick={() => {
                  setShowHelp(false);
                  setShowTutorial(true);
                }}
              >
                Replay tutorial
              </button>
              <button type="button" className="help-close-btn" onClick={() => setShowHelp(false)}>
                Close
              </button>
            </div>
            {/* fix/v1.1.4 — which build this is, for bug reports. */}
            <p className="help-version">Subutai v{__APP_VERSION__}</p>
          </div>
        </div>
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

      {/* T3 — Twitch chat + predictions overlay. gameKey resets the
          vote round per game; the result is derived once the status
          leaves 'active'. */}
      {/* SP — Spotify dock: embed player + tap-tempo beat sync + mic
          equalizer controls. */}
      {STREAMING_UI && showMusicDock && (
        <Suspense fallback={null}>
          <MusicDock onClose={() => setShowMusicDock(false)} />
        </Suspense>
      )}
      {/* SP-2 — on-beat combo overlay; renders null while idle. */}
      <BeatCombo />
      {/* R12 — session beat-points tally (compact pill, click to expand). */}
      <MusicScorePanel />

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
            gameKey={logLocal.id}
            gameResult={(() => {
              if (gameStatus === 'checkmate') {
                return state.sideToMove === 'white' ? 'black' : 'white';
              }
              if (gameStatus === 'king_captured_white_wins') return 'white';
              if (gameStatus === 'king_captured_black_wins') return 'black';
              if (gameStatus === 'resigned_white') return 'black';
              if (gameStatus === 'resigned_black') return 'white';
              if (gameStatus.startsWith('draw')) return 'draw';
              return null;
            })()}
            onClose={() => {
              // Closing the overlay also stops gating AI moves —
              // otherwise the game would silently pause 15s per move.
              moveVoting.setMode('off');
              setShowTwitch(false);
            }}
          />
        </Suspense>
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

export default App;
