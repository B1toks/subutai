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
 * every 30s; "online" = lastSeen within the last 70s (two beats + slack).
 * Everything here is best-effort: matchmaking must keep working (in its
 * degraded "player count unknown" form) if the rules for /presence aren't
 * deployed yet or the network drops — hence the swallowed errors. */

const HEARTBEAT_MS = 30_000;
const ONLINE_WINDOW_MS = 70_000;

let timer: number | null = null;

export function startPresenceHeartbeat(uid: string): void {
  stopPresenceHeartbeat();
  const beat = () => {
    // Skip beats from hidden tabs so an abandoned background tab doesn't
    // count as a live player for hours.
    if (document.visibilityState === 'hidden') return;
    setDoc(
      doc(db, 'presence', uid),
      { lastSeen: serverTimestamp() },
      { merge: true },
    ).catch(() => {
      /* best-effort — see module comment */
    });
  };
  beat();
  timer = window.setInterval(beat, HEARTBEAT_MS);
}

export function stopPresenceHeartbeat(): void {
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
