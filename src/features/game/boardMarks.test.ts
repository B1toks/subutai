import { describe, expect, it } from 'vitest';
import { createPositionFromBackRankKey, type BoardState, type Move } from '../../engine';
import { applyMove, generateLegalMoves } from '../../engine/moves';
import type { LoggedMove } from '../../recording/log';
import { replayFromNotation } from '../../memory/replayImport';
import { checkMarks, recentPlies, supportPairsFor, threatCounts } from './boardMarks';

const start = createPositionFromBackRankKey('RNBQKBNR');
const entry = (move: Move): LoggedMove => ({ move, timestamp: 0 });

/** QA's "mate-A" ending, one move before the mate and right after it. */
function mateA(): { before: BoardState; after: BoardState } {
  const lead = replayFromNotation(
    '[Chess960 "QRKRNBBN"]\n[Seed "38"]\n\n1. d2→d4  a7→a5\n2. A→B  Ne8→f6@B\n3. Kc1→c3@B  b7→b6@B\n' +
      '4. f2→f3@B  B→A\n5. Ne1→d3  h7→h6\n6. b2→b3  A→B\n7. Rb1→a4@B  Kc8→b5@B\n8. d4→a5@B  h6→h3@B\n' +
      '9. Qa1→b2@B  B→A\n10. a5→b6  d7→d6\n11. e2→e4  Rb8→b6',
    { now: 0 },
  );
  const mate = generateLegalMoves(lead.final).find((m) => m.from === 'd3' && m.to === 'e5')!;
  return { before: lead.final, after: applyMove(lead.final, mate) };
}

describe('checkMarks', () => {
  it('marks nothing when nobody is in check', () => {
    const marks = checkMarks(start, null);
    expect(marks.king).toBeNull();
    expect(marks.checkers.size).toBe(0);
  });
  it('marks the king in check and the piece giving it', () => {
    const { after } = mateA();
    const marks = checkMarks(after, null);
    expect(marks.king).not.toBeNull();
    expect(after.pieces[marks.king as 'a1']?.type).toBe('king');
    // A discovered check: the knight leaving d3 opens the f1 bishop's line.
    expect([...marks.checkers]).toEqual(['f1']);
  });
  it('ignores a preview of the topology the board is already in', () => {
    const { after } = mateA();
    expect(checkMarks(after, after.topologyState)).toEqual(checkMarks(after, null));
  });
});

describe('recentPlies', () => {
  const e4: Move = { kind: 'normal', from: 'e2', to: 'e4' };
  const e5: Move = { kind: 'normal', from: 'e7', to: 'e5' };
  const rotate: Move = { kind: 'topologyToggle' };
  it('marks only the last piece move in classic, skipping rotations', () => {
    const marks = recentPlies([entry(e4), entry(e5), entry(rotate)], 'classic');
    expect([...marks.from]).toEqual([['e7', 0]]);
    expect([...marks.to]).toEqual([['e5', 0]]);
  });
  it('marks the last two in roulette, newest first', () => {
    const marks = recentPlies([entry(e4), entry(rotate), entry(e5)], 'roulette');
    expect([...marks.from]).toEqual([['e7', 0], ['e2', 1]]);
    expect([...marks.to]).toEqual([['e5', 0], ['e4', 1]]);
  });
  it('marks nothing before the first move', () => {
    expect(recentPlies([], 'classic').from.size).toBe(0);
  });
});

describe('coaching overlays', () => {
  it('counts the enemy attackers of a square', () => {
    const threats = threatCounts(start, 'A');
    expect(threats.get('c6')).toBeGreaterThan(0);
    expect(threats.has('e4')).toBe(false);
  });
  it('pairs each white piece with its defenders', () => {
    const pairs = supportPairsFor(start, 'A');
    expect(pairs).toContainEqual(['g1', 'e2']);
    for (const [from, to] of pairs) {
      expect(from).not.toBe(to);
      expect(start.pieces[to]?.color).toBe('white');
    }
  });
});
