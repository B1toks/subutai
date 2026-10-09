import type { DrawOfferBlock } from '../../utils/drawOffer';

/** What a seat's Offer draw button says. `opponent` names the other seat. */
export function drawOfferTitle(block: DrawOfferBlock | null, opponent: string): string {
  switch (block) {
    case null:
      return 'Offer a draw';
    case 'no-moves':
      return 'Offer a draw (after the first move)';
    case 'offered':
      return `Draw offered. ${opponent} to answer`;
    case 'answer':
      return `${opponent} offers a draw`;
    case 'move-first':
      return 'Offer a draw again after your next move';
    case 'declined':
      return 'Draw declined. Offer one after the next move';
  }
}
