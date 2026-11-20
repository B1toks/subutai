import type { ComponentProps } from 'react';
import { AutoPlayView } from './AutoPlayView';
import { logOf } from '../game/boardView';
import { useSession } from '../../session/useSession';
import { AutoBoard } from './AutoBoard';
import type { useAutoPlay } from './useAutoPlay';

interface AutoRunProps {
  /** The run and its state (useAutoPlay). */
  auto: ReturnType<typeof useAutoPlay>;
  maxGames: number;
  /** What the run's board is drawn from (AutoBoard's own props). */
  board: ComponentProps<typeof AutoBoard>;
}

/**
 * The self-play run's screen (?auto): the panel with the run's counts and
 * the board beside it, as App rendered them inside its auto shell. The
 * game's move count comes from the session.
 */
export function AutoRun({ auto, maxGames, board }: AutoRunProps) {
  const log = useSession(logOf(board.isMultiplayer));
  const { autoMoveHistory } = auto;
  const avgMoves =
    autoMoveHistory.length > 0
      ? Math.round(
          autoMoveHistory.reduce((s, n) => s + n, 0) / autoMoveHistory.length,
        )
      : null;
  const currentFullMoves = Math.floor(log.moves.length / 2);
  return (
    <AutoPlayView
      gamesCompleted={auto.autoGamesCompleted}
      maxGames={maxGames}
      currentGameFullMoves={currentFullMoves}
      lastOutcome={auto.autoLastOutcome}
      avgGameMoves={avgMoves}
      stopped={auto.autoStopped}
      stoppedReason={auto.autoStoppedReason}
      onStop={auto.stopAuto}
      board={<AutoBoard {...board} />}
    />
  );
}
