/* The strict "Load replay" importer (v1.0.1, QA-02).
 *
 * Since v1.0.1 the dialog calls memory/replayImport.ts replayFromNotation,
 * a plain module, so unlike replay-roundtrip.ts (which had to mirror the
 * old importer from inside App) this script runs the real thing.
 *
 *   1. legal      Random legal games (played by the oracle, cut where the
 *                 app's own game would have ended) written in the export
 *                 format must import to the oracle's final position.
 *   2. annotated  The same logs with every decoration "Copy to clipboard"
 *                 ever added (' ⭐', '⭐️' from a chat client, '?', '??',
 *                 '!!', '+', '#', '← Better: … (−N cp)', the older
 *                 '← краще: …', ASCII '<-' and '(-N cp)') must still load.
 *   3. corrupt    One entry of a legal log replaced by an illegal one (wrong
 *                 side's piece, a move no piece can make, a second rotation
 *                 in a row, an @B tag while the board is in A) must be
 *                 refused, and the error must name that move number.
 *   4. roulette   Roulette games played the way the app plays them (two
 *                 actions per turn by the same side), exported by the app's
 *                 own exporter, must load back in Roulette.
 *
 * Run:  QA_SRC=<checkout>/src npx tsx qa/engine/replay-import-strict.ts
 * Env:  STRICT_GAMES (default 300)  STRICT_PLIES (default 120)
 *       STRICT_ROULETTE (default 100)
 * Needs a checkout that has src/memory/replayImport.ts (v1.0.1 and later).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BoardState, SquareId } from '../../src/engine/types';
import { SRC_ROOT, envInt, loadEngine, mulberry32, srcModule, type MemoryBuild, type RecordingLog } from './_src';
import { ALL_SQUARES, loadLayout } from './layout';
import { Oracle, moveKey, type OState } from './oracle';
import { playOracleGame, writeNotation, type OracleGame } from './play';

type ReplayImport = typeof import('../../src/memory/replayImport');

const GAMES = envInt('STRICT_GAMES', 300);
const PLIES = envInt('STRICT_PLIES', 120);
const ROULETTE = envInt('STRICT_ROULETTE', 100);

if (!fs.existsSync(path.join(SRC_ROOT, 'memory', 'replayImport.ts'))) {
  console.log(`src: ${SRC_ROOT}\nno memory/replayImport.ts here (pre-v1.0.1 checkout): nothing to test`);
  process.exit(2);
}

const { index, moves, auxetic } = await loadEngine();
const rec = await srcModule<RecordingLog>('recording/log.ts');
const build = await srcModule<MemoryBuild>('memory/build.ts');
const imp = await srcModule<ReplayImport>('memory/replayImport.ts');
const { layout, source } = await loadLayout();
const O = new Oracle(layout);
console.log(`src: ${SRC_ROOT}\nvisual layout: ${source}`);

function toOState(st: BoardState): OState {
  return {
    pieces: st.pieces, side: st.sideToMove, topo: st.topologyState,
    castling: st.castlingRights, kingStart: st.kingStartSquares, ep: null, lastRot: false,
  };
}

function diffState(a: BoardState, b: OState): string | null {
  for (const sq of ALL_SQUARES) {
    const p = a.pieces[sq as SquareId];
    const q = b.pieces[sq as SquareId];
    if ((p?.color ?? '') + (p?.type ?? '') !== (q?.color ?? '') + (q?.type ?? '')) {
      return `${sq}: import=${p ? p.color + ' ' + p.type : 'empty'} expected=${q ? q.color + ' ' + q.type : 'empty'}`;
    }
  }
  if (a.sideToMove !== b.side) return `side import=${a.sideToMove} expected=${b.side}`;
  if (a.topologyState !== b.topo) return `topology import=${a.topologyState} expected=${b.topo}`;
  return null;
}

/** How many plies of the oracle game a live game would have allowed: the
 *  app ends a game on mate or on a draw (stalemate, material, threefold,
 *  fifty moves), so a log that goes on past one is rightly refused. */
function livePlies(g: OracleGame, start: BoardState): number {
  let st = start;
  let lastRot = false;
  for (let i = 0; i < g.plies.length; i++) {
    if (moves.isCheckmate(st, lastRot) || moves.checkDrawConditions(st, lastRot)) return i;
    const p = g.plies[i];
    if (p.rotation) {
      st = auxetic.applyRotationMove(st);
      lastRot = true;
      continue;
    }
    const found = moves.generateLegalMoves(st).find((m) => moveKey(m) === moveKey(p.move!));
    if (!found) return i; // the fuzzer covers engine/oracle disagreement
    st = moves.applyMove(st, found);
    lastRot = false;
  }
  return g.plies.length;
}

const failures: Record<string, string[]> = { legal: [], annotated: [], corrupt: [], roulette: [] };
const counts = { legal: 0, annotated: 0, corrupt: 0, corruptKinds: {} as Record<string, number>, roulette: 0, rouletteOldLoads: 0 };

// ---- 1 + 2 + 3 ---------------------------------------------------------
const DECOR = [
  ' ⭐', ' ⭐️', '⭐️', '?', '??', '!!', '+', '#',
  '?? ← Better: Nb1→c3 (−250 cp)', '?? ← Better: e2→e4 (-87 cp)',
  ' ← краще: Ng1→f3', '?? <- Better: Qd1→h5 (−12 cp)', ' (−40 cp)',
];

function decorate(notation: string, rnd: () => number): string {
  return notation.split('\n').map((line) => {
    const m = line.match(/^(\d+\.\s+)(.+)$/);
    if (!m) return line;
    const parts = m[2].split(/\s{2,}/);
    return m[1] + parts.map((t) => (rnd() < 0.7 ? t + DECOR[Math.floor(rnd() * DECOR.length)] : t)).join('  ');
  }).join('\n');
}

function tokensOf(notation: string): string[] {
  const out: string[] = [];
  for (const line of notation.split('\n')) {
    const m = line.match(/^\d+\.\s+(.+)$/);
    if (m) out.push(...m[1].split(/\s{2,}/));
  }
  return out;
}

function withTokens(header: string, toks: string[]): string {
  const lines = [header];
  for (let i = 0; i < toks.length; i += 2) {
    lines.push(`${i / 2 + 1}. ${toks[i]}${toks[i + 1] !== undefined ? `  ${toks[i + 1]}` : ''}`);
  }
  return lines.join('\n');
}

for (let seed = 1; seed <= GAMES; seed++) {
  const start = index.createStartingPosition(seed);
  const full = playOracleGame(O, toOState(start), seed, PLIES);
  const n = livePlies(full, start);
  if (n === 0) continue;
  // Same seed, fewer plies: the same first n plies (the RNG is sequential).
  const g = n === full.plies.length ? full : playOracleGame(O, toOState(start), seed, n);
  const text = writeNotation(g);

  counts.legal++;
  try {
    const r = imp.replayFromNotation(text);
    const d = diffState(r.final, g.final);
    if (d) failures.legal.push(`seed ${seed}: lands elsewhere — ${d}`);
  } catch (e) {
    failures.legal.push(`seed ${seed} (${g.plies.length} plies): refused — ${(e as Error).message}`);
  }

  const rnd = mulberry32(seed * 7919);
  counts.annotated++;
  const decorated = decorate(text, rnd);
  try {
    const r = imp.replayFromNotation(decorated);
    const d = diffState(r.final, g.final);
    if (d) failures.annotated.push(`seed ${seed}: lands elsewhere — ${d}`);
  } catch (e) {
    failures.annotated.push(`seed ${seed}: refused — ${(e as Error).message}`);
  }

  // Corrupt one entry, chosen at random, and replay the oracle up to it to
  // know the position it was supposed to be played in.
  if (g.plies.length < 2) continue;
  const k = 1 + Math.floor(rnd() * (g.plies.length - 1));
  const before = playOracleGame(O, toOState(start), seed, k).final;
  const header = text.split('\n').slice(0, 3).join('\n');
  const toks = tokensOf(text);
  const legalPairs = new Set(O.legal(before).map((m) => `${m.from}-${m.to}`));
  const candidates: Array<[string, string]> = [];
  const own = ALL_SQUARES.filter((sq) => before.pieces[sq as SquareId]?.color === before.side);
  const theirs = ALL_SQUARES.filter((sq) => before.pieces[sq as SquareId] && before.pieces[sq as SquareId]!.color !== before.side);
  const empty = ALL_SQUARES.filter((sq) => !before.pieces[sq as SquareId]);
  const tag = before.topo === 'B' ? '@B' : '';
  if (theirs.length && empty.length) {
    candidates.push(['wrong-side', `${theirs[Math.floor(rnd() * theirs.length)]}→${empty[Math.floor(rnd() * empty.length)]}${tag}`]);
  }
  for (let tries = 0; tries < 50; tries++) {
    const from = own[Math.floor(rnd() * own.length)];
    const to = ALL_SQUARES[Math.floor(rnd() * 64)];
    if (from === to || legalPairs.has(`${from}-${to}`)) continue;
    if (before.pieces[to as SquareId]?.color === before.side) continue;
    candidates.push(['impossible-move', `${from}→${to}${tag}`]);
    break;
  }
  if (g.plies[k - 1].rotation) candidates.push(['second-rotation', `${before.topo}→${before.topo === 'A' ? 'B' : 'A'}`]);
  if (before.topo === 'A' && g.plies[k].move && !g.plies[k].move!.castle) {
    candidates.push(['@B-in-A', `${toks[k].replace(/@B$/, '')}@B`]);
  }
  for (const [kind, bad] of candidates) {
    counts.corrupt++;
    counts.corruptKinds[kind] = (counts.corruptKinds[kind] ?? 0) + 1;
    const t2 = [...toks];
    t2[k] = bad;
    const moveNo = Math.floor(k / 2) + 1;
    try {
      imp.replayFromNotation(withTokens(header, t2));
      failures.corrupt.push(`seed ${seed} ${kind}: "${bad}" at move ${moveNo} accepted`);
    } catch (e) {
      const msg = (e as Error).message;
      if (!msg.startsWith(`Move ${moveNo} `)) {
        failures.corrupt.push(`seed ${seed} ${kind}: "${bad}" at move ${moveNo} refused with a different move: ${msg}`);
      }
    }
  }
}

// ---- 4: roulette --------------------------------------------------------
// Played exactly like qa/engine/roulette-log.ts (the app's two-action turn:
// sideToMove is clamped back to the mover after the first action).

for (let g = 0; g < ROULETTE; g++) {
  const rnd = mulberry32(4242 + g);
  let st: BoardState = index.createStartingPosition(4242 + g);
  let log = rec.createGameLog(`rou-${g}`, st, g);
  let over = false;
  for (let turn = 0; turn < 30 && !over; turn++) {
    const side = st.sideToMove;
    for (let action = 0; action < 2; action++) {
      const legal = moves.generateLegalMoves(st, { allowSelfCheck: true }).filter((m) => m.kind !== 'castle');
      if (!legal.length) break;
      const m = legal[Math.floor(rnd() * legal.length)];
      log = rec.appendMove(log, m, rec.computeSAN(st, m), st.topologyState);
      const after = moves.applyMove(st, m);
      if (!moves.findKing(after, 'white') || !moves.findKing(after, 'black')) { st = after; over = true; break; }
      st = action === 0 ? { ...after, sideToMove: side } : after;
    }
    if (!over && st.sideToMove === side) st = { ...st, sideToMove: side === 'white' ? 'black' : 'white' };
  }
  counts.roulette++;
  const text = build.buildSavedGameSnapshot(log, `rou-${g}`).notation;
  try {
    const r = imp.replayFromNotation(text, { roulette: true });
    const wrong = ALL_SQUARES.find((sq) => {
      const a = r.final.pieces[sq as SquareId];
      const b = st.pieces[sq as SquareId];
      return (a?.color ?? '') + (a?.type ?? '') !== (b?.color ?? '') + (b?.type ?? '');
    });
    if (wrong) failures.roulette.push(`game ${g}: loads, but ${wrong} differs from the game that was played`);
  } catch (e) {
    if (failures.roulette.length < 400) failures.roulette.push(`game ${g} (${log.moves.length} entries): refused — ${(e as Error).message}`);
  }
}

// ---- report -------------------------------------------------------------
console.log(`legal:     ${counts.legal - failures.legal.length}/${counts.legal} import to the played position`);
console.log(`annotated: ${counts.annotated - failures.annotated.length}/${counts.annotated} import with export decorations`);
console.log(`corrupt:   ${counts.corrupt - failures.corrupt.length}/${counts.corrupt} refused at the right move ${JSON.stringify(counts.corruptKinds)}`);
console.log(`roulette:  ${counts.roulette - failures.roulette.length}/${counts.roulette} app-exported roulette logs load back in Roulette`);
let bad = 0;
for (const [k, list] of Object.entries(failures)) {
  if (!list.length) continue;
  bad += list.length;
  console.log(`\n${k}: ${list.length} failure(s)`);
  for (const f of list.slice(0, 8)) console.log(`  - ${f}`);
}
if (bad) process.exitCode = 1;
else console.log('\nALL PASS');
