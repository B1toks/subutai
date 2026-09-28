/* Independent rules oracle: ordinary chess played on the VISUAL 8×8 grid.
 *
 * A rotation reshuffles which labelled square sits where; the player then
 * moves pieces across the grid they see. So the oracle converts labels to
 * grid cells with the measured layout (layout.ts), generates moves the
 * textbook way on that grid, and converts back. It shares no code with
 * src/engine — agreement between the two is evidence, disagreement is a
 * lead.
 *
 * Deliberately mirrored from the engine because the product defines them
 * that way (not independent, documented so a reader knows):
 *   · a pawn may double-step while it stands on its colour's start RANK
 *     LABEL (2 for white, 7 for black);
 *   · castling follows Chess960 on the labelled back rank (king to g/c,
 *     rook to f/d), whatever the topology.
 * Transit squares for castling are tested with the king lifted off the
 * board, which is the standard formulation.
 */
import type {
  CastlingRights,
  Color,
  KingStartSquares,
  Piece,
  PieceMap,
  PieceType,
  SquareId,
  TopologyState,
} from '../../src/engine/types';
import { farRow, invert, type Layout } from './layout';

export interface OCell { color: Color; type: PieceType }

export interface OState {
  pieces: PieceMap;
  side: Color;
  topo: TopologyState;
  castling: CastlingRights;
  kingStart: KingStartSquares;
  /** Tracked by the driver from the previous ply, not read from the engine. */
  ep: { target: SquareId; victim: SquareId } | null;
  lastRot: boolean;
}

export interface OMove {
  from: SquareId;
  to: SquareId;
  promo?: PieceType;
  castle?: { rookFrom: SquareId; rookTo: SquareId };
  ep?: { victim: SquareId };
}

export const PROMOS: PieceType[] = ['queen', 'rook', 'bishop', 'knight'];

export function enemy(c: Color): Color {
  return c === 'white' ? 'black' : 'white';
}
export function fwd(c: Color): number {
  return c === 'white' ? -1 : 1; // screen y grows downwards
}

export class Oracle {
  private readonly inv: Record<TopologyState, (SquareId | undefined)[]>;
  constructor(readonly layout: Layout) {
    this.inv = invert(layout);
  }

  xy(sq: SquareId, topo: TopologyState) {
    return this.layout[topo][sq];
  }
  label(x: number, y: number, topo: TopologyState): SquareId | null {
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return this.inv[topo][y * 8 + x] ?? null;
  }

  grid(pieces: PieceMap, topo: TopologyState): (OCell | null)[] {
    const g: (OCell | null)[] = new Array(64).fill(null);
    for (const [sq, p] of Object.entries(pieces) as Array<[SquareId, Piece | undefined]>) {
      if (!p) continue;
      const { x, y } = this.xy(sq, topo);
      g[y * 8 + x] = { color: p.color, type: p.type };
    }
    return g;
  }

  attacked(g: (OCell | null)[], x: number, y: number, by: Color): boolean {
    const at = (cx: number, cy: number) =>
      cx < 0 || cx > 7 || cy < 0 || cy > 7 ? undefined : g[cy * 8 + cx];
    for (const [dx, dy] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
      const p = at(x + dx, y + dy);
      if (p && p.color === by && p.type === 'knight') return true;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const diag = dx !== 0 && dy !== 0;
      for (let i = 1; i < 8; i++) {
        const p = at(x + dx * i, y + dy * i);
        if (p === undefined) break;
        if (p === null) continue;
        if (p.color === by) {
          if (i === 1 && p.type === 'king') return true;
          if (p.type === 'queen') return true;
          if (diag && p.type === 'bishop') return true;
          if (!diag && p.type === 'rook') return true;
        }
        break;
      }
    }
    // A pawn of `by` standing one row BEHIND (x,y) from its own point of
    // view, diagonally, attacks it.
    const py = y - fwd(by);
    for (const px of [x - 1, x + 1]) {
      const p = at(px, py);
      if (p && p.color === by && p.type === 'pawn') return true;
    }
    return false;
  }

  kingXY(g: (OCell | null)[], c: Color): { x: number; y: number } | null {
    for (let i = 0; i < 64; i++) {
      const p = g[i];
      if (p && p.type === 'king' && p.color === c) return { x: i % 8, y: Math.floor(i / 8) };
    }
    return null;
  }

  inCheck(pieces: PieceMap, topo: TopologyState, c: Color): boolean {
    const g = this.grid(pieces, topo);
    const k = this.kingXY(g, c);
    return k ? this.attacked(g, k.x, k.y, enemy(c)) : false;
  }

  /** Pieces after the board turns: pawns now on their own far row become queens. */
  rotatePieces(pieces: PieceMap, newTopo: TopologyState): { pieces: PieceMap; promoted: SquareId[] } {
    const promoted: SquareId[] = [];
    const out: Record<string, Piece> = {};
    for (const [sq, p] of Object.entries(pieces) as Array<[SquareId, Piece | undefined]>) {
      if (!p) continue;
      if (p.type === 'pawn' && this.xy(sq, newTopo).y === farRow(p.color)) {
        promoted.push(sq);
        out[sq] = { ...p, type: 'queen' };
      } else {
        out[sq] = p;
      }
    }
    return { pieces: out as PieceMap, promoted: promoted.sort() };
  }

  /** Classic rules: may the side to move spend its turn rotating? */
  rotationLegal(s: OState): boolean {
    if (s.lastRot) return false;
    const newTopo: TopologyState = s.topo === 'A' ? 'B' : 'A';
    const { pieces } = this.rotatePieces(s.pieces, newTopo);
    return !this.inCheck(pieces, newTopo, s.side);
  }

  apply(pieces: PieceMap, m: OMove): PieceMap {
    const out: Record<string, Piece> = { ...(pieces as Record<string, Piece>) };
    const mover = out[m.from];
    if (m.castle) {
      const rook = out[m.castle.rookFrom];
      delete out[m.from];
      delete out[m.castle.rookFrom];
      out[m.to] = mover;
      out[m.castle.rookTo] = rook;
      return out as PieceMap;
    }
    delete out[m.from];
    if (m.ep) delete out[m.ep.victim];
    out[m.to] = m.promo ? { ...mover, type: m.promo } : mover;
    return out as PieceMap;
  }

  pseudo(s: OState): OMove[] {
    const { topo, side } = s;
    const g = this.grid(s.pieces, topo);
    const at = (x: number, y: number) =>
      x < 0 || x > 7 || y < 0 || y > 7 ? undefined : g[y * 8 + x];
    const L = (x: number, y: number) => this.label(x, y, topo)!;
    const out: OMove[] = [];

    for (const [from, p] of Object.entries(s.pieces) as Array<[SquareId, Piece | undefined]>) {
      if (!p || p.color !== side) continue;
      const { x, y } = this.xy(from, topo);
      const push = (tx: number, ty: number) => out.push({ from, to: L(tx, ty) });

      if (p.type === 'knight') {
        for (const [dx, dy] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
          const q = at(x + dx, y + dy);
          if (q === undefined) continue;
          if (q === null || q.color !== side) push(x + dx, y + dy);
        }
      } else if (p.type === 'king') {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const q = at(x + dx, y + dy);
          if (q === undefined) continue;
          if (q === null || q.color !== side) push(x + dx, y + dy);
        }
      } else if (p.type === 'pawn') {
        const f = fwd(side);
        const promoteAt = (ty: number) => ty === farRow(side);
        const add = (tx: number, ty: number) => {
          const to = L(tx, ty);
          if (promoteAt(ty)) for (const promo of PROMOS) out.push({ from, to, promo });
          else out.push({ from, to });
        };
        if (at(x, y + f) === null) {
          add(x, y + f);
          const startRank = side === 'white' ? '2' : '7';
          if (from[1] === startRank && at(x, y + 2 * f) === null) add(x, y + 2 * f);
        }
        for (const tx of [x - 1, x + 1]) {
          const q = at(tx, y + f);
          if (q && q.color !== side) add(tx, y + f);
          else if (q === null && s.ep && L(tx, y + f) === s.ep.target) {
            out.push({ from, to: s.ep.target, ep: { victim: s.ep.victim } });
          }
        }
      } else {
        const dirs =
          p.type === 'rook' ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
          : p.type === 'bishop' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
          : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        for (const [dx, dy] of dirs) {
          for (let i = 1; i < 8; i++) {
            const q = at(x + dx * i, y + dy * i);
            if (q === undefined) break;
            if (q === null) { push(x + dx * i, y + dy * i); continue; }
            if (q.color !== side) push(x + dx * i, y + dy * i);
            break;
          }
        }
      }
    }
    out.push(...this.castles(s, g));
    return out;
  }

  private castles(s: OState, g: (OCell | null)[]): OMove[] {
    const side = s.side;
    const kingFrom = s.kingStart[side];
    if (!kingFrom) return [];
    const king = s.pieces[kingFrom];
    if (!king || king.type !== 'king' || king.color !== side) return [];
    const rank = side === 'white' ? '1' : '8';
    const rights =
      side === 'white'
        ? [[s.castling.whiteKingSide, 'g', 'f'], [s.castling.whiteQueenSide, 'c', 'd']]
        : [[s.castling.blackKingSide, 'g', 'f'], [s.castling.blackQueenSide, 'c', 'd']];
    const out: OMove[] = [];
    const between = (a: string, b: string) => {
      const fa = a.charCodeAt(0);
      const fb = b.charCodeAt(0);
      const step = fa <= fb ? 1 : -1;
      const sqs: SquareId[] = [];
      for (let f = fa; ; f += step) {
        sqs.push(`${String.fromCharCode(f)}${rank}` as SquareId);
        if (f === fb) break;
      }
      return sqs;
    };
    for (const [rookFrom, kf, rf] of rights as Array<[SquareId | null, string, string]>) {
      if (!rookFrom) continue;
      const rook = s.pieces[rookFrom];
      if (!rook || rook.type !== 'rook' || rook.color !== side) continue;
      const kingTo = `${kf}${rank}` as SquareId;
      const rookTo = `${rf}${rank}` as SquareId;
      const kingPath = between(kingFrom, kingTo);
      const rookPath = between(rookFrom, rookTo);
      let clear = true;
      for (const sq of new Set([...kingPath, ...rookPath])) {
        if (sq === kingFrom || sq === rookFrom) continue;
        if (s.pieces[sq]) { clear = false; break; }
      }
      if (!clear) continue;
      // King lifted: it cannot shield its own path.
      const lifted = g.slice();
      const k = this.xy(kingFrom, s.topo);
      lifted[k.y * 8 + k.x] = null;
      let safe = !this.attacked(g, k.x, k.y, enemy(side));
      for (const sq of kingPath) {
        if (!safe) break;
        const p = this.xy(sq, s.topo);
        if (this.attacked(lifted, p.x, p.y, enemy(side))) safe = false;
      }
      if (!safe) continue;
      out.push({ from: kingFrom, to: kingTo, castle: { rookFrom, rookTo } });
    }
    return out;
  }

  legal(s: OState): OMove[] {
    return this.pseudo(s).filter((m) => !this.inCheck(this.apply(s.pieces, m), s.topo, s.side));
  }
}

export function moveKey(m: { from?: SquareId; to?: SquareId; promo?: PieceType; promotion?: PieceType; castle?: unknown; kind?: string }): string {
  const promo = m.promo ?? m.promotion;
  const castle = m.castle || m.kind === 'castle';
  return `${castle ? 'O:' : ''}${m.from}-${m.to}${promo ? '=' + promo[0] : ''}`;
}
