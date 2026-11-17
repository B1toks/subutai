import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { formatNotation } from './notation';
import type { GameLog } from '../../recording/log';
import { gameOverText } from '../endgame/result';
import { useSession } from '../../session/useSession';
import { gameStatusOf, modeOf, boardOf, logOf } from './boardView';

interface UseNotationArgs {
  isMultiplayer: boolean;
  setCopied: Dispatch<SetStateAction<boolean>>;
  positionLabel: string;
  notationSeed: number;
}

/**
 * The game as text: the notation shown in the sidebar (with move-class
 * marks) and copied to the clipboard (without), the live log handed to
 * Review with its game mode, and the one-line game-over message.
 */
export function useNotation({
  isMultiplayer,
  setCopied,
  positionLabel,
  notationSeed,
}: UseNotationArgs) {
  const gameStatus = useSession(gameStatusOf);
  const gameMode = useSession(modeOf(isMultiplayer));
  const state = useSession(boardOf(isMultiplayer));
  const log = useSession(logOf(isMultiplayer));
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
