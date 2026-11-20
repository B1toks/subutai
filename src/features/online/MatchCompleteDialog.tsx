import { BarChart3 } from 'lucide-react';
import type { GameReviewMeta } from '../review/GameReview';
import { Icon } from '../../components/Icon';
import type { MultiplayerSyncHandle } from './useMultiplayerSync';
import { mpResignCause } from '../../firebase/matchEnd';
import type { MatchOutcome } from '../../firebase/matches';
import { translateOutcomeForPlayer } from '../../firebase/multiplayerGames';
import type { GameLog } from '../../recording/log';
import { busy } from '../../ui/busy';
import { deriveMpLog } from './matchLog';
import type { useOnlineMatch } from './useOnlineMatch';

type View = 'game' | 'review' | 'leaderboard' | 'friend-lobby';

interface MatchCompleteDialogProps {
  /** The match that ended, and how: App renders the dialog only once both
   *  are there (useOnlineMatch, useOnlineMatchEnd). */
  mpSync: MultiplayerSyncHandle;
  mpEndOutcome: MatchOutcome;
  /** The match's state (useOnlineMatch): whether this tab resigned it,
   *  and what the three exits clear (the result, the match, its save
   *  markers). */
  mp: ReturnType<typeof useOnlineMatch>;
  displayName: string | null;
  /** What else the exits change in App: the opponent, the view, the
   *  drawer, and the review's game. */
  setOpponentMode: (mode: 'ai' | 'friend' | 'local') => void;
  setView: (view: View) => void;
  setMobilePanel: (panel: 'none' | 'menu' | 'setup') => void;
  setActiveReviewLog: (log: GameLog | null) => void;
  setActiveReviewMeta: (meta: GameReviewMeta | null) => void;
}

/**
 * The end of an online match: who won and how (QA-04: a flag fall or an
 * inactivity forfeit is not called a resignation), and three exits:
 * review the game, back to the bot, or find another opponent. App renders
 * it once the match has an outcome, unless the endgame scene is playing.
 * Order does not matter.
 */
export function MatchCompleteDialog({
  mpSync,
  mpEndOutcome,
  mp,
  displayName,
  setOpponentMode,
  setView,
  setMobilePanel,
  setActiveReviewLog,
  setActiveReviewMeta,
}: MatchCompleteDialogProps) {
  const { setMpEndOutcome, setActiveMatch, mpSavedGameIdRef, mpWroteOutcomeRef } = mp;
  const selfResigned = mp.mpSelfResigned === mpSync.matchState.code;
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
        : myView === 'human-resign' && selfResigned
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
}
