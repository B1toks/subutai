import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { formatNotation } from './notation';
import type { GameLog } from '../../recording/log';
import { gameOverText } from '../endgame/result';
import type { GameStatus, GameMode } from '../../shared/game';
import type { BoardState } from '../../engine';

interface UseNotationArgs {
  gameStatus: GameStatus;
  setCopied: Dispatch<SetStateAction<boolean>>;
  gameMode: GameMode;
  state: BoardState;
  log: GameLog;
  positionLabel: string;
  notationSeed: number;
}

/**
 * The game as text: the notation shown in the sidebar (with move-class
 * marks) and copied to the clipboard (without), the live log handed to
 * Review with its game mode, and the one-line game-over message.
 */
export function useNotation({
  gameStatus,
  setCopied,
  gameMode,
  state,
  log,
  positionLabel,
  notationSeed,
}: UseNotationArgs) {
  const buildNotation = useCallback(
    (annotate: boolean) => formatNotation(positionLabel, notationSeed, log.moves, gameMode, annotate),
    [log.moves, positionLabel, notationSeed, gameMode],
  );

  const notationString = useMemo(() => buildNotation(true), [buildNotation]);

  function copyNotation() {
    navigator.clipboard.writeText(buildNotation(false)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // V1 — the live log never carried gameMode (only saved games do), so a
  // roulette game reviewed straight from the board was analysed under
  // classic rules (no self-check) and worded as classic. Stamp it here;
  // memoised so GameReview's [log] effects don't re-run every render.
  const liveReviewLog = useMemo<GameLog>(
    () => (log.gameMode ? log : { ...log, gameMode }),
    [log, gameMode],
  );

  const gameOverMessage = useMemo(
    () => gameOverText(gameStatus, state.sideToMove),
    [gameStatus, state.sideToMove],
  );
  return { notationString, copyNotation, liveReviewLog, gameOverMessage };
}
