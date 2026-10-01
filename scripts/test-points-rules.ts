/* QA-03: every points object the app computes must pass the deployed
 * /games rule (firestore.rules → plausiblePoints), or the save is refused
 * with permission-denied. The rule's key clause:
 *     counted == false || moveCount >= 10
 * Roulette used to mark every game counted, so any roulette game shorter
 * than 10 moves (a quick resign, the fastest wins) could not be saved.
 *
 * Run: npx tsx scripts/test-points-rules.ts
 */
import { computeGamePoints, type GameOutcome, type GamePoints } from '../src/analysis/points';
import { createStartingPosition } from '../src/engine';
import { applyMove, generateLegalMoves } from '../src/engine/moves';
import { appendMove, createGameLog, type GameLog } from '../src/recording/log';

/** firestore.rules plausiblePoints(p, moveCount), transcribed. */
function plausiblePoints(p: GamePoints, moveCount: number): boolean {
  const intIn = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
  return (
    Number.isInteger(p.total) && p.total >= 0 &&
    Number.isInteger(p.moveCount) &&
    typeof p.counted === 'boolean' &&
    intIn(p.movePoints, 0, 1500) &&
    intIn(p.capturePoints, 0, 400) &&
    intIn(p.qualityPoints, 0, moveCount * 10 + 10) &&
    intIn(p.rotationPoints, 0, 600) &&
    intIn(p.outcomeBonus, 0, 500) &&
    p.total <= p.movePoints + p.capturePoints + p.qualityPoints + p.rotationPoints + p.outcomeBonus &&
    (p.counted === false || moveCount >= 10)
  );
}

/** A legal game of `plies` half-moves (first legal move each time). */
function gameOf(plies: number): GameLog {
  let state = createStartingPosition(7);
  let log = createGameLog('t', state, 7);
  for (let i = 0; i < plies; i++) {
    const moves = generateLegalMoves(state);
    if (moves.length === 0) break;
    const m = moves[i % moves.length];
    log = appendMove(log, m, undefined, state.topologyState);
    state = applyMove(state, m);
  }
  return log;
}

let failures = 0;
let checked = 0;
const outcomes: GameOutcome[] = ['human-win', 'ai-win', 'draw', 'human-resign'];
for (const mode of ['classic', 'roulette'] as const) {
  for (let plies = 1; plies <= 30; plies++) {
    const log = gameOf(plies);
    for (const outcome of outcomes) {
      const p = computeGamePoints(log, outcome, 'white', mode);
      // saveCompletedGame writes points.moveCount as the doc's moveCount.
      checked++;
      if (!plausiblePoints(p, p.moveCount)) {
        failures++;
        if (failures <= 10) {
          console.log(`FAIL ${mode} ${outcome} ${plies} plies: moveCount ${p.moveCount}, counted ${p.counted}, total ${p.total}`);
        }
      }
    }
  }
}
console.log(`${checked} points objects checked against plausiblePoints`);
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
if (failures) process.exitCode = 1;
