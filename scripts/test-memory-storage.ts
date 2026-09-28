/* QA-07: a damaged Memory entry must be dropped on read instead of reaching
 * GameCard (which iterates game.moves and blanked the whole app).
 *
 * Run: npx tsx scripts/test-memory-storage.ts
 */
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

const { localStorageAdapter } = await import('../src/memory/storage');

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const good = {
  id: 'good',
  createdAt: '2026-09-28T10:00:00.000Z',
  config960: 'RNBQKBNR',
  status: 'incomplete',
  moveCount: 1,
  moves: [{ move: { kind: 'normal', from: 'e2', to: 'e4' }, topology: 'A' }],
  movesInA: 1,
  movesInB: 0,
  scoreHistory: [0, 0],
  notation: '[Chess960 "RNBQKBNR"]\n\n1. e2→e4',
};

const broken: unknown[] = [
  { id: 'x' }, // the report's repro
  null,
  'text',
  { ...good, id: 'no-moves', moves: undefined },
  { ...good, id: 'moves-not-array', moves: 'e2e4' },
  { ...good, id: 'bad-move', moves: [{ move: null }] },
  { ...good, id: 'bad-config', config960: 'ZZZZZZZZ' },
  { ...good, id: 'no-score', scoreHistory: undefined },
  { ...good, id: 'bad-status', status: 'paused' },
];

async function ids(): Promise<string[]> {
  return (await localStorageAdapter.loadGames()).map((g) => g.id);
}

store.set('subutai-games', JSON.stringify([good, ...broken]));
check('broken records are dropped, the valid one survives', await ids(), ['good']);

store.set('subutai-games', JSON.stringify({ not: 'an array' }));
check('non-array payload reads as empty', await ids(), []);

store.set('subutai-games', '{truncated');
check('truncated JSON reads as empty', await ids(), []);

const legacy = { ...good, id: 'legacy' } as Record<string, unknown>;
delete legacy.status;
store.set('subutai-games', JSON.stringify([legacy]));
const [loadedLegacy] = await localStorageAdapter.loadGames();
check('pre-status records still load as complete', loadedLegacy?.status, 'complete');

store.set('subutai-games', JSON.stringify([{ id: 'x' }, good]));
await localStorageAdapter.saveOrUpdateGame!({ ...good, id: 'second' } as never);
check(
  'a save rewrites storage without the broken record',
  (JSON.parse(store.get('subutai-games')!) as { id: string }[]).map((g) => g.id),
  ['good', 'second'],
);

const storage = await import('../src/memory/storage');
store.set('subutai_theme', 'neon');
store.set('subutai-games', JSON.stringify([good]));
(storage as { clearMemoryStorage?: () => void }).clearMemoryStorage?.();
check('reset clears Memory', store.has('subutai-games'), false);
check('reset leaves other keys', store.get('subutai_theme'), 'neon');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
if (failures) process.exitCode = 1;
