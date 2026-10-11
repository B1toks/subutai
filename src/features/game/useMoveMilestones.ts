import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { WatchingGame } from '../review/watching';
import type { GameStatus } from '../../shared/game';
import type { GameLog } from '../../recording/log';
import type { ToastContextValue } from '../../components/Toast';

/** V1 — survival milestones below the 50-move modal. Percentages come from
 *  the R15 solo funnel (docs/R15-DATA-FINDINGS.md §1). */
const MOVE_MILESTONES: readonly { moves: number; text: string }[] = [
  { moves: 10, text: '10 moves. You are past the point where 40% of games end.' },
  { moves: 20, text: '20 moves. Longer than 72% of games. Keep it up.' },
  { moves: 30, text: '30 moves. Only 1 game in 10 gets this far.' },
];

interface UseMoveMilestonesArgs {
  isAutoMode: boolean;
  milestoneShown: boolean;
  setMilestoneShown: Dispatch<SetStateAction<boolean>>;
  setShowMilestoneModal: Dispatch<SetStateAction<boolean>>;
  opponentMode: 'ai' | 'friend' | 'local';
  isMultiplayer: boolean;
  watchingGame: WatchingGame | null;
  gameStatus: GameStatus;
  log: GameLog;
  toast: ToastContextValue;
}

/**
 * How far into a game the player has got: the 50-move dialog once per
 * game, and quiet toasts at moves 10, 20 and 30 in a solo game against
 * the bot.
 */
export function useMoveMilestones({
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
}: UseMoveMilestonesArgs) {
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
  }, [
    log.moves.length,
    gameStatus,
    milestoneShown,
    watchingGame,
    setMilestoneShown,
    setShowMilestoneModal,
  ]);

  // V1 — nearer milestones (data plan §4.2). R15 funnel: 40% of solo games
  // are over by move 10, 72% by move 20, 90% by move 30; 50 is reached by
  // 2%. The modal above stays the epic one; these are quiet toasts that
  // tell the player where they stand, once per tier per game. Solo vs the
  // bot only: hot-seat and PvP have no "survival" framing.
  const milestoneTiersRef = useRef<{ logId: string | null; fired: number[] }>({
    logId: null,
    fired: [],
  });
  useEffect(() => {
    // opponentMode (not isLocalMode): the latter is declared further down
    // the component and would be a TDZ read from this effect.
    if (watchingGame || isMultiplayer || opponentMode === 'local' || isAutoMode) return;
    if (gameStatus !== 'active') return;
    const tracker = milestoneTiersRef.current;
    if (tracker.logId !== log.id) {
      tracker.logId = log.id;
      tracker.fired = [];
    }
    const fullMoves = Math.floor(log.moves.length / 2);
    for (const tier of MOVE_MILESTONES) {
      if (fullMoves < tier.moves || tracker.fired.includes(tier.moves)) continue;
      tracker.fired.push(tier.moves);
      toast.show(tier.text, 'success', 3800);
    }
  }, [log.moves.length, log.id, gameStatus, watchingGame, isMultiplayer, opponentMode, isAutoMode, toast]);
}
