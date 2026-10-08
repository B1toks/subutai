// Stands in for src/firebase/client.ts in the rules tests (see loader.mjs).
// `db` is a live binding: actAs(uid) points it at a Firestore signed in as
// that uid on the emulator, so the app's own functions write as that player.
// firestoreFor(uid) gives that Firestore without switching `db` (raw writes
// in the tests); uid 'owner' bypasses the rules, for seeding and reading.
import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore, terminate } from 'firebase/firestore';

const hostPort = process.env.FIRESTORE_EMULATOR_HOST;
if (!hostPort) throw new Error('FIRESTORE_EMULATOR_HOST is not set: run through `npm run test:rules`');
const [host, port] = hostPort.split(':');
export const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-subutai';
if (!PROJECT_ID.startsWith('demo-')) throw new Error(`refusing a non-demo project: ${PROJECT_ID}`);

const byUid = new Map();

export let db = null;
export const app = null;
export const auth = { currentUser: null };

export function firestoreFor(uid) {
  let fs = byUid.get(uid);
  if (!fs) {
    const a = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-key' }, `as-${uid}`);
    fs = getFirestore(a);
    connectFirestoreEmulator(fs, host, Number(port), {
      mockUserToken: uid === 'owner' ? 'owner' : { sub: uid, user_id: uid },
    });
    byUid.set(uid, fs);
  }
  return fs;
}

export function actAs(uid) {
  db = firestoreFor(uid);
  auth.currentUser = uid === 'owner' ? null : { uid };
  return db;
}

export async function terminateAll() {
  await Promise.all([...byUid.values()].map((fs) => terminate(fs)));
  byUid.clear();
}
