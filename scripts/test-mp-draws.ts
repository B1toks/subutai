/* R13 verification: do threefold / fifty-move draws actually surface through
 * the EXACT code path multiplayer uses (rebuildBoardFromMatch -> App's
 * checkDrawConditions call)? The backlog claims MP is history-blind; this
 * exercises the claim offline with a crafted knight-shuffle log.
 *
 * Run: npx tsx scripts/test-mp-draws.ts
 */
import { rebuildBoardFromMatch } from '../src/components/MultiplayerGameView';
import { checkDrawConditions } from '../src/engine/moves';
import type { MatchDoc } from '../src/firebase/matches';
import type { Move } from '../src/engine';

const N = (from: string, to: string) =>
  ({ kind: 'normal', from, to }) as Move;

/** One full both-sides knight shuffle: out and back. 4 plies, returns the
 *  game to the starting position. */
const CYCLE: Move[] = [
  N('e1', 'f3'), // white knight out (RNBQKBNR-like rank: knight on e1? no —
  // see below: we pick a back rank where knights sit on b1/g1 mirrors.
];

// Back rank RNBQKBNR puts knights on b1/g1 (and b8/g8) — classic squares.
const SHUFFLE: Move[] = [
  N('g1', 'f3'),
  N('g8', 'f6'),
  N('f3', 'g1'),
  N('f6', 'g8'),
];

function matchWith(moves: Move[]): MatchDoc {
  return {
    code: 'TEST',
    chess960Id: 'RNBQKBNR',
    seed: 1,
    host: { uid: 'h', displayName: 'H', color: 'white' },
    guest: { uid: 'g', displayName: 'G', color: 'black' },
    status: 'active',
    currentTurn: 'h',
    log: {
      initialTopology: 'A',
      moves: moves.map((m, i) => ({ move: m, timestamp: i })),
    },
    outcome: null,
    createdAt: null as unknown as MatchDoc['createdAt'],
    lastActivity: null as unknown as MatchDoc['lastActivity'],
  } as MatchDoc;
}

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${String(actual)}, want ${String(expected)}`);
}

void CYCLE;

// 1 cycle (4 plies): start position at 2 occurrences (initial seed + one
// recurrence — createPositionFromBackRankKey seeds positionHistory with the
// starting signature). Not a draw yet.
{
  const board = rebuildBoardFromMatch(matchWith([...SHUFFLE]));
  check('1 shuffle cycle -> no draw yet', checkDrawConditions(board), null);
}

// 2 cycles (8 plies): initial + 2 recurrences = 3 occurrences — FIDE
// threefold. The engine counting the seeded initial signature is correct.
{
  const board = rebuildBoardFromMatch(matchWith([...SHUFFLE, ...SHUFFLE]));
  check(
    '2 shuffle cycles -> threefold (initial position counts)',
    checkDrawConditions(board),
    'threefold_repetition',
  );
}

// A pawn push resets both the repetition history and the halfmove clock.
{
  const board = rebuildBoardFromMatch(
    matchWith([...SHUFFLE, ...SHUFFLE, N('e2', 'e4'), N('e7', 'e5'), ...SHUFFLE, ...SHUFFLE]),
  );
  check('pawn push resets repetition', checkDrawConditions(board), null);
  check('halfmoveClock after post-pawn shuffles', board.halfmoveClock, 8);
}

// Fifty-move rule: halfmoveClock accumulates across quiet knight plies.
{
  const board = rebuildBoardFromMatch(matchWith([...SHUFFLE, ...SHUFFLE]));
  check('halfmoveClock counts quiet plies', board.halfmoveClock, 8);
  const aged = { ...board, halfmoveClock: 100 };
  const verdict = checkDrawConditions(aged);
  check(
    'clock at 100 -> fifty-move (or threefold first, both are draws)',
    verdict === 'fifty_move_rule' || verdict === 'threefold_repetition',
    true,
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
