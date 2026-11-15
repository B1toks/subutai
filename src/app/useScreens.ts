import { useState } from 'react';
import type { GameReviewMeta } from '../components/GameReview';
import { useSharedGame } from '../features/review/useSharedGame';
import type { GameLog } from '../recording/log';

export type View = 'game' | 'review' | 'leaderboard' | 'friend-lobby';

/**
 * Which screen is up, and what the Review shows when it is not the game on
 * the board: the screen (`view`), the Review's own game and its header
 * (a finished match, or a shared ?game=<id> link, which useSharedGame
 * opens once on load), and the banner for a game that could not be shown.
 * App picks the screen from `view` and keeps the screens' shells; the
 * setters go to whatever changes the screen (the header, the lobby, the
 * match's end, Watch, leaving the Review). The import of GameReview is a
 * type only, so its lazy chunk still loads only when Review opens.
 */
export function useScreens({ sharedGameId }: { sharedGameId: string | null }) {
  const [view, setView] = useState<View>('game');
  // T2: review can be entered for the LIVE game (default — reads the `log`
  // alias) OR with a snapshot loaded via the MP completion modal or the
  // ?game=<id> URL. activeReviewLog overrides when set; meta gives the
  // review header context ("Alex vs AI", "won/lost/drew").
  const [activeReviewLog, setActiveReviewLog] = useState<GameLog | null>(null);
  const [activeReviewMeta, setActiveReviewMeta] =
    useState<GameReviewMeta | null>(null);
  const [sharedGameError, setSharedGameError] = useState<string | null>(null);

  useSharedGame({
    sharedGameId,
    setView,
    setActiveReviewLog,
    setActiveReviewMeta,
    setSharedGameError,
  });

  return {
    view,
    setView,
    activeReviewLog,
    setActiveReviewLog,
    activeReviewMeta,
    setActiveReviewMeta,
    sharedGameError,
    setSharedGameError,
  };
}
