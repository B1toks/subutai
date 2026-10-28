import type { BoardState, Color, Move, PieceType } from '../../engine';
import { findKing } from '../../engine/moves';
import { PIECE_VALUE } from '../../ai/evaluate';
import type { GameMode } from '../../shared/game';

// Roulette: a spin rolls a bag of piece types, and the side to move gets
// two actions, each with a piece whose type is still unused in the bag.

export const ROULETTE_SLOT_COUNT = 4;
export const ROULETTE_MAX_ACTIONS = 2;
// v1.1.6: the bot's bag lands slot by slot like the player's (session/
// reveal.ts), then it waits AI_ROULETTE_REVEAL_MS before its first action
// (it used to appear at once and stay 1.2 s).
export const AI_ROULETTE_REVEAL_MS = 600;
export const AI_ROULETTE_BETWEEN_ACTIONS_MS = 900;

/**
 * Q.D.5: SINGLE source of truth for "may this piece move under roulette
 * constraints?". Every selection / move / highlight gate goes through this
 * helper so the in-check override is guaranteed to apply uniformly.
 *
 *   - Classic mode → always true (no roulette restriction).
 *   - Pre-spin (allowed === null) → false (board is locked).
 *   - In check → true (player MUST be able to escape, slot restriction is lifted).
 *   - Otherwise → piece type must match an unused slot in the bag.
 *
 * Callers are responsible for the side check (`piece.color === state.sideToMove`).
 */
export function isPieceMovableInRoulette(
  pieceType: PieceType,
  _state: BoardState,
  gameMode: GameMode,
  allowed: PieceType[] | null,
  used: number[],
): boolean {
  if (gameMode !== 'roulette') return true;
  if (allowed === null) return false;
  // Q.D.8: no in-check override — roulette is capture-the-king, so being
  // in check is just "the king is attacked"; player still plays under
  // the normal slot restriction. If they ignore the threat, opponent
  // can capture the king on the next move and win.
  return allowed.some((t, i) => t === pieceType && !used.includes(i));
}

/** Only piece types currently alive for `color` — no "dead" slots. */
export function getActivePieceTypes(state: BoardState, color: Color): PieceType[] {
  const types = new Set<PieceType>();
  for (const piece of Object.values(state.pieces)) {
    if (piece && piece.color === color) types.add(piece.type);
  }
  return Array.from(types);
}

export function spinRoulette(
  activeTypes: PieceType[],
  pawnBoost: boolean = false,
  random: () => number = Math.random,
): PieceType[] {
  if (activeTypes.length === 0) return [];
  // Pawn-bias for the first 3 spins of a game (Stage O): we add 'pawn' to the
  // pool one extra time, lifting its per-slot probability from 1/n to 2/(n+1)
  // — roughly a +50-65% boost depending on how many piece types remain.
  const pool: PieceType[] =
    pawnBoost && activeTypes.includes('pawn')
      ? [...activeTypes, 'pawn']
      : activeTypes;
  const out: PieceType[] = [];
  for (let i = 0; i < ROULETTE_SLOT_COUNT; i++) {
    out.push(pool[Math.floor(random() * pool.length)]);
  }
  return out;
}

// Pick the index of the slot this mover-type consumes. Prefers the first
// unused slot of that exact type.
export function consumeSlotIndex(
  allowed: PieceType[],
  used: number[],
  moverType: PieceType,
): number {
  return allowed.findIndex(
    (type, idx) => type === moverType && !used.includes(idx),
  );
}

// Pick the best AI move from a set of allowed moves.
// Priority: (a) king capture, (b) highest-value capture, (c) random fallback.
export function pickAiRouletteMove(
  bs: BoardState,
  playable: Move[],
  random: () => number = Math.random,
): Move {
  const enemy: Color = bs.sideToMove === 'white' ? 'black' : 'white';
  const enemyKingSq = findKing(bs, enemy);
  if (enemyKingSq) {
    const kingCap = playable.find((m) => m.to === enemyKingSq);
    if (kingCap) return kingCap;
  }
  const scored = playable
    .map((m) => {
      const victim = m.to ? bs.pieces[m.to] : undefined;
      return { m, score: victim ? PIECE_VALUE[victim.type] : 0 };
    })
    .sort((a, b) => b.score - a.score);
  if (scored[0] && scored[0].score > 0) return scored[0].m;
  return playable[Math.floor(random() * playable.length)];
}
