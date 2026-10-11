/* fix/v1.1.4: the stale-chunk reload (src/utils/chunkReload.ts). Checks
 * that each engine's wording of a failed dynamic import is recognised and
 * ordinary errors are not, that a reload is allowed once and then not
 * again within the window, and that without working session storage it is
 * never tried (it could not tell a first failure from a loop).
 *
 * Run: npx tsx scripts/test-chunk-reload.ts
 */
import {
  CHUNK_RELOAD_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  canAutoReload,
  isChunkLoadError,
  markAutoReload,
} from '../src/utils/chunkReload';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) {
    failures++;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const chunk = [
  new TypeError('Failed to fetch dynamically imported module: https://x.dev/assets/FriendLobby-abc.js'),
  new TypeError('error loading dynamically imported module: https://x.dev/assets/GameReview-abc.js'),
  new TypeError('Importing a module script failed.'),
  new Error('Unable to preload CSS for /assets/Leaderboard-abc.css'),
  Object.assign(new Error('Loading chunk 42 failed.'), { name: 'ChunkLoadError' }),
  new TypeError("'text/html' is not a valid JavaScript MIME type."),
];
for (const e of chunk) check(`chunk: ${e.message}`, isChunkLoadError(e));
const other = [
  new TypeError("Cannot read properties of undefined (reading 'moves')"),
  new Error('Minified React error #310'),
  'Failed to fetch dynamically imported module', // a bare string is not an Error object
  null,
  undefined,
  42,
  { message: 42 },
];
for (const e of other) check(`not chunk: ${String(e)}`, !isChunkLoadError(e));

class MemStore {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

const t0 = 1_800_000_000_000;
const s = new MemStore();
check('first failure may reload', canAutoReload(t0, s));
check('attempt recorded', markAutoReload(t0, s) && s.getItem(CHUNK_RELOAD_KEY) === String(t0));
check('second failure right after: no reload', !canAutoReload(t0 + 2_000, s));
check('still inside the window', !canAutoReload(t0 + CHUNK_RELOAD_WINDOW_MS - 1, s));
check('after the window: may reload again', canAutoReload(t0 + CHUNK_RELOAD_WINDOW_MS, s));
const junk = new MemStore();
junk.setItem(CHUNK_RELOAD_KEY, 'garbage');
check('garbage flag ignored', canAutoReload(t0, junk));
const future = new MemStore();
future.setItem(CHUNK_RELOAD_KEY, String(t0 + 10_000));
check('flag from a clock set back ignored', canAutoReload(t0, future));
check('no storage: never', !canAutoReload(t0, null) && !markAutoReload(t0, null));
const throwing = {
  getItem(): string | null {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};
check('throwing storage: never', !canAutoReload(t0, throwing) && !markAutoReload(t0, throwing));
const dropping = { getItem: () => null, setItem: () => {} };
check('storage that does not keep the flag: no reload', !markAutoReload(t0, dropping));

if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
console.log('ALL PASS');
