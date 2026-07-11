// R15 step 0 (part 3): offline inventory over the local dumps — which fields
// are actually filled, in how many docs. Reads data/*.json produced by the
// dump scripts; no Firestore traffic.
//
// Usage: node scripts/inventory-games.mjs

import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');

function tally(items) {
  const m = new Map();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function moveStats(games) {
  const counts = games.map((g) => g.log?.moves?.length ?? 0).sort((a, b) => a - b);
  const q = (p) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))];
  return { min: counts[0], p50: q(0.5), p90: q(0.9), max: counts.at(-1) };
}

function report(name, file, games) {
  const n = games.length;
  const sizeMb = (statSync(file).size / 1024 / 1024).toFixed(1);
  console.log(`\n=== ${name} — ${n} docs, ${sizeMb} MB (${file}) ===`);
  if (!n) return;

  const created = games.map((g) => g.createdAt).filter(Boolean);
  console.log(`createdAt: ${pct(created.length, n)} filled, range ${day(Math.min(...created))} .. ${day(Math.max(...created))}`);

  const withLog = games.filter((g) => g.log?.moves?.length);
  console.log(`log.moves: ${pct(withLog.length, n)} non-empty; length ${JSON.stringify(moveStats(withLog))}`);

  const allMoves = withLog.flatMap((g) => g.log.moves);
  for (const field of ['san', 'timestamp', 'topology', 'searchScore']) {
    const have = allMoves.filter((m) => m[field] !== undefined && m[field] !== null).length;
    console.log(`  move.${field}: ${pct(have, allMoves.length)} of ${allMoves.length} moves`);
  }
  const gamesFullScore = withLog.filter((g) =>
    g.log.moves.every((m) => typeof m.searchScore === 'number'),
  ).length;
  console.log(`  games with searchScore on EVERY move: ${gamesFullScore} (${pct(gamesFullScore, withLog.length)})`);

  for (const field of ['outcome', 'gameMode', 'aiVersion', 'humanColor']) {
    const vals = games.map((g) => g[field] ?? '(absent)');
    console.log(`${field}: ${tally(vals).map(([v, c]) => `${v}=${c}`).join('  ')}`);
  }
  for (const field of ['durationMs', 'points', 'finalEvalFromWhite', 'playerId', 'chess960Id', 'seed']) {
    const have = games.filter((g) => g[field] !== undefined).length;
    console.log(`${field}: ${pct(have, n)} filled`);
  }
  if (games.some((g) => g.playerId)) {
    console.log(`distinct players: ${new Set(games.map((g) => g.playerId)).size}`);
  }
}

const gamesDump = JSON.parse(await readFile('data/games-dump.json', 'utf8'));
const trainingDump = JSON.parse(await readFile('data/training-games-dump.json', 'utf8'));
report('/games (human vs AI)', 'data/games-dump.json', gamesDump);
report('/training_games (bot self-play)', 'data/training-games-dump.json', trainingDump);

try {
  const matches = JSON.parse(await readFile('data/matches-dump.json', 'utf8'));
  console.log(`\n=== /matches (multiplayer) — ${matches.length} docs ===`);
  console.log(`status: ${tally(matches.map((m) => m.status ?? '(absent)')).map(([v, c]) => `${v}=${c}`).join('  ')}`);
  const withMoves = matches.filter((m) => (m.moves?.length ?? m.log?.moves?.length ?? 0) > 0);
  console.log(`docs with a move list: ${withMoves.length}`);
  const sample = matches[0] ? Object.keys(matches[0]).join(', ') : '';
  console.log(`top-level fields: ${sample}`);
} catch {
  console.log('\n(no matches dump — skipped)');
}
