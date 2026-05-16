import type { BoardState, Color, Move, SquareId } from '../engine/types';
import {
  generateLegalMoves,
  isCheckmate,
  getAttackerSquares,
  applyMove,
  isSquareAttacked,
} from '../engine/moves';
import { applyRotationMove, toggleTopology } from '../engine/auxetic';
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
  /** Human-readable rendering of bestMove (e.g. "Qa4→d7"). */
  bestMoveSan?: string;
  /** Engine's full principal variation rendered as SAN tokens. */
  bestPvSan?: string[];
  discoveredAttack?: boolean;
  isSacrifice?: boolean;
  /**
   * Search-backed eval after the move, normalised to White's perspective
   * (centipawns). The UI uses this for the eval bar / gradient because it
   * sees recaptures and tactics that a static evaluator misses.
   */
  searchScoreFromWhite: number;
  /** True when the search found a forced mate from the post-move position. */
  isMate?: boolean;
  /** Plies until mate (0 = mate already on the board). Defined when isMate. */
  mateInPlies?: number;
}

// Mirrors src/ai/search.ts. The 100 buffer matches the threshold
// iterativeDeepen itself uses to early-exit on a found mate.
const MATE_SCORE = 100_000;
const MATE_THRESHOLD = MATE_SCORE - 100;

const DEFAULT_BUDGET_MS = 150;
const DEFAULT_MAX_DEPTH = 5;

export interface ClassifyOptions {
  budgetMs?: number;
  maxDepth?: number;
}

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

/** Walks the PV forward from stateBefore, producing a SAN per move. */
function pvToSans(stateBefore: BoardState, pv: readonly Move[]): string[] {
  const sans: string[] = [];
  let current = stateBefore;
  for (const move of pv) {
    sans.push(shortSan(current, move));
    if (move.kind === 'topologyToggle') {
      current = applyRotationMove(current);
    } else if (move.from && move.to) {
      current = applyMove(current, move);
    } else {
      break;
    }
  }
  return sans;
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

/**
 * Subutai-specific: detects threats that become live only after the opponent
 * rotates the board. The move itself looks safe under the current topology,
 * but a rotation opens a line/jump onto an undefended piece. Returns the
 * highest-value such piece, or 0 if no loaded threat exists.
 *
 * Skip when stateAfter already has lastMoveWasRotation=true (the opponent
 * cannot immediately rotate back) — those positions don't have the hidden
 * trap we're trying to catch.
 */
function crossTopologyThreatValue(stateAfter: BoardState, mover: Color): number {
  if (stateAfter.lastMoveWasRotation) return 0;
  const enemy = opposite(mover);
  const rotated = toggleTopology(stateAfter);
  let worst = 0;
  for (const [sq, piece] of Object.entries(stateAfter.pieces) as Array<[SquareId, BoardState['pieces'][SquareId]]>) {
    if (!piece || piece.color !== mover) continue;
    const attackedNow = isSquareAttacked(stateAfter, sq, enemy, stateAfter.topologyState);
    if (attackedNow) continue; // already visible — not a hidden trap
    const attackedRotated = isSquareAttacked(rotated, sq, enemy, rotated.topologyState);
    if (!attackedRotated) continue;
    const defendersRotated = getAttackerSquares(rotated, sq, mover, rotated.topologyState);
    if (defendersRotated.length > 0) continue;
    const v = PIECE_VALUE[piece.type];
    if (v > worst) worst = v;
  }
  return worst;
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
  opts: ClassifyOptions = {},
): MoveAnalysis {
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
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
      // Mover delivered mate. Score is +∞ for the mover; from White's POV
      // it's ±MATE_SCORE depending on who moved.
      const score = mover === 'white' ? MATE_SCORE : -MATE_SCORE;
      return {
        classification: 'checkmate',
        cpl: 0,
        searchScoreFromWhite: score,
        isMate: true,
        mateInPlies: 0,
      };
    }
  }

  // 2. Search runs first — both the discovered-attack and CPL paths need
  // searchScoreFromWhite to populate the eval bar consistently.
  const bestSearch = searchPosition(stateBefore, { budgetMs, maxDepth });
  const afterSearch = searchPosition(stateAfter, { budgetMs, maxDepth });
  // afterSearch.score is from stateAfter.sideToMove's perspective (opponent).
  // Flip to mover's perspective to compare apples-to-apples with bestSearch.score.
  const actualEvalForMover = -afterSearch.score;
  const cpl = Math.max(0, bestSearch.score - actualEvalForMover);

  // White-perspective version of the same number, for the eval bar / gradient.
  const searchScoreFromWhite =
    stateAfter.sideToMove === 'white' ? afterSearch.score : -afterSearch.score;
  // Mate detection: scores within 100 of the mate ceiling encode "mate in N
  // plies", where N = MATE_SCORE − |score|. The 100-plies buffer matches what
  // iterativeDeepen uses to early-exit on a found mate.
  const isMate = Math.abs(afterSearch.score) >= MATE_THRESHOLD;
  const mateInPlies = isMate ? MATE_SCORE - Math.abs(afterSearch.score) : undefined;

  const bestMove = bestSearch.bestMove ?? undefined;
  const bestMoveSan = bestMove ? shortSan(stateBefore, bestMove) : undefined;
  const bestPvSan =
    bestSearch.pv.length > 0 ? pvToSans(stateBefore, bestSearch.pv) : undefined;

  // 3. Discovered-attack heuristic — overrides classification on its own merits.
  if (move.kind !== 'topologyToggle' && movedTo) {
    const discovered = findDiscoveredTargets(stateBefore, stateAfter, mover, movedTo);
    if (discovered.length > 0) {
      const enemyKingDiscovered = discovered.some((sq) => {
        const p = stateAfter.pieces[sq];
        return p && p.type === 'king' && p.color !== mover;
      });
      if (enemyKingDiscovered) {
        return {
          classification: 'brilliant',
          cpl,
          bestMove,
          bestMoveSan,
          bestPvSan,
          discoveredAttack: true,
          searchScoreFromWhite,
          isMate: isMate || undefined,
          mateInPlies,
        };
      }
      // Highest-value discovered hanging target decides whether it's brilliant or just good.
      let highestHangingValue = 0;
      for (const sq of discovered) {
        if (!isHanging(stateAfter, sq, mover)) continue;
        const v = pieceValueOn(stateAfter, sq);
        if (v > highestHangingValue) highestHangingValue = v;
      }
      if (highestHangingValue >= MAJOR_PIECE_THRESHOLD) {
        return {
          classification: 'brilliant',
          cpl,
          bestMove,
          bestMoveSan,
          bestPvSan,
          discoveredAttack: true,
          searchScoreFromWhite,
          isMate: isMate || undefined,
          mateInPlies,
        };
      }
      if (highestHangingValue >= MINOR_PIECE_THRESHOLD) {
        return {
          classification: 'good',
          cpl,
          bestMove,
          bestMoveSan,
          bestPvSan,
          discoveredAttack: true,
          searchScoreFromWhite,
          isMate: isMate || undefined,
          mateInPlies,
        };
      }
    }
  }

  let classification: MoveClass;
  if (cpl >= 300) classification = 'blunder';
  else if (cpl >= 50) classification = 'mistake';
  else if (cpl < 10) classification = 'best';
  else classification = 'good';

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

  // 5. Subutai twist — if rotation by the opponent next turn would expose
  // a meaningful undefended piece, the move isn't actually as strong as the
  // raw chess analysis suggests. Demote one step.
  const loadedThreatValue = crossTopologyThreatValue(stateAfter, mover);
  if (loadedThreatValue >= MAJOR_PIECE_THRESHOLD) {
    classification = demoteForLoadedThreat(classification);
  } else if (loadedThreatValue >= MINOR_PIECE_THRESHOLD && classification === 'brilliant') {
    classification = 'good';
  }

  return {
    classification,
    cpl,
    bestMove,
    bestMoveSan,
    bestPvSan,
    isSacrifice: isSacrifice || undefined,
    searchScoreFromWhite,
    isMate: isMate || undefined,
    mateInPlies,
  };
}

function demoteForLoadedThreat(cls: MoveClass): MoveClass {
  switch (cls) {
    case 'brilliant':
      return 'good';
    case 'best':
      return 'good';
    case 'good':
      return 'mistake';
    default:
      return cls;
  }
}
