/* N-10: the server-clock estimate (src/firebase/serverClock.ts) that move
 * stamps and the online clocks use. Simulates a server and devices whose
 * clocks are off by anything up to ±10 min, with one-way delays up to
 * 1.5 s, and checks that:
 *   - the estimate is never worse than the bounds allow (half a round trip
 *     once the device has moved, the delivery delay before that);
 *   - once anything was learnt, a stamp taken with it always passes the
 *     rules' window (an integer, within 60 s of the commit's request.time),
 *     which the raw clock of a device more than 60 s off did not; before
 *     that it is the raw clock, as it was;
 *   - with nothing learnt it is 0 (the device's own clock, as before);
 *   - a device clock set mid-game voids what was learnt.
 *
 * Run: npx tsx scripts/test-server-clock.ts
 */
import { ServerClockEstimate } from '../src/firebase/serverClock';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) {
    failures++;
    if (failures < 20) console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

let seed = 777;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

// 1. Nothing learnt: the device's own clock.
check('no samples → 0', new ServerClockEstimate().offsetMs(1_000, 1_000) === 0);

// 2. A game between a device and the server, random skew and delays.
let worstBefore = 0;
let worstAfter = 0;
let stamps = 0;
let rawFirst = 0;
for (let g = 0; g < 3000; g++) {
  const skew = Math.round((rnd() * 2 - 1) * (rnd() < 0.5 ? 10_000 : 600_000)); // local − server
  const est = new ServerClockEstimate();
  let real = 1_700_000_000_000 + Math.floor(rnd() * 1e9); // server time
  const mono = () => real - 1_700_000_000_000 + 5_000; // performance.now(), never set
  const local = () => real + skew;
  const truth = -skew;
  let moved = false;
  let learnt = false;
  for (let step = 0; step < 30; step++) {
    real += Math.floor(rnd() * 20_000);
    if (rnd() < 0.5) {
      // Someone else's write committed at server time `real`, delivered later.
      const T = real;
      real += Math.floor(rnd() * 1500);
      est.noteSeen(T, local(), mono());
      learnt = true;
    } else {
      // My move: stamped now, committed after an up-trip, seen after a down-trip.
      const sentAt = local();
      const stamp = sentAt + est.offsetMs(sentAt, mono());
      stamps++;
      const up = Math.floor(rnd() * 1500);
      real += up;
      const T = real; // request.time of the commit
      check('stamp is an integer', Number.isInteger(stamp));
      if (learnt) {
        check('stamp within the rules window', stamp <= T + 60_000 && stamp >= T - 60_000, `skew ${skew}, stamp-T ${stamp - T}`);
      } else {
        // Nothing seen yet: the raw clock, exactly as before this change.
        check('raw clock before any sample', stamp === sentAt);
        rawFirst++;
      }
      const down = Math.floor(rnd() * 1500);
      real += down;
      est.noteOwnWrite(T, sentAt, local(), mono());
      moved = true;
      learnt = true;
      // Half a round trip at worst, once I have moved.
      const err = Math.abs(est.offsetMs(local(), mono()) - truth);
      worstAfter = Math.max(worstAfter, err);
    }
    const err = Math.abs(est.offsetMs(local(), mono()) - truth);
    if (!moved) worstBefore = Math.max(worstBefore, err);
    else check('error within one round trip once moved', err <= 1500, `err ${err}`);
  }
}
check('lower bound only: error within the delivery delay', worstBefore <= 1500, `worst ${worstBefore}`);
check('after a move: within half a round trip', worstAfter <= 1500, `worst ${worstAfter}`);

// 3. The device clock is set mid-game (Date.now jumps, performance.now
//    does not): what was learnt is dropped, back to the raw clock.
{
  const est = new ServerClockEstimate();
  est.noteSeen(10_000, 5_000, 100); // offset ≥ 5000
  check('learnt', est.offsetMs(5_000, 100) === 5000);
  // 30 s later by the monotonic clock, but the wall clock moved 90 s.
  check('jump voids the estimate', est.offsetMs(95_000, 30_100) === 0);
  // And it learns again from the next stamp.
  est.noteSeen(130_000, 95_500, 30_600);
  check('relearns after the jump', est.offsetMs(95_500, 30_600) === 34_500);
}

// 4. Contradicting samples (a clock change too small to catch) restart
//    from the newest one instead of keeping an empty interval.
{
  const est = new ServerClockEstimate();
  est.noteOwnWrite(10_000, 9_000, 9_200, 0); // offset in [800, 1000]
  est.noteOwnWrite(20_000, 19_900, 19_950, 10_750); // in [50, 100]: contradicts
  const o = est.offsetMs(19_950, 10_750);
  check('newest sample wins a contradiction', o >= 50 && o <= 100, `got ${o}`);
}

// 5. The middle of the bounds, in whole ms.
{
  const est = new ServerClockEstimate();
  est.noteOwnWrite(10_000, 8_999, 9_200, 0); // [800, 1001]
  check('midpoint, rounded', est.offsetMs(9_200, 0) === 901, `got ${est.offsetMs(9_200, 0)}`);
}

console.log(`${stamps} move stamps: ${stamps - rawFirst} checked against the rules window, ${rawFirst} taken before any sample (raw clock)`);
console.log(`worst error: ${worstBefore} ms before the first own move, ${worstAfter} ms after`);
if (failures) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
console.log('ALL PASS');
