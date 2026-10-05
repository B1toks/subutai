// One player in a worker thread, for flows where two players act at once
// (Quick match): each worker has its own module graph, so its client-stub
// `db` stays signed in as that player for the whole flow.
import { parentPort, workerData } from 'node:worker_threads';
import { actAs } from './client-stub.mjs';

const { uid, displayName } = workerData;
actAs(uid);
const { findQuickMatch } = await import('../../src/firebase/quickMatch.ts');
const r = await findQuickMatch({ uid, displayName }).result;
parentPort.postMessage(r.kind === 'joined' ? { kind: r.kind, code: r.match.code } : r);
