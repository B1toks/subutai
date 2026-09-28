/* QA-02: Load replay must reject every log a live game could not have
 * produced, with an error naming the move, and still accept every legal
 * log the app exports (qa/fixtures/replays.json: castling / en passant /
 * promotion in B, under-promotion, promotion by rotation).
 *
 * Run: npx tsx scripts/test-replay-import.ts
 */
import fs from 'node:fs';
import { replayFromNotation } from '../src/memory/replayImport';
import { NotationParseError } from '../src/memory/notation';

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
}

const H = '[Chess960 "RNBQKBNR"]\n[Seed "1"]\n\n';
const endings = JSON.parse(
  fs.readFileSync(new URL('../qa/fixtures/endings.json', import.meta.url), 'utf8'),
) as Record<string, { notation: string }>;
// Mate-in-one fixture; "12. Nd3→e5" delivers it.
const MATE_A = endings['mate-A'].notation;
// The report's five logs, plus the move number each error must name.
const BROKEN: [string, string, number][] = [
  ['queen jumps through pawns', `${H}1. Qd1→d8`, 1],
  ['black moves first', `${H}1. e7→e5`, 1],
  ['two rotations in a row', `${H}1. A→B  B→A`, 1],
  ['@B tag with no rotation', `${H}1. e2→e4@B`, 1],
  ['king captured by an illegal move', `${H}1. Qd1→e8`, 1],
  // and a few more ways to lie
  ['wrong piece letter', `${H}1. e2→e4  e7→e5\n2. Ng1→f3  Bb8→c6`, 2],
  ['rotation written from the wrong side', `${H}1. B→A`, 1],
  ['move after checkmate', `${MATE_A}\n12. Nd3→e5  Kc8→c7`, 12],
  ['illegal later in the game', `${H}1. e2→e4  e7→e5\n2. e4→e6`, 2],
];

for (const [name, text, moveNo] of BROKEN) {
  try {
    replayFromNotation(text);
    check(name, false, 'accepted');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(
      name,
      e instanceof NotationParseError && msg.startsWith(`Move ${moveNo} `),
      `rejected: ${msg}`,
    );
  }
}

interface Fixture {
  name: string;
  notation: string;
  plies: number;
  final: { topology: string; side: string; pieces: Record<string, string> };
}
const fixtures = JSON.parse(
  fs.readFileSync(new URL('../qa/fixtures/replays.json', import.meta.url), 'utf8'),
) as Fixture[];
for (const fx of fixtures) {
  try {
    const r = replayFromNotation(fx.notation);
    const pieces: Record<string, string> = {};
    for (const [sq, p] of Object.entries(r.final.pieces)) if (p) pieces[sq] = `${p.color} ${p.type}`;
    const samePieces =
      JSON.stringify(Object.entries(pieces).sort()) === JSON.stringify(Object.entries(fx.final.pieces).sort());
    check(
      `legal fixture ${fx.name}`,
      samePieces &&
        r.final.topologyState === fx.final.topology &&
        r.final.sideToMove === fx.final.side &&
        r.log.moves.length === fx.plies,
      `${r.log.moves.length} plies, ${r.final.topologyState}, ${r.final.sideToMove} to move, pieces ${samePieces ? 'match' : 'DIFFER'}`,
    );
  } catch (e) {
    check(`legal fixture ${fx.name}`, false, `rejected: ${e instanceof Error ? e.message : e}`);
  }
}

// A finished game imports (it is legal); the app then shows it as over.
try {
  const r = replayFromNotation(`${MATE_A}\n12. Nd3→e5`);
  check('a log ending in mate is accepted', r.log.moves.length === 23, `${r.log.moves.length} plies`);
} catch (e) {
  check('a log ending in mate is accepted', false, String(e));
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
if (failures) process.exitCode = 1;
