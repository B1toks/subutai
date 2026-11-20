import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { deserializeGameLog } from '../../firebase/games';
import { gamesRepo } from '../../infra/firestore/games';
import type { GameLog } from '../../recording/log';
import type { GameReviewMeta } from './GameReview';

interface UseSharedGameArgs {
  sharedGameId: string | null;
  setView: Dispatch<SetStateAction<'game' | 'review' | 'leaderboard' | 'friend-lobby'>>;
  setActiveReviewLog: Dispatch<SetStateAction<GameLog | null>>;
  setActiveReviewMeta: Dispatch<SetStateAction<GameReviewMeta | null>>;
  setSharedGameError: Dispatch<SetStateAction<string | null>>;
}

/**
 * Opens a shared game (?game=<id>) in Review once, on load, or says why it
 * could not. The import of GameReview is a type only, so its lazy chunk
 * still loads only when Review opens.
 */
export function useSharedGame({
  sharedGameId,
  setView,
  setActiveReviewLog,
  setActiveReviewMeta,
  setSharedGameError,
}: UseSharedGameArgs) {
  // T2: load a shared game on mount when ?game=<id> is in the URL. Bypasses
  // every game/match flow — drops directly into the Review screen with
  // metadata derived from the doc. Shared games are read-only; the back
  // button strips the param so a refresh returns to the normal app.
  useEffect(() => {
    if (!sharedGameId) return;
    let cancelled = false;
    void gamesRepo.fetchSaved(sharedGameId)
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
  }, [sharedGameId, setActiveReviewLog, setActiveReviewMeta, setSharedGameError, setView]);
}
