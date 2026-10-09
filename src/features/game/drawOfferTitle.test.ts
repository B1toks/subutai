import { describe, expect, it } from 'vitest';
import { drawOfferTitle } from './drawOfferTitle';

describe('drawOfferTitle', () => {
  it('says why the button is off, naming the other seat', () => {
    expect(drawOfferTitle(null, 'White')).toBe('Offer a draw');
    expect(drawOfferTitle('no-moves', 'White')).toBe('Offer a draw (after the first move)');
    expect(drawOfferTitle('offered', 'Black')).toBe('Draw offered. Black to answer');
    expect(drawOfferTitle('answer', 'Kasia')).toBe('Kasia offers a draw');
    expect(drawOfferTitle('move-first', 'White')).toBe('Offer a draw again after your next move');
    expect(drawOfferTitle('declined', 'White')).toBe('Draw declined. Offer one after the next move');
  });
});
