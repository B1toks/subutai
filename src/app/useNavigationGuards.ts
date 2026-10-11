import { useState, type Dispatch, type SetStateAction } from 'react';
import { busy } from '../ui/busy';
import type { WatchingGame } from '../features/review/watching';

interface UseNavigationGuardsArgs {
  setPendingOpponentChange: Dispatch<SetStateAction<'ai' | 'friend' | 'local' | null>>;
  setView: Dispatch<SetStateAction<'game' | 'review' | 'leaderboard' | 'friend-lobby'>>;
  opponentMode: 'ai' | 'friend' | 'local';
  setOpponentMode: Dispatch<SetStateAction<'ai' | 'friend' | 'local'>>;
  isMultiplayer: boolean;
  watchingGame: WatchingGame | null;
  setMobilePanel: Dispatch<SetStateAction<'none' | 'menu' | 'setup'>>;
  mpMatchLive: boolean;
  gameInProgress: boolean;
}

/**
 * What may take the player off the board, and when it asks first.
 * Switching opponent mid-game opens a confirm, and is blocked outright
 * while an online match is on the board; picking one closes the phone
 * drawer. guardLeave asks before anything that replaces a game in progress
 * or walks away from a live online match.
 */
export function useNavigationGuards({
  setPendingOpponentChange,
  setView,
  opponentMode,
  setOpponentMode,
  isMultiplayer,
  watchingGame,
  setMobilePanel,
  mpMatchLive,
  gameInProgress,
}: UseNavigationGuardsArgs) {
  // Sprint 4.3.1 — opponent switch with a guard for active local games.
  // Sprint 5.0 (S2.1) — generalized to ANY in-progress non-MP game.
  // Previously only local games confirmed; switching ai→local mid-game
  // silently converted a live AI game into hot-seat, and ai→friend
  // suspended it under the lobby. Every mode now has one exit rule:
  // finish, resign, or explicitly abandon via the dialog.
  function requestOpponentChange(next: 'ai' | 'friend' | 'local') {
    if (next === opponentMode) return;
    // An online match owns the board until it is left through its own
    // exits (resign, or the result dialog). Switching underneath it used
    // to keep the match live and leave opponentMode behind it, so the
    // board fell into hot-seat the moment the match was dismissed.
    if (isMultiplayer) return;
    if (gameInProgress && !isMultiplayer && !watchingGame) {
      // fix/v1.1.4 — the confirm renders inside .app-root under the
      // phone drawer (z 940 over the dialog's 300); it was hidden behind
      // the very panel the tab was tapped in.
      setMobilePanel('none');
      setPendingOpponentChange(next);
      return;
    }
    applyOpponentChange(next);
  }

  function applyOpponentChange(next: 'ai' | 'friend' | 'local') {
    // fix/v1.1.4 — picking an opponent is what starts the next game (or
    // opens the lobby), so the phone drawer it was picked in steps aside
    // and the board is in view. Settings inside the drawer (mode, bot,
    // clock) leave it open; the player is still choosing.
    setMobilePanel('none');
    if (next === 'friend') {
      busy.navigate('Opening the lobby', () => {
        setOpponentMode(next);
        setView('friend-lobby');
      });
      return;
    }
    setOpponentMode(next);
  }

  /**
   * V1 — one guard for everything that can take you out of a game.
   *
   * Each destructive control used to decide for itself whether to ask
   * first: switching opponent asked, "New game" did not, loading a replay
   * or a Chess960 code or a saved game from Memory did not — each of
   * those silently threw the game in progress away. And in an online
   * match nothing asked at all, although walking off to the leaderboard
   * leaves your clock running and the inactivity watchdog armed.
   *
   * `destroys` separates the two cases: actions that REPLACE the board
   * (always worth a question mid-game) from navigation that merely leaves
   * the board view (harmless solo, where the game waits for you, but not
   * online, where it does not).
   */
  const [pendingLeave, setPendingLeave] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    run: () => void;
  } | null>(null);
  const guardLeave = (what: string, destroys: boolean, run: () => void) => {
    if (watchingGame) {
      run();
      return;
    }
    if (isMultiplayer && mpMatchLive) {
      setPendingLeave({
        title: 'Leave the live match?',
        message:
          'The match keeps running while you are away: your clock keeps ticking, and a long absence is forfeited for inactivity.',
        confirmLabel: what,
        run,
      });
      return;
    }
    if (destroys && gameInProgress) {
      setPendingLeave({
        title: 'End the current game?',
        message: `${what} replaces the game in progress. It will not be saved as finished.`,
        confirmLabel: what,
        run,
      });
      return;
    }
    run();
  };
  return { requestOpponentChange, applyOpponentChange, pendingLeave, setPendingLeave, guardLeave };
}
