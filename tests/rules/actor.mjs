// One player in a worker thread, for flows where two players act at once
// (Quick match): each worker has its own module graph, so its client-stub
// `db` stays signed in as that player for the whole flow. `src` (a file URL
// of a src/ directory) runs another client's Quick match, say v1.0.2's.
import { parentPort, workerData } from 'node:worker_threads';
import { actAs } from './client-stub.mjs';

const { uid, displayName, src = new URL('../../src/', import.meta.url).href } = workerData;
actAs(uid);
const { findQuickMatch } = await import(new URL('firebase/quickMatch.ts', src).href);
const r = await findQuickMatch({ uid, displayName }).result;
parentPort.postMessage(r.kind === 'joined' ? { kind: r.kind, code: r.match.code } : r);
