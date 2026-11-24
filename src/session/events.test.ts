import { describe, expect, it } from 'vitest';
import { createPositionFromBackRankKey } from '../engine';
import { applyMove } from '../engine/moves';
import { computeSAN } from '../recording/log';
import { eventsOfEntry } from './events';
import { legalMovesFor } from './rules';

describe('eventsOfEntry (P7: a Chess960 castle is not a capture)', () => {
  it('a castle whose king lands on its own rook makes no capture event', () => {
    // King f1, rook g1: O-O takes the king to g1, where the rook stands.
    const before = createPositionFromBackRankKey('RNBBQKRN');
    const castle = legalMovesFor('classic', before).find((m) => m.kind === 'castle')!;
    expect(castle).toMatchObject({ from: 'f1', to: 'g1', castleRookFrom: 'g1' });
    const after = applyMove(before, castle);
    const events = eventsOfEntry(before, after, castle, computeSAN(before, castle), 'human', 0);
    expect(events.map((e) => e.type)).toEqual(['move']);
  });
});
