import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { db } from './client';
import {
  buildMatchDocPayload,
  generateMatchCode,
  joinMatch,
  type MatchDoc,
} from './matches';

/* R16 — quick match v1 (serverless matchmaking over /mm_queue).
 *
 * Protocol (two roles, decided by what we find in the queue):
 *   CLAIMER — someone is already waiting: one transaction atomically
 *     (a) re-checks their queue entry is still unclaimed, (b) creates a
 *     fresh waiting match with me as host, (c) stamps their entry with the
 *     match code. No orphan matches: if the claim races and loses, nothing
 *     was written. The claimer then waits in the normal hosted-lobby flow.
 *   WAITER — queue is empty: write my own entry and listen to it. When a
 *     claimer stamps it, join their match as guest. 30s without a claim →
 *     remove the entry and report timeout so the UI can offer the honest
 *     fallbacks (bot with the same UI / friend link).
 *
 * Stale entries (crashed tabs) are ignored by freshness window and are
 * overwritable only by their owner; rules restrict a foreign update to
 * exactly the {matchCode, claimedBy} stamp on an unclaimed entry.
 *
 * Everything degrades gracefully: if /mm_queue rules aren't deployed yet
 * every path reports 'unavailable' instead of throwing. */

const QUEUE_TIMEOUT_MS = 30_000;
const ENTRY_FRESH_MS = 60_000;

interface QueueEntry {
  uid: string;
  displayName: string;
  matchCode: string | null;
  claimedBy?: string;
  createdAt: Timestamp | null;
}

export type QuickMatchResult =
  /** I claimed a waiter and now HOST the created match — show the hosted
   *  lobby; the waiter joins momentarily. */
  | { kind: 'hosting'; code: string }
  /** I waited, got claimed and joined — the match is live. */
  | { kind: 'joined'; match: MatchDoc }
  | { kind: 'timeout' }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' };

export interface QuickMatchHandle {
  result: Promise<QuickMatchResult>;
  /** Withdraw from the queue (waiter role only; a claim already in flight
   *  wins the race and turns this into a no-op). */
  cancel: () => void;
}

export function findQuickMatch(me: {
  uid: string;
  displayName: string;
}): QuickMatchHandle {
  let cancelled = false;
  let cancelFn = () => {
    cancelled = true;
  };

  const result = (async (): Promise<QuickMatchResult> => {
    // 1. Look for someone already waiting. No composite index needed:
    //    order by createdAt only, filter client-side.
    let candidates: QueueEntry[];
    try {
      const snap = await getDocs(
        query(collection(db, 'mm_queue'), orderBy('createdAt'), limit(10)),
      );
      candidates = snap.docs.map((d) => d.data() as QueueEntry);
    } catch (err) {
      return isPermissionDenied(err) ? { kind: 'unavailable' } : rethrow(err);
    }

    const now = Date.now();
    for (const entry of candidates) {
      if (cancelled) return { kind: 'cancelled' };
      if (entry.uid === me.uid || entry.matchCode !== null) continue;
      const born = entry.createdAt?.toMillis?.();
      if (typeof born !== 'number' || now - born > ENTRY_FRESH_MS) continue;

      const claimedCode = await tryClaim(me, entry.uid);
      if (claimedCode === 'unavailable') return { kind: 'unavailable' };
      if (claimedCode) return { kind: 'hosting', code: claimedCode };
      // claim lost a race — try the next candidate
    }

    // 2. Nobody to claim — become the waiter.
    return waitInQueue(me, () => cancelled, (fn) => {
      cancelFn = fn;
    });
  })();

  return {
    result,
    cancel: () => cancelFn(),
  };
}

/** One atomic claim: verify entry unclaimed → create match → stamp entry.
 *  Returns the match code, null when the race was lost, 'unavailable' on
 *  permission-denied. */
async function tryClaim(
  me: { uid: string; displayName: string },
  waiterUid: string,
): Promise<string | null | 'unavailable'> {
  // Pick a collision-free code OUTSIDE the transaction (reads there are
  // limited); collision odds are negligible, the existence check is belt
  // and braces.
  const code = generateMatchCode();
  try {
    const existing = await getDoc(doc(db, 'matches', code));
    if (existing.exists()) return null; // try again via next candidate

    let won = false;
    await runTransaction(db, async (tx) => {
      const entryRef = doc(db, 'mm_queue', waiterUid);
      const snap = await tx.get(entryRef);
      if (!snap.exists()) return;
      const entry = snap.data() as QueueEntry;
      if (entry.matchCode !== null) return; // someone beat us to it
      tx.set(doc(db, 'matches', code), buildMatchDocPayload(me, code));
      tx.update(entryRef, { matchCode: code, claimedBy: me.uid });
      won = true;
    });
    return won ? code : null;
  } catch (err) {
    if (isPermissionDenied(err)) return 'unavailable';
    console.error('[qm] claim failed', err);
    return null;
  }
}

async function waitInQueue(
  me: { uid: string; displayName: string },
  isCancelled: () => boolean,
  registerCancel: (fn: () => void) => void,
): Promise<QuickMatchResult> {
  const myRef = doc(db, 'mm_queue', me.uid);
  try {
    await setDoc(myRef, {
      uid: me.uid,
      displayName: me.displayName,
      matchCode: null,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    return isPermissionDenied(err) ? { kind: 'unavailable' } : rethrow(err);
  }
  if (isCancelled()) {
    await deleteDoc(myRef).catch(() => {});
    return { kind: 'cancelled' };
  }

  return new Promise<QuickMatchResult>((resolve) => {
    let settled = false;
    const settle = (r: QuickMatchResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      // The entry served its purpose either way.
      deleteDoc(myRef).catch(() => {});
      resolve(r);
    };

    const timer = setTimeout(() => settle({ kind: 'timeout' }), QUEUE_TIMEOUT_MS);
    registerCancel(() => settle({ kind: 'cancelled' }));

    const unsub = onSnapshot(myRef, (snap) => {
      const code = (snap.data() as QueueEntry | undefined)?.matchCode;
      if (!code) return;
      joinMatch(code, me)
        .then((match) => settle({ kind: 'joined', match }))
        .catch((err) => {
          console.error('[qm] join after claim failed', err);
          settle({ kind: 'timeout' });
        });
    });
  });
}

function isPermissionDenied(err: unknown): boolean {
  return err instanceof FirebaseError && err.code === 'permission-denied';
}

function rethrow(err: unknown): never {
  throw err;
}
