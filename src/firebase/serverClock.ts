/**
 * N-10 — this device's clock against the server's.
 *
 * A move's `timestamp` used to be the mover's Date.now(), and every screen
 * charged the running clock from it with its own Date.now(). Two devices
 * whose clocks disagree by Δ (a phone and a PC a few seconds apart is
 * ordinary) then showed the running clock Δ apart, and every move charged
 * Δ to one player and gave it to the other, on both screens: measured on
 * the emulator stand with one clock 4 s ahead, a 5 s think was charged as
 * 9 s and its reply's 5 s as 1 s.
 *
 * The rules cannot stamp a move with server time (the stamp is client
 * data, firestore.rules R-1), but every write does carry server time:
 * `lastActivity` and `turnStartedAt` must equal request.time. So each
 * client estimates offset = server time − Date.now() from what it sees:
 *
 *  - a server stamp T that arrived at local time `seenAt` was written
 *    before then, so the offset is at least T − seenAt;
 *  - my own move, stamped at local `sentAt` and seen back (with the
 *    server's T for it, or for anything later) at `seenAt`, was committed
 *    between the two, so the offset is at most T − sentAt as well.
 *
 * The bounds narrow to one round trip; the estimate is their middle, or
 * the lower bound until there is an upper one. With no sample yet it is
 * 0: the device's own clock, as before. Stamped with server time, a move
 * keeps every check the rules make (no earlier than the entry before it,
 * within 60 s of request.time) with more room than a raw clock had.
 */

/** Wall-clock change (beyond drift) that voids what was learnt. */
const JUMP_MS = 2000;

export class ServerClockEstimate {
  private lo = -Infinity;
  private hi = Infinity;
  /** Date.now() and performance.now() at the last sample: the two drift
   *  apart only when someone sets the device clock. */
  private wallAt = 0;
  private monoAt = 0;

  /** Server stamp `serverMs`, received at local `seenAt`. */
  noteSeen(serverMs: number, seenAt: number, mono: number): void {
    this.bound(serverMs - seenAt, Infinity, seenAt, mono);
  }

  /** My write, stamped at local `sentAt`, came back at local `seenAt`
   *  with server stamp `serverMs` (its own, or a later write's). */
  noteOwnWrite(serverMs: number, sentAt: number, seenAt: number, mono: number): void {
    this.bound(serverMs - seenAt, serverMs - sentAt, seenAt, mono);
  }

  /** server time − local time, in whole ms (stamps must be integers). */
  offsetMs(wall: number, mono: number): number {
    if (this.lo === -Infinity) return 0;
    if (Math.abs(wall - this.wallAt - (mono - this.monoAt)) > JUMP_MS) {
      // The device clock was set since: every bound is in the old clock.
      this.reset();
      return 0;
    }
    return Math.round(this.hi === Infinity ? this.lo : (this.lo + this.hi) / 2);
  }

  private bound(lo: number, hi: number, wall: number, mono: number): void {
    if (this.lo !== -Infinity && Math.abs(wall - this.wallAt - (mono - this.monoAt)) > JUMP_MS) {
      this.reset();
    }
    const nlo = Math.max(this.lo, lo);
    const nhi = Math.min(this.hi, hi);
    if (nlo > nhi) {
      // Contradicts the earlier samples (a clock change too small to
      // catch above): trust the new one alone.
      this.lo = lo;
      this.hi = hi;
    } else {
      this.lo = nlo;
      this.hi = nhi;
    }
    this.wallAt = wall;
    this.monoAt = mono;
  }

  private reset(): void {
    this.lo = -Infinity;
    this.hi = Infinity;
  }
}

const estimate = new ServerClockEstimate();
const mono = () => performance.now();

/** The server's time now, as best this device knows it (whole ms). */
export function serverNow(): number {
  const wall = Date.now();
  return wall + estimate.offsetMs(wall, mono());
}

export function noteServerStampSeen(serverMs: number, seenAt: number): void {
  estimate.noteSeen(serverMs, seenAt, mono());
}

export function noteOwnWriteSeen(serverMs: number, sentAt: number, seenAt: number): void {
  estimate.noteOwnWrite(serverMs, sentAt, seenAt, mono());
}

/* The first snapshot of a match is the doc as it stands, stamps of any age,
 * so on its own it says nothing about the time now. It does once I know a
 * write of mine is in it: the guest's join, stamped server-side and sent
 * after `sentAt`. Without this the first move of every match was stamped
 * by the raw clock, and the reply was charged against it. */
const joinSentAt = new Map<string, number>();

/** My join of match `code` is being written (each transaction attempt). */
export function noteJoinSent(code: string): void {
  joinSentAt.set(code, Date.now());
}

/** When my join of `code` was sent, once; undefined if I did not join it
 *  from this page. */
export function takeJoinSent(code: string): number | undefined {
  const at = joinSentAt.get(code);
  joinSentAt.delete(code);
  return at;
}
