import type { BoardState, Color, SquareId, TopologyState } from '../../engine';
import { allSquares } from '../../engine/board';
import {
  countAttackers,
  findCheckingPieces,
  findKing,
  getAttackerSquares,
  isInCheck,
  isSquareAttacked,
} from '../../engine/moves';
import { toggleTopology } from '../../engine/auxetic';
import type { LoggedMove } from '../../recording/log';
import type { GameMode } from '../../shared/game';

// What the board marks on its squares: the king in check and its checkers,
// the last moves, and the coaching overlays (threats, support).

/** The king in check and the pieces giving it. While a rotation is being
 *  previewed, the check is read off the rotated board instead. */
export function checkMarks(
  state: BoardState,
  previewTopology: TopologyState | null,
): { king: string | null; checkers: Set<string> } {
  const empty = { king: null as string | null, checkers: new Set<string>() };
  if (previewTopology && previewTopology !== state.topologyState) {
    const toggled = toggleTopology(state);
    const viewState: BoardState = { ...toggled, sideToMove: state.sideToMove };
    const king = findKing(viewState, state.sideToMove);
    if (!king) return empty;
    const opp = state.sideToMove === 'white' ? 'black' as const : 'white' as const;
    if (!isSquareAttacked(viewState, king, opp, viewState.topologyState)) return empty;
    return { king, checkers: new Set<string>(findCheckingPieces(viewState)) };
  }
  if (!isInCheck(state)) return empty;
  const king = findKing(state, state.sideToMove);
  const checkers = new Set<string>(findCheckingPieces(state));
  return { king, checkers };
}

// Highlight the last N piece-plies on the board. Roulette mode plays two
// sub-moves per AI turn, so we widen the window to 2; classic stays at 1
// and renders identically to the old single-lastMove behaviour.
// Indexed 0 = most recent, 1 = previous (used for an 'older' opacity).
export function recentPlies(
  moves: readonly LoggedMove[],
  gameMode: GameMode,
): { from: Map<string, number>; to: Map<string, number> } {
  const wantCount = gameMode === 'roulette' ? 2 : 1;
  const from = new Map<string, number>();
  const to = new Map<string, number>();
  let found = 0;
  for (let i = moves.length - 1; i >= 0 && found < wantCount; i--) {
    const m = moves[i].move;
    if (!m.from || !m.to || m.kind === 'topologyToggle') continue;
    if (!from.has(m.from)) from.set(m.from, found);
    if (!to.has(m.to)) to.set(m.to, found);
    found++;
  }
  return { from, to };
}

/** How many enemy pieces attack each square, as the board looks in `topology`. */
export function threatCounts(state: BoardState, topology: TopologyState): Map<string, number> {
  const opp: Color = state.sideToMove === 'white' ? 'black' : 'white';
  const analyzeState: BoardState = { ...state, topologyState: topology };
  const counts = new Map<string, number>();
  for (const sq of allSquares) {
    const c = countAttackers(analyzeState, sq, opp, topology);
    if (c > 0) counts.set(sq, c);
  }
  return counts;
}

/** Every [defender, defended] pair among White's pieces, in `topology`. */
export function supportPairsFor(state: BoardState, topology: TopologyState): [SquareId, SquareId][] {
  const ourColor: Color = 'white';
  const pairs: [SquareId, SquareId][] = [];
  for (const to of allSquares) {
    const piece = state.pieces[to];
    if (!piece || piece.color !== ourColor) continue;
    const attackers = getAttackerSquares(state, to, ourColor, topology);
    for (const from of attackers) {
      if (from !== to) pairs.push([from, to]);
    }
  }
  return pairs;
}
