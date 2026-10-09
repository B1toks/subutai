import { describe, expect, it } from 'vitest';
import type { LoggedMove } from '../../recording/log';
import { replayFromNotation } from '../../memory/replayImport';
import { formatNotation } from './notation';

// qa/fixtures/endings.json "mate-A", as the app's own Copy to clipboard wrote it.
const MATE_A =
  '[Chess960 "QRKRNBBN"]\n[Seed "38"]\n\n1. d2→d4  a7→a5\n2. A→B  Ne8→f6@B\n3. Kc1→c3@B  b7→b6@B\n' +
  '4. f2→f3@B  B→A\n5. Ne1→d3  h7→h6\n6. b2→b3  A→B\n7. Rb1→a4@B  Kc8→b5@B\n8. d4→a5@B  h6→h3@B\n' +
  '9. Qa1→b2@B  B→A\n10. a5→b6  d7→d6\n11. e2→e4  Rb8→b6';

const entry = (e: Partial<LoggedMove> & Pick<LoggedMove, 'move'>): LoggedMove => ({ timestamp: 0, ...e });

describe('formatNotation', () => {
  it('writes back exactly the log the replay importer read', () => {
    const imported = replayFromNotation(MATE_A, { now: 0 });
    expect(formatNotation('QRKRNBBN', 38, imported.log.moves, 'classic', false)).toBe(MATE_A);
  });

  it('spells out moves that carry no SAN', () => {
    const moves = [
      entry({ move: { kind: 'topologyToggle' } }),
      entry({ move: { kind: 'topologyToggle' }, topology: 'B' }),
      entry({ move: { kind: 'castle', from: 'e1', to: 'c1' } }),
      entry({ move: { kind: 'castle', from: 'e8', to: 'g8' }, topology: 'B' }),
      entry({ move: { kind: 'promotion', from: 'e7', to: 'e8', promotion: 'knight' } }),
    ];
    expect(formatNotation('RNBQKBNR', 1, moves, 'classic', false)).toBe(
      '[Chess960 "RNBQKBNR"]\n[Seed "1"]\n\n1. A→B  B→A\n2. O-O-O  O-O@B\n3. e7→e8=N',
    );
  });

  it('marks moves on screen and leaves the clipboard copy bare', () => {
    const blunder = entry({
      san: 'Nf3',
      move: { kind: 'normal', from: 'g1', to: 'f3' },
      analysis: { classification: 'blunder', cpl: 120, bestMoveSan: 'Nc3', searchScoreFromWhite: 0 },
    });
    const best = entry({ san: 'e5', move: { kind: 'normal', from: 'e7', to: 'e5' }, analysis: { classification: 'best', cpl: 0, searchScoreFromWhite: 0 } });
    expect(formatNotation('RNBQKBNR', 1, [blunder, best], 'classic', true)).toBe(
      '[Chess960 "RNBQKBNR"]\n[Seed "1"]\n\n1. Nf3?? ← Better: Nc3 (−1.2 pawns)  e5 ⭐',
    );
    expect(formatNotation('RNBQKBNR', 1, [blunder, best], 'classic', false)).toBe(
      '[Chess960 "RNBQKBNR"]\n[Seed "1"]\n\n1. Nf3  e5',
    );
  });

  it('puts a mate-sized loss in words, by mode', () => {
    const loss = (gameMode: 'classic' | 'roulette') =>
      formatNotation('RNBQKBNR', 1, [entry({
        san: 'Kd2',
        move: { kind: 'normal', from: 'e1', to: 'd2' },
        analysis: { classification: 'blunder', cpl: 60_000, searchScoreFromWhite: 0 },
      })], gameMode, true);
    expect(loss('classic')).toMatch(/1\. Kd2\?\? \(allows mate\)$/);
    expect(loss('roulette')).toMatch(/1\. Kd2\?\? \(hangs the king\)$/);
  });
});
