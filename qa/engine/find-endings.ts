/* Finds short legal games (oracle-played) that stop one white move before
 * a checkmate or a stalemate, in topology A and in B, for the UI tests of
 * the end scenes: load the log with "Load replay", play the last move by
 * hand, watch what the app does. Prints JSON to stdout.
 *
 * Run: ENDINGS_OUT=qa/fixtures/endings.json npx tsx qa/engine/find-endings.ts
 *      (ENDINGS_MS caps the search, default 4 min; results are written as found)
 */
import type { OState } from './oracle';
import { Oracle, enemy } from './oracle';
import { loadEngine } from './_src';
import { loadLayout } from './layout';
import { playOracleGame, writeNotation, plyToken, type Ply } from './play';

const { index } = await loadEngine();
const { layout } = await loadLayout();
const O = new Oracle(layout);
const found: Record<string, unknown> = {};
const want = ['mate-A', 'mate-B', 'stalemate-A', 'stalemate-B'];
const deadline = Date.now() + Number(process.env.ENDINGS_MS ?? 240_000);
const OUT = process.env.ENDINGS_OUT;
const fs = await import('node:fs');
const flush = () => { if (OUT) fs.writeFileSync(OUT, `${JSON.stringify(found, null, 1)}
`); };

function replay(start: OState, plies: Ply[]): OState[] {
  const states = [start];
  let s = start;
  for (const p of plies) {
    if (p.rotation) {
      const { pieces } = O.rotatePieces(s.pieces, p.rotation.to);
      s = { ...s, pieces, topo: p.rotation.to, side: enemy(s.side), ep: null, lastRot: true };
    } else {
      s = { ...s, pieces: O.apply(s.pieces, p.move!), side: enemy(s.side), ep: null, lastRot: false };
    }
    states.push(s);
  }
  return states;
}

for (let seed = 1; seed < 20000 && want.some((w) => !found[w]) && Date.now() < deadline; seed++) {
  const st = index.createStartingPosition(seed);
  const start: OState = { pieces: st.pieces, side: 'white', topo: 'A', castling: st.castlingRights, kingStart: st.kingStartSquares, ep: null, lastRot: false };
  const g = playOracleGame(O, start, seed, 70, 0.2);
  const states = replay(start, g.plies);
  for (let i = 0; i < g.plies.length; i += 2) {
    const s = states[i];
    if (s.side !== 'white') continue;
    for (const m of O.legal(s)) {
      if (m.castle || m.ep) continue;
      const after: OState = { ...s, pieces: O.apply(s.pieces, m), side: 'black', ep: null, lastRot: false };
      const noMoves = O.legal(after).length === 0;
      if (!noMoves || O.rotationLegal(after)) continue;
      const check = O.inCheck(after.pieces, after.topo, 'black');
      const kind = `${check ? 'mate' : 'stalemate'}-${s.topo}`;
      if (found[kind]) continue;
      const lead = { key: g.key, seed, plies: g.plies.slice(0, i) };
      found[kind] = {
        notation: writeNotation(lead),
        finalMove: { from: m.from, to: m.to, promo: m.promo ?? null, token: plyToken({ move: m, mover: s.pieces[m.from]!.type, topoBefore: s.topo, side: 'white' }) },
        leadPlies: i,
      };
      flush();
    }
  }
}
flush();
console.log(JSON.stringify(found, null, 1));
