import { createPositionFromBackRankKey, type BoardState, type SquareId } from '../../engine';
import { applyMove } from '../../engine/moves';
import { applyRotationMove } from '../../engine/auxetic';
import type { MatchDoc } from '../../firebase/matches';
import type { GameLog } from '../../recording/log';

/** Rebuild the canonical board from the log. Topology toggles (Rotate)
 *  flow through here just like any other move (Stage T1). */
export function rebuildBoardFromMatch(match: MatchDoc): BoardState {
  let state = createPositionFromBackRankKey(match.chess960Id);
  for (const entry of match.log.moves) {
    if (entry.move.kind === 'topologyToggle') {
      state = applyRotationMove(state);
      continue;
    }
    if (!entry.move.from || !entry.move.to) continue;
    state = applyMove(state, entry.move);
  }
  return state;
}

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
