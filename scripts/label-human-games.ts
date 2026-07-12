/* R15 step 1: offline eval labelling of the human games dump.
 * Replays every /games log through the same classifier the in-app review
 * uses (classifyMove: search 150ms/depth5 per side) and writes per-move
 * labels to data/human-games-labelled.json. Rotations get an eval via a
 * direct post-rotation search (classifyMove doesn't handle them).
 *
 * Run: npx tsx scripts/label-human-games.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createPositionFromBackRankKey } from '../src/engine';
import type { BoardState, Move } from '../src/engine';
import { applyMove } from '../src/engine/moves';
import { applyRotationMove, toggleTopology } from '../src/engine/auxetic';
import { classifyMove, type MoveAnalysis } from '../src/analysis/classify';
import { searchPosition } from '../src/ai/search';

interface DumpMove {
  san?: string;
  move: Move & { kind?: string };
  topology?: 'A' | 'B';
  timestamp: number;
}
interface DumpGame {
  id: string;
  chess960Id: string;
  humanColor: 'white' | 'black';
  outcome: string;
  gameMode?: 'classic' | 'roulette';
  createdAt: number;
  durationMs?: number;
  points?: { total?: number };
  log?: { initialTopology: 'A' | 'B'; moves: DumpMove[] };
}

export interface MoveLabel {
  i: number;
  san?: string;
  mover: 'white' | 'black';
  isHuman: boolean;
  rotation: boolean;
  /** search eval AFTER the move, from White's perspective, centipawns */
  evalW: number;
  cpl: number;
  cls: MoveAnalysis['classification'] | 'rotation';
  isMate?: boolean;
  timestamp: number;
}

const BUDGET = { budgetMs: 150, maxDepth: 5 };

const games: DumpGame[] = JSON.parse(
  readFileSync('data/games-dump.json', 'utf8'),
);

const out: object[] = [];
const t0 = Date.now();
let moveTotal = 0;

for (const [gi, g] of games.entries()) {
  const moves = g.log?.moves ?? [];
  if (!moves.length || !g.chess960Id) continue;
  const allowSelfCheck = g.gameMode === 'roulette';

  let state: BoardState = createPositionFromBackRankKey(g.chess960Id);
  if (g.log!.initialTopology === 'B') state = toggleTopology(state);

  const labels: MoveLabel[] = [];
  for (const [i, entry] of moves.entries()) {
    const mover = state.sideToMove;
    const isHuman = mover === g.humanColor;
    try {
      if (entry.move.kind === 'topologyToggle') {
        const after = applyRotationMove(state);
        const s = searchPosition(after, { ...BUDGET, allowSelfCheck });
        const evalW = after.sideToMove === 'white' ? s.score : -s.score;
        labels.push({
          i, san: entry.san, mover, isHuman, rotation: true,
          evalW, cpl: 0, cls: 'rotation', timestamp: entry.timestamp,
        });
        state = after;
      } else if (entry.move.from && entry.move.to) {
        const after = applyMove(state, entry.move);
        const a = classifyMove(state, entry.move, after, {
          ...BUDGET,
          allowSelfCheck,
        });
        labels.push({
          i, san: entry.san, mover, isHuman, rotation: false,
          evalW: a.searchScoreFromWhite, cpl: a.cpl, cls: a.classification,
          isMate: a.isMate, timestamp: entry.timestamp,
        });
        state = after;
      }
    } catch (err) {
      process.stderr.write(`game ${g.id} move ${i} failed: ${err}\n`);
      break; // desync — keep what we have, drop the tail
    }
  }
  moveTotal += labels.length;
  out.push({
    id: g.id,
    chess960Id: g.chess960Id,
    humanColor: g.humanColor,
    outcome: g.outcome,
    gameMode: g.gameMode ?? 'classic',
    createdAt: g.createdAt,
    durationMs: g.durationMs,
    pointsTotal: g.points?.total,
    labels,
  });
  process.stderr.write(
    `[${gi + 1}/${games.length}] ${g.id} ${labels.length} moves ` +
      `(${moveTotal} total, ${((Date.now() - t0) / 1000).toFixed(0)}s)\n`,
  );
}

mkdirSync('data', { recursive: true });
writeFileSync('data/human-games-labelled.json', JSON.stringify(out));
process.stderr.write(
  `labelled ${out.length} games / ${moveTotal} moves in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`,
);
