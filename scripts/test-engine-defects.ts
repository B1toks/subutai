/* Regression tests for QA-audit defects fixed 2026-07-21.
 *   DEF-4 — chess960 knight double-indexing (only 544/960 reachable).
 *   DEF-1 — stale enPassantTarget surviving rotation / pass.
 *
 * Run: npx tsx scripts/test-engine-defects.ts
 */
import { createStartingPosition } from '../src/engine';
import { applyMove } from '../src/engine/moves';
import { applyRotationMove, applyPassMove } from '../src/engine/auxetic';
import type { BoardState, Move, SquareId } from '../src/engine';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${String(actual)}, want ${String(expected)}`);
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const PIECE_LETTER: Record<string, string> = {
  rook: 'R', knight: 'N', bishop: 'B', queen: 'Q', king: 'K', pawn: 'P',
};
function backRank(state: BoardState): string {
  return FILES.map((f) => {
    const p = state.pieces[`${f}1` as SquareId];
    return p ? PIECE_LETTER[p.type] : '?';
  }).join('');
}

// ---- DEF-4: seed-based generation must cover (nearly) all 960 back ranks ----
{
  const seen = new Set<string>();
  const knightFileHits = Array(8).fill(0);
  const SEEDS = 20000;
  for (let s = 1; s <= SEEDS; s++) {
    const bk = backRank(createStartingPosition(s));
    seen.add(bk);
    for (let i = 0; i < 8; i++) if (bk[i] === 'N') knightFileHits[i]++;
  }
  // Pre-fix this was exactly 544; a correct uniform generator hits all 960.
  check('DEF-4 distinct back ranks >= 940/960', seen.size >= 940, true);
  // No file should hog knights (pre-fix h-file was ~50%). Expected ~25% each.
  const total = knightFileHits.reduce((a, b) => a + b, 0);
  // Uniform would be ~12.5% (1/8) per file. Pre-fix the h-file was ~49.5%.
  const maxSharePct = (Math.max(...knightFileHits) / total) * 100;
  check('DEF-4 no knight-file exceeds 20% share', maxSharePct < 20, true);
  console.log(`  (distinct=${seen.size}, knight file share max=${maxSharePct.toFixed(1)}%)`);
}

// ---- DEF-1: EP marker clears on rotation and on pass ----
{
  // Find a starting position whose e-pawn can make a clean double push, then
  // confirm the EP target is set after it and cleared by a rotation.
  const state = createStartingPosition(1);
  // Locate a white pawn that can double-push (rank 2 -> rank 4 unobstructed).
  const doublePush: Move | null = (() => {
    for (const f of FILES) {
      const from = `${f}2` as SquareId;
      const to = `${f}4` as SquareId;
      const mid = `${f}3` as SquareId;
      const p = state.pieces[from];
      if (p?.type === 'pawn' && !state.pieces[mid] && !state.pieces[to]) {
        return { kind: 'normal', from, to } as Move;
      }
    }
    return null;
  })();

  if (!doublePush) {
    check('DEF-1 setup: found a double-push', false, true);
  } else {
    const afterPush = applyMove(state, doublePush);
    check('DEF-1 double push sets an EP target', afterPush.enPassantTarget !== null, true);

    const afterRotate = applyRotationMove(afterPush);
    check('DEF-1 rotation clears EP target', afterRotate.enPassantTarget, null);

    const afterPass = applyPassMove(afterPush);
    check('DEF-1 pass clears EP target', afterPass.enPassantTarget, null);
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
