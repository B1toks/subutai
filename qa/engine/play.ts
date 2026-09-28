/* Oracle-only random games (no engine code involved) and an independent
 * writer for the move-log format the app's "Copy to clipboard" produces and
 * "Load replay" reads:
 *
 *   [Chess960 "RNBQKBNR"]
 *   [Seed "123"]
 *
 *   1. e2→e4  A→B
 *   2. Ng1→f3@B  O-O@B
 *
 * Piece letter from the moving piece, → between squares, =Q for a
 * promotion, @B on anything played while the board is in B, and a rotation
 * written as <from>→<to> topology.
 */
import type { Color, PieceMap, PieceType, SquareId, TopologyState } from '../../src/engine/types';
import { mulberry32 } from './_src';
import { Oracle, enemy, fwd, type OMove, type OState } from './oracle';

export interface Ply {
  rotation?: { from: TopologyState; to: TopologyState };
  move?: OMove;
  mover?: PieceType;
  topoBefore: TopologyState;
  side: Color;
}

export interface OracleGame {
  seed: number;
  key: string;
  plies: Ply[];
  final: OState;
  features: Set<string>;
}

export function backRankKey(pieces: PieceMap): string {
  const L: Record<string, string> = { rook: 'R', knight: 'N', bishop: 'B', queen: 'Q', king: 'K' };
  return 'abcdefgh'.split('').map((f) => L[pieces[`${f}1` as SquareId]?.type ?? ''] ?? '?').join('');
}

export function updateRights(r: OState['castling'], pieces: PieceMap, m: OMove, side: Color): OState['castling'] {
  const mover = pieces[m.from]!;
  let next = { ...r };
  if (mover.type === 'king') {
    if (side === 'white') next = { ...next, whiteKingSide: null, whiteQueenSide: null };
    else next = { ...next, blackKingSide: null, blackQueenSide: null };
  }
  for (const k of ['whiteKingSide', 'whiteQueenSide', 'blackKingSide', 'blackQueenSide'] as const) {
    if (next[k] && (next[k] === m.from || next[k] === m.to)) next = { ...next, [k]: null };
  }
  return next;
}

/** Plays one game with the App's rotation rule, tracked by the oracle only. */
export function playOracleGame(O: Oracle, start: OState, seed: number, maxPlies: number, pRot = 0.15): OracleGame {
  const rnd = mulberry32(seed * 104729);
  let s: OState = { ...start };
  const plies: Ply[] = [];
  const features = new Set<string>();
  for (let i = 0; i < maxPlies; i++) {
    const legal = O.legal(s);
    const rot = O.rotationLegal(s);
    if (legal.length === 0 && !rot) break;
    if ((rot && rnd() < pRot) || legal.length === 0) {
      const to: TopologyState = s.topo === 'A' ? 'B' : 'A';
      const { pieces, promoted } = O.rotatePieces(s.pieces, to);
      if (promoted.length) features.add('rotation-promotion');
      plies.push({ rotation: { from: s.topo, to }, topoBefore: s.topo, side: s.side });
      features.add('rotation');
      s = { ...s, pieces, topo: to, side: enemy(s.side), ep: null, lastRot: true };
      continue;
    }
    const special = legal.filter((m) => m.ep || m.castle || m.promo);
    const pawns = legal.filter((m) => s.pieces[m.from]?.type === 'pawn');
    const pool = special.length && rnd() < 0.6 ? special : pawns.length && rnd() < 0.4 ? pawns : legal;
    const m = pool[Math.floor(rnd() * pool.length)];
    const mover = s.pieces[m.from]!.type;
    if (m.ep) features.add(`ep-${s.topo}`);
    if (m.castle) features.add(`castle-${s.topo}`);
    if (m.promo) features.add(`promotion-${s.topo}${m.promo === 'queen' ? '' : '-under'}`);
    const a = O.xy(m.from, s.topo);
    const b = O.xy(m.to, s.topo);
    const ep = mover === 'pawn' && a.x === b.x && Math.abs(a.y - b.y) === 2
      ? { target: O.label(a.x, a.y + fwd(s.side), s.topo)!, victim: m.to }
      : null;
    plies.push({ move: m, mover, topoBefore: s.topo, side: s.side });
    s = {
      ...s,
      pieces: O.apply(s.pieces, m),
      castling: updateRights(s.castling, s.pieces, m, s.side),
      side: enemy(s.side),
      ep,
      lastRot: false,
    };
  }
  return { seed, key: backRankKey(start.pieces), plies, final: s, features };
}

const LETTER: Record<PieceType, string> = { pawn: '', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' };

export function plyToken(p: Ply): string {
  if (p.rotation) return `${p.rotation.from}→${p.rotation.to}`;
  const m = p.move!;
  let t = m.castle
    ? (m.to[0] === 'c' ? 'O-O-O' : 'O-O')
    : `${LETTER[p.mover!]}${m.from}→${m.to}${m.promo ? '=' + LETTER[m.promo] : ''}`;
  if (p.topoBefore === 'B') t += '@B';
  return t;
}

export function writeNotation(g: { key: string; seed: number; plies: Ply[] }): string {
  const lines = [`[Chess960 "${g.key}"]`, `[Seed "${g.seed}"]`, ''];
  for (let i = 0; i < g.plies.length; i += 2) {
    const w = plyToken(g.plies[i]);
    const b = g.plies[i + 1] ? `  ${plyToken(g.plies[i + 1])}` : '';
    lines.push(`${i / 2 + 1}. ${w}${b}`);
  }
  return lines.join('\n');
}

export function moveLines(notation: string): string[] {
  return notation.split('\n').map((l) => l.trim()).filter((l) => /^\d+\.\s/.test(l));
}
