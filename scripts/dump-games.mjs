// R15 step 0: dump the /games collection to a local JSON file for offline
// analysis. Reads go through the public client SDK (rules allow read: true),
// paginated by createdAt so a mid-dump failure can resume cheaply.
//
// Usage: node scripts/dump-games.mjs [outFile]
//   outFile defaults to data/games-dump.json

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { initializeApp } from 'firebase/app';
import {
  collection,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  startAfter,
  terminate,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAbqverdzFCHOpJeoN8WI3_5CWUNWV6mhk',
  authDomain: 'subutai-chess.firebaseapp.com',
  projectId: 'subutai-chess',
};

const PAGE_SIZE = 500;
const outFile = resolve(process.argv[2] ?? 'data/games-dump.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/** Firestore Timestamp -> epoch ms, leaving plain values untouched. */
function plain(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(plain);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = plain(v);
  return out;
}

const games = [];
let cursor = null;
for (;;) {
  const base = collection(db, 'games');
  const q = cursor
    ? query(base, orderBy('createdAt'), startAfter(cursor), limit(PAGE_SIZE))
    : query(base, orderBy('createdAt'), limit(PAGE_SIZE));
  const snap = await getDocs(q);
  for (const doc of snap.docs) games.push({ id: doc.id, ...plain(doc.data()) });
  process.stderr.write(`fetched ${games.length} games\n`);
  if (snap.docs.length < PAGE_SIZE) break;
  cursor = snap.docs[snap.docs.length - 1];
}

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(games));
process.stderr.write(`wrote ${games.length} games to ${outFile}\n`);
await terminate(db);
process.exit(0);
