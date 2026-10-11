import { useRef, useEffect, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type { WatchingGame } from '../review/watching';
import type { GameStatus } from '../../shared/game';
import type { GameLog } from '../../recording/log';
import type { ToastContextValue } from '../../components/Toast';

interface UseSoloFlagFallArgs {
  isAutoMode: boolean;
  completedLogIdRef: RefObject<string | null>;
  isMultiplayer: boolean;
  watchingGame: WatchingGame | null;
  setSelected: Dispatch<SetStateAction<string | null>>;
  gameStatus: GameStatus;
  setGameStatus: Dispatch<SetStateAction<GameStatus>>;
  clockMs: { white: number; black: number };
  soloTcSec: number | null;
  log: GameLog;
  aiTimerRef: RefObject<number | null>;
  toast: ToastContextValue;
  isLocalMode: boolean;
}

/**
 * Solo time control: ends the game on time for the side whose clock runs
 * out, once per game, as a timed online match would. App calls it after
 * isLocalMode exists, since a hot-seat flag also marks the game complete.
 */
export function useSoloFlagFall({
  isAutoMode,
  completedLogIdRef,
  isMultiplayer,
  watchingGame,
  setSelected,
  gameStatus,
  setGameStatus,
  clockMs,
  soloTcSec,
  log,
  aiTimerRef,
  toast,
  isLocalMode,
}: UseSoloFlagFallArgs) {
  // V1 — solo time control flag-fall. When a side's remaining time hits
  // zero the game ends as a loss on time for that side, exactly like a
  // timed PvP match. Vs the bot the completion effect turns the terminal
  // status into ai-win / human-win and saves as usual; in local hot-seat
  // the banner is the ending (same as resign there). The clock only arms
  // after the first move (see the tick effect), so nobody flags while the
  // board is still untouched.
  const soloFlagLogIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (soloTcSec === null || isMultiplayer || isAutoMode || watchingGame) return;
    if (gameStatus !== 'active' || log.moves.length === 0) return;
    if (soloFlagLogIdRef.current === log.id) return;
    const flagged = (['white', 'black'] as const).find(
      (side) => soloTcSec * 1000 - clockMs[side] <= 0,
    );
    if (!flagged) return;
    soloFlagLogIdRef.current = log.id;
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    setSelected(null);
    setGameStatus(flagged === 'white' ? 'timeout_white' : 'timeout_black');
    if (isLocalMode) completedLogIdRef.current = log.id;
    toast.show(
      `${flagged === 'white' ? 'White' : 'Black'} ran out of time.`,
      'info',
      3200,
    );
  }, [
    clockMs,
    soloTcSec,
    isMultiplayer,
    isAutoMode,
    watchingGame,
    gameStatus,
    log.id,
    log.moves.length,
    isLocalMode,
    toast,
    aiTimerRef,
    completedLogIdRef,
    setGameStatus,
    setSelected,
  ]);
}
