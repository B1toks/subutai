import type { Dispatch, SetStateAction } from 'react';
import type { GameReviewMeta } from '../features/review/GameReview';
import type { MatchDoc } from '../firebase/matches';
import type { useOnlineMatch } from '../features/online/useOnlineMatch';
import type { useClassifier } from '../features/game/useClassifier';
import type { WatchingGame } from '../features/review/watching';
import { unclassifiedMoveIndexes, type GameLog } from '../recording/log';
import { busy } from '../ui/busy';
import { useSession } from '../session/useSession';
import { logOf } from '../features/game/boardView';

type View = 'game' | 'review' | 'leaderboard' | 'friend-lobby';

interface UseScreenNavigationArgs {
  isMultiplayer: boolean;
  watchingGame: WatchingGame | null;
  /** The review's own game (a match or a shared game), if not the board's (App state). */
  activeReviewLog: GameLog | null;
  setActiveReviewLog: Dispatch<SetStateAction<GameLog | null>>;
  setActiveReviewMeta: Dispatch<SetStateAction<GameReviewMeta | null>>;
  /** F7 — classifies what the review left unclassified (useClassifier). */
  classifyImportedLog: ReturnType<typeof useClassifier>['classifyImportedLog'];
  startNewGame: () => void;
  /** The online match's state (useOnlineMatch): a match from the lobby
   *  becomes the match, and the previous one's result and save markers go. */
  mp: ReturnType<typeof useOnlineMatch>;
  setMobilePanel: Dispatch<SetStateAction<'none' | 'menu' | 'setup'>>;
  setView: Dispatch<SetStateAction<View>>;
}

/**
 * Two ways back to the board that App wrote inline in its screens: leaving
 * the Review (back to the game view, the classifier catching up, the
 * review's snapshot dropped, ?game= stripped) and a match starting from
 * the lobby (the solo world reset first, then the match, its drawer and
 * its markers). Plain handlers: the only React hook inside is useSession (the
 * game on the board, read in this render, as App's aliases are), with no
 * effect of its own; the rest of what they read is passed in from App's
 * render, so the call's position changes no effect order.
 */
export function useScreenNavigation({
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
}: UseScreenNavigationArgs) {
  const log = useSession(logOf(isMultiplayer));
  const { setActiveMatch, setMpEndOutcome, mpSavedGameIdRef, mpWroteOutcomeRef } = mp;
  function backFromReview() {
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
    });
  }

  function startMatchFromLobby(match: MatchDoc) {
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
  }

  return { backFromReview, startMatchFromLobby };
}
