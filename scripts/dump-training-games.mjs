// R15 step 0 (part 2): count every game-bearing collection, then dump
// /training_games (read requires auth — the app's own anonymous sign-in
// suffices). Output mirrors dump-games.mjs.
//
// Usage: node scripts/dump-training-games.mjs [collection] [outFile]
//   defaults: training_games -> data/training-games-dump.json

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  collection,
  getCountFromServer,
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

const PAGE_SIZE = 300;
const coll = process.argv[2] ?? 'training_games';
const outFile = resolve(
  process.argv[3] ?? `data/${coll.replaceAll('_', '-')}-dump.json`,
);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

for (const name of ['games', 'training_games', 'matches']) {
  const c = await getCountFromServer(collection(db, name));
  process.stderr.write(`count ${name}: ${c.data().count}\n`);
}

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
  const base = collection(db, coll);
  const q = cursor
    ? query(base, orderBy('createdAt'), startAfter(cursor), limit(PAGE_SIZE))
    : query(base, orderBy('createdAt'), limit(PAGE_SIZE));
  const snap = await getDocs(q);
  for (const doc of snap.docs) games.push({ id: doc.id, ...plain(doc.data()) });
  process.stderr.write(`fetched ${games.length} docs\n`);
  if (snap.docs.length < PAGE_SIZE) break;
  cursor = snap.docs[snap.docs.length - 1];
}

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(games));
process.stderr.write(`wrote ${games.length} docs to ${outFile}\n`);
await terminate(db);
process.exit(0);
