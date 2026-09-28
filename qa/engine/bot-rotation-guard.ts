/* Two rotations in a row, from the bot's side.
 *
 * App.scheduleAiMove drops a rotation the engine returns when the last move
 * was a rotation (console.warn "[rotation guard] ... ignoring") and then
 * does nothing else — the bot never moves again. So the search must never
 * propose one. The risk is the transposition table: its key ignores the
 * "last move was a rotation" flag, and the table lives for the whole game.
 *
 * White plays random legal moves and rotates often; Black is the real
 * search (ai/search.ts) at each bot level's depth with a shortened budget,
 * the TT kept across the game exactly like the app keeps it. Checked on
 * every bot turn:
 *   - never a rotation right after White rotated;
 *   - never null while a legal move or a legal rotation exists (a stall).
 *
 * Run: npx tsx qa/engine/bot-rotation-guard.ts     (BOT_GAMES, BOT_PLIES)
 */
import type { Move } from '../../src/engine/types';
import { envInt, loadEngine, mulberry32, srcModule, type AiSearch, type AiTT } from './_src';

const GAMES = envInt('BOT_GAMES', 60);
const PLIES = envInt('BOT_PLIES', 80);
const { index, moves, auxetic } = await loadEngine();
const search = await srcModule<AiSearch>('ai/search.ts');
const tt = await srcModule<AiTT>('ai/tt.ts');

const LEVELS = [
  { name: 'casual', budgetMs: 40, maxDepth: 2 },
  { name: 'normal', budgetMs: 80, maxDepth: 4 },
  { name: 'strong', budgetMs: 150, maxDepth: 6 },
];

const problems: string[] = [];
let botTurns = 0;
let afterRotation = 0;

for (let g = 0; g < GAMES; g++) {
  const level = LEVELS[g % LEVELS.length];
  const rnd = mulberry32(9000 + g);
  let st = index.createStartingPosition(9000 + g);
  (tt as unknown as { ttClear?: () => void }).ttClear?.();
  for (let ply = 0; ply < PLIES; ply++) {
    const legal = moves.generateLegalMoves(st);
    const tog = auxetic.toggleTopology(st);
    const k = moves.findKing(tog, st.sideToMove);
    const rotOk = !st.lastMoveWasRotation && !!k &&
      !moves.isSquareAttacked(tog, k, st.sideToMove === 'white' ? 'black' : 'white', tog.topologyState);
    if (legal.length === 0 && !rotOk) break;

    if (st.sideToMove === 'white') {
      if (rotOk && (rnd() < 0.35 || legal.length === 0)) { st = auxetic.applyRotationMove(st); continue; }
      st = moves.applyMove(st, legal[Math.floor(rnd() * legal.length)]);
      continue;
    }

    botTurns++;
    if (st.lastMoveWasRotation) afterRotation++;
    const r = search.searchPosition(st, {
      budgetMs: level.budgetMs, maxDepth: level.maxDepth, lastMoveWasRotation: st.lastMoveWasRotation,
    });
    const best: Move | null = r.bestMove;
    const where = `game ${g} (${level.name}) ply ${ply} topo ${st.topologyState} fen ${index.toFEN(st)}`;
    if (!best) {
      problems.push(`null move with ${legal.length} legal moves / rotation ${rotOk} — ${where}`);
      break;
    }
    if (best.kind === 'topologyToggle' && st.lastMoveWasRotation) {
      problems.push(`ROTATION right after a rotation — ${where}`);
      break;
    }
    if (best.kind !== 'topologyToggle' && !legal.some((m) => m.from === best.from && m.to === best.to)) {
      problems.push(`illegal move ${best.from}-${best.to} — ${where}`);
      break;
    }
    st = best.kind === 'topologyToggle' ? auxetic.applyRotationMove(st) : moves.applyMove(st, best);
  }
}

console.log(`bot turns ${botTurns}, of which right after a rotation ${afterRotation}`);
if (problems.length) {
  console.log(`FAIL ${problems.length}`);
  for (const p of problems.slice(0, 10)) console.log(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log('PASS: the search never proposed a second rotation, never stalled, never played an illegal move');
}
