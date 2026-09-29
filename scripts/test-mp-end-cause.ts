/* QA-04 / N-4 verification: how an Online match that ended with
 * 'host-resign' / 'guest-resign' is told apart — a real resignation, a flag
 * fall, or an inactivity forfeit (the match doc cannot say; the clock has
 * to). The end text is chosen from mpResignCause.
 *
 * Run: npx tsx scripts/test-mp-end-cause.ts
 */
import { inactivityForfeitApplies, mpResignCause } from '../src/firebase/matchEnd';
import type { MatchDoc } from '../src/firebase/matches';
import type { Move } from '../src/engine';

const MOVE = { kind: 'normal', from: 'a2', to: 'a3' } as Move;

function match(over: Partial<MatchDoc> & { stamps: number[]; end: number | null }): MatchDoc {
  const { stamps, end, ...rest } = over;
  return {
    code: 'TEST',
    chess960Id: 'RNBQKBNR',
    seed: 1,
    host: { uid: 'h', displayName: 'H', color: 'white' },
    guest: { uid: 'g', displayName: 'G', color: 'black' },
    status: 'finished',
    currentTurn: 'h',
    log: { initialTopology: 'A', moves: stamps.map((t) => ({ move: MOVE, timestamp: t })) },
    outcome: 'guest-resign',
    createdAt: null as unknown as MatchDoc['createdAt'],
    lastActivity: (end === null ? null : { toMillis: () => end }) as unknown as MatchDoc['lastActivity'],
    timeControlSec: 180,
    timeIncrementSec: 2,
    ...rest,
  } as MatchDoc;
}

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${String(actual)}, want ${String(expected)}`);
}

const S = 1000;
// White, Black, White played; Black (the guest) is to move, having spent
// 5 s on move 1 and then thinking since t=6 s.
const three = [0, 5 * S, 6 * S];

// --- Timed ------------------------------------------------------------
check('3+2: black flags (clock at 0)', mpResignCause(match({ stamps: three, end: 6 * S + 177 * S })), 'timeout');
check('3+2: black flags, stamped 1.4 s late', mpResignCause(match({ stamps: three, end: 6 * S + 178.4 * S })), 'timeout');
check('3+2: black resigns with plenty left', mpResignCause(match({ stamps: three, end: 16 * S })), 'resign');
check('3+2: black resigns with 40 s left', mpResignCause(match({ stamps: three, end: 6 * S + 137 * S })), 'resign');
check('3+2: black thinks 100 s and is forfeited (clock still runs)', mpResignCause(match({ stamps: three, end: 6 * S + 100 * S })), 'resign');

// White (host) to move after two entries: white flags.
const two = [0, 2 * S];
check('3+2: white flags', mpResignCause(match({ outcome: 'host-resign', stamps: two, end: 2 * S + 182 * S })), 'timeout');
check('3+2: white resigns early', mpResignCause(match({ outcome: 'host-resign', stamps: two, end: 30 * S })), 'resign');

// The loser resigning on the OPPONENT's turn: their own clock is not running.
const four = [0, 5 * S, 6 * S, 7 * S]; // white to move again
check('3+2: black resigns on white\'s turn (black idle for minutes)', mpResignCause(match({ stamps: four, end: 7 * S + 900 * S })), 'resign');

// A write still in flight has no server stamp; it is happening right now.
const now = Date.now();
check('pending write, plenty left', mpResignCause(match({ stamps: [now - 20 * S, now - 15 * S, now - 14 * S], end: null })), 'resign');
check('pending write, clock at 0', mpResignCause(match({ stamps: [now - 190 * S, now - 185 * S, now - 184 * S], end: null })), 'timeout');

// --- Not decidable / not applicable ------------------------------------
check('untimed', mpResignCause(match({ stamps: three, end: 90 * S, timeControlSec: null })), 'unknown');
check('timed but White never moved', mpResignCause(match({ stamps: [], end: 90 * S })), 'unknown');
check('roulette (no clock)', mpResignCause(match({ stamps: three, end: 90 * S, gameMode: 'roulette' })), 'unknown');
check('checkmate is not a resignation', mpResignCause(match({ stamps: three, end: 90 * S, outcome: 'white-win' })), 'unknown');

// --- The forfeit guard --------------------------------------------------
check('forfeit applies: untimed', inactivityForfeitApplies(match({ stamps: three, end: 0, timeControlSec: null })), true);
check('forfeit applies: timed, before the first move', inactivityForfeitApplies(match({ stamps: [], end: 0 })), true);
check('forfeit off: timed, clock running', inactivityForfeitApplies(match({ stamps: three, end: 0 })), false);
check('forfeit applies: roulette even with a control', inactivityForfeitApplies(match({ stamps: three, end: 0, gameMode: 'roulette' })), true);

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nALL PASS');
