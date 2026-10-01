/* Move-log round trip: "Copy to clipboard" -> "Load replay" -> same position.
 *
 * For each random legal game (played and tracked by the oracle only):
 *   1. the log is written by an independent writer (play.ts);
 *   2. the app's own exporter (memory/build.ts, the Memory card's "Copy to
 *      clipboard"; the board panel's copy uses the same format) must write
 *      the same move lines;
 *   3. the log is parsed with the app's parser (memory/notation.ts) and
 *      replayed with the importer's algorithm, and must land on the
 *      oracle's final position, side to move, topology and rotation flag.
 *
 * Step 3 mirrors App.importReplayFromNotation because that function lives
 * inside the App component and cannot be imported; qa/e2e/tests/replay.spec
 * drives the real dialog with the fixtures this script writes.
 *
 * Run:  npx tsx qa/engine/replay-roundtrip.ts        (RT_GAMES, RT_PLIES)
 *       QA_WRITE_REPLAYS=1 ... also writes qa/fixtures/replays.json
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BoardState, Move, SquareId } from '../../src/engine/types';
import {
  QA_ROOT, SRC_ROOT, envInt, loadEngine, srcModule,
  type MemoryBuild, type MemoryNotation, type RecordingLog,
} from './_src';
import { ALL_SQUARES, loadLayout } from './layout';
import { Oracle, moveKey, type OState } from './oracle';
import { moveLines, playOracleGame, writeNotation, type OracleGame } from './play';

const GAMES = envInt('RT_GAMES', 400);
const PLIES = envInt('RT_PLIES', 120);

const { index, moves, auxetic } = await loadEngine();
const rec = await srcModule<RecordingLog>('recording/log.ts');
const build = await srcModule<MemoryBuild>('memory/build.ts');
const nota = await srcModule<MemoryNotation>('memory/notation.ts');
const { layout, source } = await loadLayout();
const O = new Oracle(layout);
console.log(`src: ${SRC_ROOT}\nvisual layout: ${source}`);

function toOState(st: BoardState): OState {
  return {
    pieces: st.pieces, side: st.sideToMove, topo: st.topologyState,
    castling: st.castlingRights, kingStart: st.kingStartSquares, ep: null, lastRot: false,
  };
}

/** Engine replay of the oracle game -> the GameLog the app would have logged live. */
function appLog(g: OracleGame, start: BoardState) {
  let st = start;
  let log = rec.createGameLog(`rt-${g.seed}`, st, g.seed);
  for (const p of g.plies) {
    let mv: Move;
    if (p.rotation) {
      mv = { kind: 'topologyToggle' };
      log = rec.appendMove(log, mv, rec.computeSAN(st, mv), st.topologyState);
      st = auxetic.applyRotationMove(st);
      continue;
    }
    const found = moves.generateLegalMoves(st).find((m) => moveKey(m) === moveKey(p.move!));
    if (!found) throw new Error(`engine rejects oracle move ${moveKey(p.move!)}`);
    log = rec.appendMove(log, found, rec.computeSAN(st, found), st.topologyState);
    st = moves.applyMove(st, found);
  }
  return log;
}

/** Engine half of App.importReplayFromNotation (App.tsx), step for step. */
function importLikeApp(text: string): BoardState {
  const parsed = nota.parseMemoryNotation(text);
  let current = index.createPositionFromBackRankKey(parsed.config960);
  for (const token of parsed.moves) {
    const mv = token.move;
    if (token.requiredTopology && current.topologyState !== token.requiredTopology) {
      current = auxetic.toggleTopology(current);
    }
    if (mv.kind === 'topologyToggle') {
      current = auxetic.applyRotationMove(current);
    } else if (mv.kind === 'castle') {
      const targetFile = token.castleSide === 'queen' ? 'c' : 'g';
      const c = moves.generateLegalMoves(current).find((m) => m.kind === 'castle' && m.to?.[0] === targetFile);
      if (!c) throw new Error('No legal castle move available at this position.');
      current = moves.applyMove(current, c);
    } else if (mv.from && mv.to) {
      if (!current.pieces[mv.from]) throw new Error(`Illegal move: no piece on ${mv.from}.`);
      const matched = moves.generateLegalMoves(current).find(
        (m) => m.from === mv.from && m.to === mv.to && (!mv.promotion || m.promotion === mv.promotion),
      ) ?? mv;
      current = moves.applyMove(current, matched);
    }
  }
  return current;
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
  if (a.lastMoveWasRotation !== b.lastRot) return `lastMoveWasRotation import=${a.lastMoveWasRotation} expected=${b.lastRot}`;
  return null;
}

const failures: string[] = [];
const featureCount = new Map<string, number>();
const fixtures: Array<{ name: string; notation: string; features: string[]; plies: number; final: { topology: string; side: string; pieces: Record<string, string> } }> = [];
const wanted = ['ep-B', 'promotion-B', 'rotation-promotion', 'castle-B', 'promotion-B-under', 'ep-A', 'castle-A'];

for (let seed = 1; seed <= GAMES; seed++) {
  const start = index.createStartingPosition(seed);
  const g = playOracleGame(O, toOState(start), seed, PLIES);
  for (const f of g.features) featureCount.set(f, (featureCount.get(f) ?? 0) + 1);
  const mine = writeNotation(g);

  let appNotation: string;
  try {
    appNotation = build.buildSavedGameSnapshot(appLog(g, start), 'rt').notation;
  } catch (e) {
    failures.push(`seed ${seed}: ${(e as Error).message}`);
    continue;
  }
  const a = moveLines(mine);
  const b = moveLines(appNotation);
  const i = a.findIndex((l, k) => l !== b[k]);
  if (i >= 0 || a.length !== b.length) {
    failures.push(`seed ${seed}: exporter differs at line ${i + 1}: expected "${a[i]}" got "${b[i]}"`);
  }

  try {
    const d = diffState(importLikeApp(mine), g.final);
    if (d) failures.push(`seed ${seed}: import lands elsewhere — ${d}`);
  } catch (e) {
    failures.push(`seed ${seed}: import throws — ${(e as Error).message}`);
  }

  // Fixtures for the UI round trip: even ply count (white to move, so the
  // bot does not reply before the board is read), short, feature-rich.
  const f = [...g.features].filter((x) => wanted.includes(x));
  if (g.plies.length % 2 === 0 && g.plies.length <= 90 && f.length && fixtures.length < 8 &&
      f.some((x) => !fixtures.some((fx) => fx.features.includes(x)))) {
    const pieces: Record<string, string> = {};
    for (const [sq, p] of Object.entries(g.final.pieces)) if (p) pieces[sq] = `${p.color} ${p.type}`;
    fixtures.push({ name: `seed${seed}`, notation: mine, features: f, plies: g.plies.length, final: { topology: g.final.topo, side: g.final.side, pieces } });
  }
}

console.log('features', JSON.stringify(Object.fromEntries(featureCount)));
if (process.env.QA_WRITE_REPLAYS) {
  const file = path.join(QA_ROOT, 'fixtures', 'replays.json');
  fs.writeFileSync(file, `${JSON.stringify(fixtures, null, 1)}\n`);
  console.log(`wrote ${fixtures.length} UI fixtures -> ${path.relative(process.cwd(), file)} (${fixtures.map((x) => x.features.join('+')).join(', ')})`);
}
if (failures.length) {
  console.log(`\nFAIL ${failures.length}/${GAMES}`);
  for (const f of failures.slice(0, 15)) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log(`\nALL PASS: ${GAMES} games round-trip (export format + import position)`);
}
