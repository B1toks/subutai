/* Engine fuzz: thousands of random legal games with rotations, in both
 * topologies, cross-checked ply by ply against the independent oracle.
 *
 * Invariants (each is a violation category in the report):
 *   pawn-on-far-row        no pawn ever stands on its colour's VISUAL far row
 *   self-check             no legal move leaves the mover's king attacked
 *   movegen-extra/missing  engine and oracle agree on the legal move set
 *   ep-*                   en passant exists only on the ply right after a
 *                          double step, onto the square it passed, in A and B
 *   rotation-legality      "may I rotate?" agrees (no two in a row, king safe)
 *   rotation-promotion     a rotation that carries a pawn to the edge queens it
 *   terminal               checkmate / stalemate agree (rotation as an escape)
 *   state-divergence       engine bookkeeping (side, topology, castling, the
 *                          lastMoveWasRotation flag) matches independent tracking
 *
 * Run:  npx tsx qa/engine/fuzz-invariants.ts
 * Env:  FUZZ_GAMES (default 2000)  FUZZ_PLIES (default 160)  FUZZ_SEED (default 1)
 *       QA_SRC=<other checkout>/src to test another branch.
 * Exit code 1 when any invariant is violated. Repro logs for the first few
 * violations of each kind land in qa/out/ in the exact format "Load replay"
 * accepts.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BoardState, CastlingRights, Color, Move, SquareId } from '../../src/engine/types';
import {
  QA_ROOT, SRC_ROOT, envInt, loadEngine, mulberry32, srcModule,
  type MemoryBuild, type RecordingLog,
} from './_src';
import { ALL_SQUARES, farRow, layoutFromCode, loadLayout } from './layout';
import { Oracle, enemy, fwd, moveKey, type OMove, type OState } from './oracle';

const GAMES = envInt('FUZZ_GAMES', 2000);
const PLIES = envInt('FUZZ_PLIES', 160);
const BASE_SEED = envInt('FUZZ_SEED', 1);
const P_ROT = 0.15;
const P_PAWN = 0.4;
const EXAMPLES_PER_KIND = 4;

const { index, moves, auxetic } = await loadEngine();
const rec = await srcModule<RecordingLog>('recording/log.ts');
const build = await srcModule<MemoryBuild>('memory/build.ts');
const { layout, source } = await loadLayout();
const O = new Oracle(layout);

const outDir = path.join(QA_ROOT, 'out');
fs.mkdirSync(outDir, { recursive: true });

console.log(`src: ${SRC_ROOT}`);
console.log(`visual layout: ${source}${source === 'code' ? '  (WARNING: no DOM fixture; run qa/e2e layout.spec first)' : ''}`);

// The renderer must draw what the fixture measured.
if (source === 'dom-fixture') {
  const code = await layoutFromCode();
  const drift = (['A', 'B'] as const).flatMap((t) =>
    ALL_SQUARES.filter((sq) => code[t][sq].x !== layout[t][sq].x || code[t][sq].y !== layout[t][sq].y)
      .map((sq) => `${t}:${sq}`),
  );
  if (drift.length) console.log(`NOTE getSquarePosition differs from DOM fixture at ${drift.join(' ')}`);
}

type Kind = string;
const violations = new Map<Kind, { count: number; examples: string[] }>();
function violate(kind: Kind, detail: string, ctx: Ctx) {
  let v = violations.get(kind);
  if (!v) violations.set(kind, (v = { count: 0, examples: [] }));
  v.count++;
  if (v.examples.length < EXAMPLES_PER_KIND) {
    const file = path.join(outDir, `fuzz-${kind}-seed${ctx.seed}-ply${ctx.ply}.txt`);
    const notation = build.buildSavedGameSnapshot(ctx.log, 'qa').notation;
    fs.writeFileSync(file, `${notation}\n`);
    v.examples.push(
      `seed=${ctx.seed} ply=${ctx.ply} topo=${ctx.st.topologyState} side=${ctx.st.sideToMove} ` +
      `lastRot=${ctx.st.lastMoveWasRotation}\n      fen=${ctx.fen}\n      ${detail}\n      repro: ${path.relative(process.cwd(), file)}`,
    );
  }
}

interface Ctx {
  seed: number;
  ply: number;
  st: BoardState;
  log: ReturnType<RecordingLog['createGameLog']>;
  fen: string;
}

const stats = {
  games: 0, plies: 0, pliesInB: 0, rotations: 0, rotationPromotions: 0,
  promotionsA: 0, promotionsB: 0, epA: 0, epB: 0, epOffered: 0, castlesA: 0, castlesB: 0,
  checks: 0, mates: 0, stalemates: 0, matesAfterRotation: 0,
};

function samePieces(a: BoardState['pieces'], b: BoardState['pieces']): string | null {
  for (const sq of ALL_SQUARES) {
    const p = a[sq];
    const q = b[sq];
    if (!p && !q) continue;
    if (!p || !q || p.color !== q.color || p.type !== q.type) {
      return `${sq}: engine=${p ? p.color + ' ' + p.type : 'empty'} oracle=${q ? q.color + ' ' + q.type : 'empty'}`;
    }
  }
  return null;
}

function updateRights(r: CastlingRights, pieces: BoardState['pieces'], m: OMove, side: Color): CastlingRights {
  const mover = pieces[m.from]!;
  let next = { ...r };
  if (mover.type === 'king') {
    if (side === 'white') next = { ...next, whiteKingSide: null, whiteQueenSide: null };
    else next = { ...next, blackKingSide: null, blackQueenSide: null };
  }
  const keys = ['whiteKingSide', 'whiteQueenSide', 'blackKingSide', 'blackQueenSide'] as const;
  for (const k of keys) {
    if (next[k] && (next[k] === m.from || next[k] === m.to)) next = { ...next, [k]: null };
  }
  return next;
}

for (let g = 0; g < GAMES; g++) {
  const seed = BASE_SEED + g;
  const rnd = mulberry32(seed * 7919);
  let st = index.createStartingPosition(seed);
  let os: OState = {
    pieces: st.pieces, side: st.sideToMove, topo: st.topologyState,
    castling: st.castlingRights, kingStart: st.kingStartSquares, ep: null, lastRot: false,
  };
  let log = rec.createGameLog(`fuzz-${seed}`, st, seed);
  stats.games++;

  for (let ply = 0; ply < PLIES; ply++) {
    const ctx: Ctx = { seed, ply, st, log, fen: fenOf(st) };

    // --- bookkeeping agrees with independent tracking
    const diff = samePieces(st.pieces, os.pieces);
    const book: string[] = [];
    if (diff) book.push(`pieces ${diff}`);
    if (st.sideToMove !== os.side) book.push(`side engine=${st.sideToMove} oracle=${os.side}`);
    if (st.topologyState !== os.topo) book.push(`topology engine=${st.topologyState} oracle=${os.topo}`);
    if (st.lastMoveWasRotation !== os.lastRot) book.push(`lastMoveWasRotation engine=${st.lastMoveWasRotation} oracle=${os.lastRot}`);
    if (JSON.stringify(st.castlingRights) !== JSON.stringify(os.castling)) {
      book.push(`castling engine=${JSON.stringify(st.castlingRights)} oracle=${JSON.stringify(os.castling)}`);
    }
    if (book.length) {
      violate('state-divergence', book.join('; '), ctx);
      break; // tracking is off; the rest of this game proves nothing
    }

    stats.plies++;
    if (st.topologyState === 'B') stats.pliesInB++;

    // --- 1. no pawn on its visual far row
    for (const [sq, p] of Object.entries(st.pieces) as Array<[SquareId, NonNullable<BoardState['pieces'][SquareId]>]>) {
      if (p.type === 'pawn' && layout[st.topologyState][sq].y === farRow(p.color)) {
        violate('pawn-on-far-row', `${p.color} pawn on ${sq} (visual row ${layout[st.topologyState][sq].y})`, ctx);
      }
    }

    // --- differential move generation
    const eng = moves.generateLegalMoves(st);
    const ora = O.legal(os);
    const engKeys = new Map(eng.map((m) => [moveKey(m), m]));
    const oraKeys = new Map(ora.map((m) => [moveKey(m), m]));
    const extra = [...engKeys.keys()].filter((k) => !oraKeys.has(k));
    const missing = [...oraKeys.keys()].filter((k) => !engKeys.has(k));
    if (extra.length) violate(extra.some((k) => k.startsWith('O:')) ? 'movegen-extra-castle' : 'movegen-extra', `engine-only: ${extra.join(' ')}`, ctx);
    if (missing.length) violate(missing.some((k) => k.startsWith('O:')) ? 'movegen-missing-castle' : 'movegen-missing', `oracle-only: ${missing.join(' ')}`, ctx);

    // --- 2. legal moves never leave own king attacked; no pawn left on the edge
    for (const m of eng) {
      const next = moves.applyMove(st, m);
      if (O.inCheck(next.pieces, next.topologyState, st.sideToMove)) {
        violate('self-check', `move ${moveKey(m)} (${m.kind}) leaves ${st.sideToMove} king attacked`, ctx);
      }
      if (m.kind === 'promotion' && next.pieces[m.to!]?.type === 'pawn') {
        violate('pawn-on-far-row', `promotion move ${moveKey(m)} left a pawn`, ctx);
      }
    }

    // --- 4. en passant only right after a double step, onto the passed square
    for (const m of eng.filter((x) => x.kind === 'enPassant')) {
      if (!os.ep) violate('ep-without-double-push', `engine offers ${moveKey(m)} but the previous ply was not a double step`, ctx);
      else if (m.to !== os.ep.target) violate('ep-wrong-square', `engine EP to ${m.to}, passed square is ${os.ep.target}`, ctx);
      else {
        const after = moves.applyMove(st, m);
        if (after.pieces[os.ep.victim]) violate('ep-wrong-victim', `EP ${moveKey(m)} did not remove the pawn on ${os.ep.victim}`, ctx);
      }
    }
    if (ora.some((m) => m.ep)) stats.epOffered++;

    // --- rotation legality (mirror of App.rotateIsLegal: engine helpers only)
    const toggled = auxetic.toggleTopology(st);
    const k = moves.findKing(toggled, st.sideToMove);
    const appRot = !st.lastMoveWasRotation && !!k &&
      !moves.isSquareAttacked(toggled, k, enemy(st.sideToMove), toggled.topologyState);
    const oraRot = O.rotationLegal(os);
    if (appRot !== oraRot) violate('rotation-legality', `app=${appRot} oracle=${oraRot}`, ctx);

    // --- terminal status
    const oraCheck = O.inCheck(os.pieces, os.topo, os.side);
    if (moves.isInCheck(st) !== oraCheck) violate('check-detection', `engine=${moves.isInCheck(st)} oracle=${oraCheck}`, ctx);
    if (oraCheck) stats.checks++;
    const oraMate = oraCheck && ora.length === 0 && !oraRot;
    const oraStale = !oraCheck && ora.length === 0 && !oraRot;
    const engMate = moves.isCheckmate(st, st.lastMoveWasRotation);
    const engStale = moves.isStalemate(st, st.lastMoveWasRotation);
    if (engMate !== oraMate || engStale !== oraStale) {
      violate('terminal', `engine mate=${engMate} stale=${engStale}; oracle mate=${oraMate} stale=${oraStale}`, ctx);
    }
    if (oraMate) { stats.mates++; if (os.lastRot) stats.matesAfterRotation++; break; }
    if (oraStale) { stats.stalemates++; break; }
    if (ora.length === 0 && !oraRot) break;

    // --- act: rotate or move
    if ((oraRot && rnd() < P_ROT) || (ora.length === 0 && oraRot)) {
      const newTopo = os.topo === 'A' ? 'B' : 'A';
      const pred = O.rotatePieces(os.pieces, newTopo);
      const tog: Move = { kind: 'topologyToggle' };
      log = rec.appendMove(log, tog, rec.computeSAN(st, tog), st.topologyState);
      const next = auxetic.applyRotationMove(st);
      const d = samePieces(next.pieces, pred.pieces);
      if (d) violate('rotation-promotion', `after ${st.topologyState}->${newTopo}: ${d}`, { ...ctx, log });
      stats.rotations++;
      stats.rotationPromotions += pred.promoted.length;
      st = next;
      os = { ...os, pieces: pred.pieces, side: enemy(os.side), topo: newTopo, ep: null, lastRot: true };
      continue;
    }

    // Rare events get a thumb on the scale so thousands of games actually
    // exercise them: en passant and castling when offered, pawns often.
    const special = ora.filter((m) => m.ep || m.castle);
    const pawnMoves = ora.filter((m) => os.pieces[m.from]?.type === 'pawn');
    const pool =
      special.length && rnd() < 0.5 ? special
      : pawnMoves.length && rnd() < P_PAWN ? pawnMoves
      : ora;
    const om = pool[Math.floor(rnd() * pool.length)];
    const em = engKeys.get(moveKey(om));
    if (!em) break; // already reported as movegen-missing
    const mover = os.pieces[om.from]!;
    const fromXY = layout[os.topo][om.from];
    const toXY = layout[os.topo][om.to];
    if (em.kind === 'promotion') { if (os.topo === 'A') stats.promotionsA++; else stats.promotionsB++; }
    if (em.kind === 'enPassant') { if (os.topo === 'A') stats.epA++; else stats.epB++; }
    if (em.kind === 'castle') { if (os.topo === 'A') stats.castlesA++; else stats.castlesB++; }

    log = rec.appendMove(log, em, rec.computeSAN(st, em), st.topologyState);
    const castling = updateRights(os.castling, os.pieces, om, os.side);
    const epNext =
      mover.type === 'pawn' && fromXY.x === toXY.x && Math.abs(toXY.y - fromXY.y) === 2
        ? { target: O.label(fromXY.x, fromXY.y + fwd(os.side), os.topo)!, victim: om.to }
        : null;
    st = moves.applyMove(st, em);
    os = { ...os, pieces: O.apply(os.pieces, om), side: enemy(os.side), castling, ep: epNext, lastRot: false };
  }
}

function fenOf(s: BoardState): string {
  // Local FEN writer (board part + side + topology) so the report does not
  // depend on the engine's own serialiser.
  const rows: string[] = [];
  for (let r = 8; r >= 1; r--) {
    let row = '';
    let empty = 0;
    for (const f of 'abcdefgh') {
      const p = s.pieces[`${f}${r}` as SquareId];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      const ch = p.type === 'knight' ? 'n' : p.type[0];
      row += p.color === 'white' ? ch.toUpperCase() : ch;
    }
    rows.push(row + (empty ? empty : ''));
  }
  return `${rows.join('/')} ${s.sideToMove[0]} topo=${s.topologyState}`;
}

console.log('\nstats', JSON.stringify(stats));
if (violations.size === 0) {
  console.log(`\nALL INVARIANTS HELD over ${stats.games} games / ${stats.plies} plies`);
} else {
  console.log('\nVIOLATIONS');
  for (const [kind, v] of [...violations.entries()].sort()) {
    console.log(`\n  ${kind}: ${v.count}`);
    for (const e of v.examples) console.log(`    - ${e}`);
  }
  process.exitCode = 1;
}
