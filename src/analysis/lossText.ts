/**
 * V1 — losses in words a player already has.
 *
 * "412 cp" means nothing to someone who has never read an engine's
 * output, and a rating is the wrong analogy (it grades the player, and
 * people take it personally). Every chess player does, however, know what
 * a pawn, a knight, a rook and a queen are worth — so that is the scale:
 * the number becomes pawns, and a big loss gets the piece it amounts to.
 * 100 centipawns is one pawn by definition, so nothing is approximated
 * beyond rounding.
 *
 * Shared by the review screen and the live move list, so both say the
 * same thing about the same move.
 */

/** Search returns ~100000 for a lost king; anything this big is "mate",
 *  not a number of pawns. */
export const MATE_SCALE_CPL = 50_000;

export function pawns(cp: number): string {
  const v = cp / 100;
  return v >= 10 ? v.toFixed(0) : v.toFixed(1);
}
