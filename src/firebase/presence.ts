import {
  Timestamp,
  collection,
  doc,
  getCountFromServer,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from './client';

/* R16 — presence heartbeat. One tiny doc per signed-in visitor, refreshed
 * every 2 minutes; "online" = lastSeen within the last 270s (two beats + slack).
 * Everything here is best-effort: matchmaking must keep working (in its
 * degraded "player count unknown" form) if the rules for /presence aren't
 * deployed yet or the network drops — hence the swallowed errors.
 *
 * The beat is the largest single source of Firestore writes, and the free
 * quota is 20,000 writes a day, so the interval is deliberately long. */

const HEARTBEAT_MS = 120_000;
const ONLINE_WINDOW_MS = 270_000;
// A tab that becomes visible again beats at once, unless it just did.
const MIN_GAP_MS = 30_000;

let timer: number | null = null;
/** fix/v1.1.4 — counts this tab's presence writes, so a clock probe
 *  (clockProbe.ts) can tell that a heartbeat wrote between its write and
 *  its read, and drop the sample. */
let presenceWrites = 0;

export function presenceWriteCount(): number {
  return presenceWrites;
}

/** A presence write of this tab's (counted, see above). */
export function writePresence(uid: string): Promise<void> {
  presenceWrites++;
  return setDoc(doc(db, 'presence', uid), { lastSeen: serverTimestamp() }, { merge: true });
}
let removeVisibilityListener: (() => void) | null = null;

export function startPresenceHeartbeat(uid: string): void {
  stopPresenceHeartbeat();
  let lastBeat = 0;
  const beat = () => {
    // Skip beats from hidden tabs so an abandoned background tab doesn't
    // count as a live player for hours.
    if (document.visibilityState === 'hidden') return;
    lastBeat = Date.now();
    writePresence(uid).catch(() => {
      /* best-effort — see module comment */
    });
  };
  const onVisible = () => {
    if (Date.now() - lastBeat >= MIN_GAP_MS) beat();
  };
  document.addEventListener('visibilitychange', onVisible);
  removeVisibilityListener = () => document.removeEventListener('visibilitychange', onVisible);
  beat();
  timer = window.setInterval(beat, HEARTBEAT_MS);
}

export function stopPresenceHeartbeat(): void {
  removeVisibilityListener?.();
  removeVisibilityListener = null;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** Players seen in the last ~minute. null = unknown (rules not deployed /
 *  offline) — callers should hide the counter rather than show 0. */
export async function getOnlineCount(): Promise<number | null> {
  try {
    const cutoff = Timestamp.fromMillis(Date.now() - ONLINE_WINDOW_MS);
    const q = query(collection(db, 'presence'), where('lastSeen', '>', cutoff));
    const snap = await getCountFromServer(q);
    return snap.data().count;
  } catch {
    return null;
  }
}
