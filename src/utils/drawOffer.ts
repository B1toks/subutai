/**
 * Draw by agreement: the rules Local (hot-seat) and Online both play by.
 *
 * An offer names who made it and the ply (the log length) it was made at,
 * and it stands only while the log is still that long. ANY move retires
 * it, the offering side's own included, without anyone deleting it: a
 * client that knows nothing about offers can keep moving and the offer is
 * gone all the same.
 *
 * One offer at a time: nobody may offer while one stands. The other side
 * answers it (accept ends the game, decline clears it) or moves. A side
 * that has offered may not offer again until it has made a move itself,
 * so a declined offer cannot be put straight back on the table.
 *
 * Online, a decline does not clear the offer: it marks it `declined` and
 * the record stays until the next move. Nobody may offer at a ply that
 * already had an offer, which the Firestore rules hold for both players
 * (a hand-crafted client included). Hot-seat clears the offer instead.
 *
 * `Seat` is whatever names a player: a colour in hot-seat, a uid online.
 */

export interface DrawOffer<Seat extends string = string> {
  readonly by: Seat;
  readonly atPly: number;
  /** Online: the other side said no. The offer no longer stands. */
  readonly declined?: true;
}

export interface DrawTable<Seat extends string = string> {
  /** The last offer made, standing or not (see standingDrawOffer). */
  readonly offer: DrawOffer<Seat> | null;
  /** Seats that have offered and not moved since. */
  readonly waiting: readonly Seat[];
}

export const NO_DRAW_OFFERS: DrawTable<never> = { offer: null, waiting: [] };

/** Why `who` may not offer a draw right now, or null if they may. */
export type DrawOfferBlock =
  /** No move has been played yet (a draw needs one, as a resignation does). */
  | 'no-moves'
  /** `who`'s own offer is still waiting for an answer. */
  | 'offered'
  /** The other side has an offer standing: answer that one instead. */
  | 'answer'
  /** `who` offered since their last move and must move before offering again. */
  | 'move-first'
  /** An offer made at this ply was declined: the next one waits for a move. */
  | 'declined';

/** The offer still standing `plies` moves into the game, or null. */
export function standingDrawOffer<Seat extends string>(
  offer: DrawOffer<Seat> | null | undefined,
  plies: number,
): DrawOffer<Seat> | null {
  return offer && offer.atPly === plies && !offer.declined ? offer : null;
}

export function drawOfferBlock<Seat extends string>(
  table: DrawTable<Seat>,
  who: Seat,
  plies: number,
): DrawOfferBlock | null {
  if (plies <= 0) return 'no-moves';
  const standing = standingDrawOffer(table.offer, plies);
  if (standing) return standing.by === who ? 'offered' : 'answer';
  if (table.waiting.includes(who)) return 'move-first';
  if (table.offer?.atPly === plies) return 'declined';
  return null;
}

export function canOfferDraw<Seat extends string>(
  table: DrawTable<Seat>,
  who: Seat,
  plies: number,
): boolean {
  return drawOfferBlock(table, who, plies) === null;
}

/** May `who` accept or decline? Only the other side of a standing offer. */
export function canAnswerDraw<Seat extends string>(
  offer: DrawOffer<Seat> | null | undefined,
  who: Seat,
  plies: number,
): boolean {
  const standing = standingDrawOffer(offer, plies);
  return !!standing && standing.by !== who;
}

/** `who` offers a draw. Unchanged if they may not. */
export function offerDraw<Seat extends string>(
  table: DrawTable<Seat>,
  who: Seat,
  plies: number,
): DrawTable<Seat> {
  if (!canOfferDraw(table, who, plies)) return table;
  return { offer: { by: who, atPly: plies }, waiting: [...table.waiting, who] };
}

/** `who` declines the standing offer. Unchanged if there is none to them.
 *  The offering side keeps waiting for its own next move. */
export function declineDraw<Seat extends string>(
  table: DrawTable<Seat>,
  who: Seat,
  plies: number,
): DrawTable<Seat> {
  if (!canAnswerDraw(table.offer, who, plies)) return table;
  return { ...table, offer: null };
}

/** `mover` made a move: any offer is gone, and `mover` may offer again. */
export function drawTableAfterMove<Seat extends string>(
  table: DrawTable<Seat>,
  mover: Seat,
): DrawTable<Seat> {
  if (table.offer === null && !table.waiting.includes(mover)) return table;
  return { offer: null, waiting: table.waiting.filter((s) => s !== mover) };
}
