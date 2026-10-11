/* Online clocks (src/utils/mpClock.ts): the state now changes only with
 * the match doc, and the faces tick on their own. Checks that the numbers
 * are the ones App computed before (its 500 ms `mpNow` formula, kept below
 * as the oracle), that a face wakes exactly when its shown second changes,
 * and that a countdown reads 00:00 only once the time is gone.
 *
 * Run: npx tsx scripts/test-mp-clock.ts
 */
import { formatClockFace, mpClockAt, mpClockHeldFor, mpClockState, msToNextSecond } from '../src/utils/mpClock';
import type { MatchDoc } from '../src/firebase/matches';
import type { Move } from '../src/engine';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) {
    failures++;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const MOVE = { kind: 'normal', from: 'a2', to: 'a3' } as Move;
type M = Pick<MatchDoc, 'log' | 'timeIncrementSec'>;
const match = (stamps: number[], inc: number | null): M => ({
  log: { initialTopology: 'A', moves: stamps.map((t) => ({ move: MOVE, timestamp: t })) } as MatchDoc['log'],
  timeIncrementSec: inc,
});

/** App's mpClocks before this change, verbatim in substance. */
function oracle(m: M, tcSec: number | null, live: boolean, now: number) {
  const moves = m.log.moves;
  const incMs = (m.timeIncrementSec ?? 0) * 1000;
  let usedWhite = 0;
  let usedBlack = 0;
  for (let i = 1; i < moves.length; i++) {
    const dt = Math.max(0, (moves[i].timestamp ?? 0) - (moves[i - 1].timestamp ?? 0));
    if (i % 2 === 0) usedWhite += dt;
    else usedBlack += dt;
  }
  if (live && moves.length > 0) {
    const l = Math.max(0, now - (moves[moves.length - 1].timestamp ?? now));
    if (moves.length % 2 === 0) usedWhite += l;
    else usedBlack += l;
  }
  if (!tcSec) return { white: usedWhite, black: usedBlack };
  const total = tcSec * 1000;
  return {
    white: Math.max(0, total + Math.ceil(moves.length / 2) * incMs - usedWhite),
    black: Math.max(0, total + Math.floor(moves.length / 2) * incMs - usedBlack),
  };
}

// 1. Same numbers as before, on random matches and moments.
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
let compared = 0;
for (let g = 0; g < 4000; g++) {
  const n = Math.floor(rnd() * 12);
  const stamps: number[] = [];
  let t = 1_700_000_000_000 + Math.floor(rnd() * 1e6);
  for (let i = 0; i < n; i++) {
    // Mostly forward, sometimes a stamp behind the previous one (skewed
    // clocks before R-1), which both versions charge as 0.
    t += Math.floor(rnd() * 90_000) - (rnd() < 0.1 ? 20_000 : 0);
    stamps.push(t);
  }
  const tc = [null, 60, 180, 300][Math.floor(rnd() * 4)];
  const inc = [null, 0, 2][Math.floor(rnd() * 3)];
  const live = rnd() < 0.8;
  const m = match(stamps, inc);
  const st = mpClockState(m, tc, live);
  for (let k = 0; k < 5; k++) {
    const now = (stamps[stamps.length - 1] ?? t) + Math.floor(rnd() * 400_000) - 30_000;
    const want = oracle(m, tc, live, now);
    for (const side of ['white', 'black'] as const) {
      compared++;
      const got = mpClockAt(st, side, now);
      if (got !== want[side]) check(`same as before g${g}`, false, `${side} ${got} vs ${want[side]} (tc ${tc}, inc ${inc}, live ${live}, n ${n})`);
    }
  }
  check(`countdown flag g${g}`, st.countdown === !!tc);
  check(`running side g${g}`, st.running === (live && n > 0 ? (n % 2 === 0 ? 'white' : 'black') : null));
}

// 2. A face wakes when its shown second changes, not before or after.
for (const roundUp of [true, false]) {
  for (let ms = 1; ms <= 5_000; ms += 7) {
    const wait = msToNextSecond(ms, roundUp);
    const show = (x: number) => formatClockFace(roundUp ? Math.max(0, x) : x, roundUp);
    const later = roundUp ? ms - wait : ms + wait;
    const justBefore = roundUp ? later + 1 : later - 1;
    check(`wake ${roundUp ? 'down' : 'up'} ${ms}`, show(later) !== show(ms) && show(justBefore) === show(ms), `wait ${wait}`);
  }
}
check('no wake at 0 on a countdown', msToNextSecond(0, true) === Infinity);

// 3. A countdown reads 00:00 only when the time is gone; elapsed rounds down.
check('00:01 at 1 ms', formatClockFace(1, true) === '00:01');
check('00:00 at 0', formatClockFace(0, true) === '00:00');
check('03:00 at the start', formatClockFace(180_000, true) === '03:00');
check('02:59 a moment in', formatClockFace(179_999, true) === '03:00' && formatClockFace(179_000, true) === '02:59');
check('elapsed floors', formatClockFace(999) === '00:00' && formatClockFace(61_500) === '01:01');
check('past 99 min', formatClockFace(100 * 60_000) === '100:00');

// 4. The flag: a running countdown reaches 0 exactly at since + what was left.
{
  const st = mpClockState(match([1000, 5000, 9000], 2), 60, true); // black to move
  const left = st.black;
  check('flag moment', mpClockAt(st, 'black', 9000 + left) === 0 && mpClockAt(st, 'black', 9000 + left - 1) === 1);
  check('waiting side frozen', mpClockAt(st, 'white', 9000) === mpClockAt(st, 'white', 9_000_000));
  const over = mpClockState(match([1000, 5000, 9000], 2), 60, false);
  check('ended match: nothing runs', over.running === null && mpClockAt(over, 'black', 9_000_000) === left);
}

// 5. A stamp ahead of this device's clock holds the running face still
//    until then; the face (and the flag check) wait that long first.
{
  const st = mpClockState(match([1000, 5000, 9000], 2), 60, true);
  check('held before since', mpClockHeldFor(st, 'black', 6000) === 3000 && mpClockAt(st, 'black', 6000) === st.black);
  check('not held after since', mpClockHeldFor(st, 'black', 9500) === 0);
  check('waiting side never held', mpClockHeldFor(st, 'white', 0) === 0);
}

console.log(`${compared} readings compared with the old formula`);
if (failures) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
console.log('ALL PASS');
