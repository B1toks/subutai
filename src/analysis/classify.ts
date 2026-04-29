import type { BoardState, Color, Move, SquareId } from '../engine/types';
import {
  generateLegalMoves,
  isCheckmate,
  getAttackerSquares,
} from '../engine/moves';
import { PIECE_VALUE } from '../ai/evaluate';
import { searchPosition } from '../ai/search';

export type MoveClass =
  | 'best'
  | 'good'
  | 'mistake'
  | 'blunder'
  | 'brilliant'
  | 'checkmate';

export interface MoveAnalysis {
  classification: MoveClass;
  /** Centipawn loss vs. the engine's preferred move. */
  cpl: number;
  /** Engine's preferred move from stateBefore. */
  bestMove?: Move;
  /** Human-readable rendering of bestMove (e.g. "Q a4→d7"). */
  bestMoveSan?: string;
  discoveredAttack?: boolean;
  isSacrifice?: boolean;
}

const CLASSIFY_BUDGET_MS = 150;
const CLASSIFY_MAX_DEPTH = 5;

const MAJOR_PIECE_THRESHOLD = 500; // rook+
const MINOR_PIECE_THRESHOLD = 300; // bishop/knight

const PIECE_LETTER: Record<string, string> = {
  pawn: '',
  knight: 'N',
  bishop: 'B',
  rook: 'R',
  queen: 'Q',
  king: 'K',
};

function moverColor(stateBefore: BoardState): Color {
  return stateBefore.sideToMove;
}

function opposite(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

function shortSan(state: BoardState, move: Move): string {
  if (move.kind === 'topologyToggle') {
    return state.topologyState === 'A' ? 'A→B' : 'B→A';
  }
  if (move.kind === 'castle') {
    return move.to && move.to[0] === 'c' ? 'O-O-O' : 'O-O';
  }
  if (!move.from || !move.to) return '?';
  const piece = state.pieces[move.from];
  const letter = piece ? PIECE_LETTER[piece.type] : '';
  let san = `${letter}${move.from}→${move.to}`;
  if (move.kind === 'promotion' && move.promotion) {
    san += `=${PIECE_LETTER[move.promotion] ?? ''}`;
  }
  return san;
}

/**
 * For every enemy square, list the mover's pieces attacking it.
 * Cheaper than computing full attack tables — we only care about which
 * mover-coloured pieces hit which targets.
 */
function buildOurAttackMap(
  state: BoardState,
  ourColor: Color,
): Map<SquareId, Set<SquareId>> {
  const map = new Map<SquareId, Set<SquareId>>();
  const enemy = opposite(ourColor);
  for (const [sq, piece] of Object.entries(state.pieces) as Array<[SquareId, BoardState['pieces'][SquareId]]>) {
    if (!piece || piece.color !== enemy) continue;
    const attackers = getAttackerSquares(state, sq, ourColor, state.topologyState);
    if (attackers.length > 0) map.set(sq, new Set(attackers));
  }
  return map;
}

/**
 * Detects discovered attacks: a square whose attacker set after the move
 * gained a NEW attacker that isn't `move.to` and wasn't attacking before.
 * That means a different piece's line opened — a discovered attack.
 *
 * Returns the discovered target squares. Most code only cares about the
 * highest-value one, so callers reduce.
 */
function findDiscoveredTargets(
  before: BoardState,
  after: BoardState,
  mover: Color,
  movedTo: SquareId | null,
): SquareId[] {
  const beforeMap = buildOurAttackMap(before, mover);
  const afterMap = buildOurAttackMap(after, mover);
  const discovered: SquareId[] = [];
  for (const [target, attackers] of afterMap) {
    const beforeAttackers = beforeMap.get(target);
    for (const att of attackers) {
      if (att === movedTo) continue;
      if (beforeAttackers && beforeAttackers.has(att)) continue;
      discovered.push(target);
      break;
    }
  }
  return discovered;
}

/** A target is hanging if attacked and (for our v1) has zero defenders. */
function isHanging(state: BoardState, target: SquareId, mover: Color): boolean {
  const piece = state.pieces[target];
  if (!piece) return false;
  const enemy = opposite(mover);
  const defenders = getAttackerSquares(state, target, enemy, state.topologyState);
  return defenders.length === 0;
}

function pieceValueOn(state: BoardState, sq: SquareId): number {
  const piece = state.pieces[sq];
  return piece ? PIECE_VALUE[piece.type] : 0;
}

/**
 * Sacrifice = the just-moved piece sits on a square attacked by the opponent
 * with no defender of our own. Cheap heuristic, not full SEE.
 */
function looksLikeSacrifice(
  after: BoardState,
  movedTo: SquareId,
  mover: Color,
): boolean {
  const piece = after.pieces[movedTo];
  if (!piece || piece.color !== mover) return false;
  const enemy = opposite(mover);
  const attackers = getAttackerSquares(after, movedTo, enemy, after.topologyState);
  if (attackers.length === 0) return false;
  const defenders = getAttackerSquares(after, movedTo, mover, after.topologyState).filter(
    (sq) => sq !== movedTo,
  );
  return defenders.length === 0;
}

export function classifyMove(
  stateBefore: BoardState,
  move: Move,
  stateAfter: BoardState,
): MoveAnalysis {
  const mover = moverColor(stateBefore);
  const movedTo: SquareId | null = move.to ?? null;

  // 1. Checkmate is terminal — short-circuit before search work.
  // stateAfter.sideToMove is the opponent; if they have no legal reply and
  // are in check, mover delivered checkmate.
  if (
    isCheckmate(stateAfter, move.kind === 'topologyToggle') ||
    generateLegalMoves(stateAfter).length === 0
  ) {
    if (isCheckmate(stateAfter, move.kind === 'topologyToggle')) {
      return { classification: 'checkmate', cpl: 0 };
    }
  }

  // 2. Discovered attack heuristic (runs before CPL — wins on its own merits).
  if (move.kind !== 'topologyToggle' && movedTo) {
    const discovered = findDiscoveredTargets(stateBefore, stateAfter, mover, movedTo);
    if (discovered.length > 0) {
      const enemyKingDiscovered = discovered.some((sq) => {
        const p = stateAfter.pieces[sq];
        return p && p.type === 'king' && p.color !== mover;
      });
      if (enemyKingDiscovered) {
        return { classification: 'brilliant', cpl: 0, discoveredAttack: true };
      }
      // Highest-value discovered hanging target decides whether it's brilliant or just good.
      let highestHangingValue = 0;
      for (const sq of discovered) {
        if (!isHanging(stateAfter, sq, mover)) continue;
        const v = pieceValueOn(stateAfter, sq);
        if (v > highestHangingValue) highestHangingValue = v;
      }
      if (highestHangingValue >= MAJOR_PIECE_THRESHOLD) {
        return { classification: 'brilliant', cpl: 0, discoveredAttack: true };
      }
      if (highestHangingValue >= MINOR_PIECE_THRESHOLD) {
        return { classification: 'good', cpl: 0, discoveredAttack: true };
      }
    }
  }

  // 3. CPL analysis — what did the engine want vs. what was played?
  const bestSearch = searchPosition(stateBefore, {
    budgetMs: CLASSIFY_BUDGET_MS,
    maxDepth: CLASSIFY_MAX_DEPTH,
  });
  const afterSearch = searchPosition(stateAfter, {
    budgetMs: CLASSIFY_BUDGET_MS,
    maxDepth: CLASSIFY_MAX_DEPTH,
  });
  // afterSearch.score is from stateAfter.sideToMove's perspective (opponent).
  // Flip to mover's perspective to compare apples-to-apples with bestSearch.score.
  const actualEvalForMover = -afterSearch.score;
  const cpl = Math.max(0, bestSearch.score - actualEvalForMover);

  let classification: MoveClass;
  if (cpl >= 300) classification = 'blunder';
  else if (cpl >= 50) classification = 'mistake';
  else if (cpl < 10) classification = 'best';
  else classification = 'good';

  const bestMove = bestSearch.bestMove ?? undefined;
  const bestMoveSan = bestMove ? shortSan(stateBefore, bestMove) : undefined;

  // 4. Sacrifice + best-move check — promotes good/best plays to brilliant.
  let isSacrifice = false;
  if (
    movedTo &&
    (move.kind === 'capture' || move.kind === 'promotion' || move.kind === 'normal') &&
    cpl < 50 &&
    looksLikeSacrifice(stateAfter, movedTo, mover)
  ) {
    isSacrifice = true;
    const movedPieceValue = pieceValueOn(stateAfter, movedTo);
    // Don't dignify hanging a pawn with "brilliant" — needs a real piece.
    const meaningful = movedPieceValue >= MINOR_PIECE_THRESHOLD;
    const bestMatches =
      bestMove &&
      bestMove.from === move.from &&
      bestMove.to === move.to &&
      bestMove.kind === move.kind;
    if (meaningful && (bestMatches || cpl < 30)) {
      classification = 'brilliant';
    }
  }

  return {
    classification,
    cpl,
    bestMove,
    bestMoveSan,
    isSacrifice: isSacrifice || undefined,
  };
}
