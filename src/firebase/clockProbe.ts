import { doc, getDocFromServer, type Timestamp } from 'firebase/firestore';
import { db } from './client';
import { presenceWriteCount, writePresence } from './presence';
import { noteOwnWriteSeen } from './serverClock';
import { takeProbeSlot } from '../utils/probeBudget';

/**
 * fix/v1.1.4 — active probes of the server clock while a match is live.
 *
 * serverClock.ts learns the offset from the match doc: a seen stamp gives
 * a lower bound, my own move both bounds. Until a player's first own move
 * the estimate was one-sided (or empty), and the two screens changed the
 * clock's second up to a whole device skew apart. A probe is my presence
 * doc's lastSeen = serverTimestamp() (the one write the rules already
 * allow there), sent at `sentAt` and acknowledged at `ackAt`; reading the
 * doc back from the server gives its stamp T, so
 * T − ackAt <= offset <= T − sentAt: both bounds, one round trip wide.
 *
 * Cost (Firestore free quota: 20,000 writes and 50,000 reads a day): one
 * write and one read per probe. A burst of 3 when the match goes live,
 * then one every 5 minutes, and one when the tab comes back after 30 s or
 * more (a sleeping phone can void the estimate, see serverClock.ts). A
 * hard cap of 20 probes per 30 minutes per tab bounds the worst case; a
 * typical 30-minute match costs about 9 writes and 9 reads per player.
 */

const BURST_MS = [400, 2500, 6000];
const EVERY_MS = 5 * 60_000;
const VISIBLE_GAP_MS = 30_000;

/** Probe times (monotonic ms) of this tab, across matches. */
const recent: number[] = [];

/** One probe; true when it gave a sample. */
async function probeOnce(uid: string): Promise<boolean> {
  const before = presenceWriteCount();
  const sentAt = Date.now();
  await writePresence(uid);
  const ackAt = Date.now();
  const snap = await getDocFromServer(doc(db, 'presence', uid));
  // A heartbeat of this tab wrote in between: T may be its stamp, later
  // than my ack, which would void the lower bound. Drop the sample.
  if (presenceWriteCount() !== before + 1) return false;
  const t = (snap.get('lastSeen') as Timestamp | undefined)?.toMillis?.();
  if (typeof t !== 'number') return false;
  noteOwnWriteSeen(t, sentAt, ackAt);
  return true;
}

/** Probes for as long as the returned stop function is not called. */
export function startClockProbes(uid: string): () => void {
  const mono = () => performance.now();
  let stopped = false;
  let inFlight = false;
  let last = -Infinity;
  const run = () => {
    if (stopped || inFlight || document.visibilityState === 'hidden') return;
    const now = mono();
    if (!takeProbeSlot(recent, now)) return;
    inFlight = true;
    last = now;
    probeOnce(uid)
      .catch(() => false) // best-effort, like the heartbeat
      .finally(() => {
        inFlight = false;
      });
  };
  const timers = BURST_MS.map((ms) => window.setTimeout(run, ms));
  const interval = window.setInterval(run, EVERY_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible' && mono() - last >= VISIBLE_GAP_MS) run();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopped = true;
    timers.forEach((id) => window.clearTimeout(id));
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
