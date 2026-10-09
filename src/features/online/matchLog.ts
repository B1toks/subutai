import { createPositionFromBackRankKey, type SquareId } from '../../engine';
import type { MatchDoc } from '../../firebase/matches';
import type { GameLog } from '../../recording/log';

/** Reshape a live MatchDoc into the GameLog the single-player render code
 *  already knows how to consume. The stored move shape happens to be a
 *  superset of LoggedMove (analysis is absent in MP). */
export function deriveMpLog(live: MatchDoc): GameLog {
  return {
    id: `mp-${live.code}`,
    createdAt: new Date().toISOString(),
    randomSeed: live.seed,
    initialTopology: live.log.initialTopology,
    initialState: createPositionFromBackRankKey(live.chess960Id),
    moves: live.log.moves.map((m) => ({
      san: m.san,
      move: m.move,
      topology: m.topology,
      timestamp: m.timestamp,
    })),
  };
}

/** The squares to highlight for the match's last move; none after a rotation. */
export function deriveMpLastMove(
  live: MatchDoc,
): { from?: SquareId; to?: SquareId } | null {
  const last = live.log.moves[live.log.moves.length - 1]?.move;
  if (!last || last.kind === 'topologyToggle') return null;
  return { from: last.from, to: last.to };
}
