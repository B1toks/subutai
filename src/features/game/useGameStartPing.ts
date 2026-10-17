import { useRef, useEffect } from 'react';
import type { User } from 'firebase/auth';
import { gamesRepo } from '../../infra/firestore/games';
import type { GameMode } from '../../shared/game';
import type { GameLog } from '../../recording/log';

interface UseGameStartPingArgs {
  isAutoMode: boolean;
  user: User | null;
  displayName: string | null;
  isMultiplayer: boolean;
  seed: number;
  gameMode: GameMode;
  log: GameLog;
  positionLabel: string;
}

/**
 * Records that a signed-in player started a solo game (on their first
 * move, once per game), so a game left unfinished still counts as begun.
 */
export function useGameStartPing({
  isAutoMode,
  user,
  displayName,
  isMultiplayer,
  seed,
  gameMode,
  log,
  positionLabel,
}: UseGameStartPingArgs) {
  // R15: abandonment ping — one doc per solo run, on the human's first move.
  // finishGame only fires on completed games, so without this "quit vs lost"
  // is unmeasurable. Same user/displayName gate as the save keeps the two
  // series comparable. Ref dedupes per log.id (survives re-renders, resets
  // with each new game's fresh id).
  const startPingedLogIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (isAutoMode || isMultiplayer) return;
    if (!user || !displayName) return;
    if (log.moves.length === 0) return; // HUMAN_COLOR is white — first entry is the human's
    if (startPingedLogIdRef.current === log.id) return;
    startPingedLogIdRef.current = log.id;
    gamesRepo.logStart({
      uid: user.uid,
      chess960Id: positionLabel,
      seed,
      gameMode,
    });
  }, [isAutoMode, isMultiplayer, user, displayName, log, positionLabel, seed, gameMode]);
}
