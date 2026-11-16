import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { deserializeGameLog } from '../../firebase/games';
import { gamesRepo } from '../../infra/firestore/games';
import { session } from '../../session/session';
import type { TopologyState } from '../../engine';
import { replayBoardAt } from '../game/position';
import { useWatchAutoplay } from './useWatchAutoplay';
import type { GameBackup, WatchingGame } from './watching';
import { useSession } from '../../session/useSession';
import { boardOf, legalMovesOf, logOf, gameStatusOf, lastMoveOf } from '../game/boardView';

type View = 'game' | 'review' | 'leaderboard' | 'friend-lobby';

interface UseWatchingArgs {
  isMultiplayer: boolean;
  /** With the game on the board (read from the session), what is put aside
   *  while watching and put back after (App's state, as GameBackup holds it). */
  searchEvalFromWhite: number | null;
  searchMateInPlies: number | null;
  setSearchEvalFromWhite: Dispatch<SetStateAction<number | null>>;
  setSearchMateInPlies: Dispatch<SetStateAction<number | null>>;
  formationLocked: boolean;
  setFormationLocked: Dispatch<SetStateAction<boolean>>;
  lockedFormationKey: string | null;
  setLockedFormationKey: Dispatch<SetStateAction<string | null>>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setPreviewTopology: Dispatch<SetStateAction<TopologyState | null>>;
  /** A game that cannot be shown says so (the ?game=<id> banner). */
  setSharedGameError: Dispatch<SetStateAction<string | null>>;
  setView: Dispatch<SetStateAction<View>>;
  /** The busy overlay while the own game is put back (ui/busy). */
  beginBusy: (label: string) => void;
  /** Memory's autosave markers, put back with the game (useMemoryAutosave). */
  liveSavedGameIdRef: RefObject<string>;
  savedForLogIdRef: RefObject<string | null>;
  completedLogIdRef: RefObject<string | null>;
}

/**
 * Watching a leaderboard game, and its state (the watched game, the own
 * game put aside, the autoplay timer): Watch puts the player's own game
 * aside (gameBackupRef), builds the whole replay first (v1.1.7: a game
 * that cannot be shown says so instead of reaching the error screen) and
 * loads its first position into the session; Prev / Next / Auto step
 * through it (the autoplay effect: useWatchAutoplay); Stop puts the own
 * game back, with its autosave markers. What the handlers read of the own
 * game comes from the session in the hook's render, so their closures hold
 * it as App's render had it. App
 * calls this before it works out whose game is on the board (isLocalMode
 * reads watchingGame).
 */
export function useWatching({
  isMultiplayer,
  searchEvalFromWhite,
  searchMateInPlies,
  setSearchEvalFromWhite,
  setSearchMateInPlies,
  formationLocked,
  setFormationLocked,
  lockedFormationKey,
  setLockedFormationKey,
  setSelected,
  setPreviewTopology,
  setSharedGameError,
  setView,
  beginBusy,
  liveSavedGameIdRef,
  savedForLogIdRef,
  completedLogIdRef,
}: UseWatchingArgs) {
  const seed = useSession((s) => s.seed);
  const state = useSession(boardOf(isMultiplayer));
  const initialState = useSession((s) => s.initial);
  const legalMoves = useSession(legalMovesOf(isMultiplayer));
  const log = useSession(logOf(isMultiplayer));
  const gameStatus = useSession(gameStatusOf);
  const lastMove = useSession(lastMoveOf(isMultiplayer));
  const [watchingGame, setWatchingGame] = useState<WatchingGame | null>(null);
  const watchAutoplayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameBackupRef = useRef<GameBackup | null>(null);

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

  useWatchAutoplay({ watchingGame, setWatchingGame, watchAutoplayRef, seekWatchTo });

  return { watchingGame, startWatching, seekWatchTo, toggleWatchAutoplay, stopWatching };
}
