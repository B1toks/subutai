/* F7: which moves of a log still wait for a classification.
 * Rotations are never classified, and a superseded result is only a
 * placeholder (the classifier worker was restarted under the request), so
 * neither counts as done.
 *
 * Run: npx tsx scripts/test-log-analysis.ts
 */
import { createStartingPosition } from '../src/engine';
import { applyMove, generateLegalMoves } from '../src/engine/moves';
import { applyRotationMove } from '../src/engine/auxetic';
import { appendMove, computeSAN, createGameLog, unclassifiedMoveIndexes, updateMoveAnalysisAt } from '../src/recording/log';
import type { MoveAnalysis } from '../src/analysis/classify';

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
}

// Four entries: a move, a rotation, a move, a move.
let st = createStartingPosition(7);
let log = createGameLog('f7', st, 7);
for (let i = 0; i < 4; i++) {
  if (i === 1) {
    log = appendMove(log, { kind: 'topologyToggle' }, 'A→B', st.topologyState);
    st = applyRotationMove(st);
    continue;
  }
  const m = generateLegalMoves(st)[0];
  log = appendMove(log, m, computeSAN(st, m), st.topologyState);
  st = applyMove(st, m);
}

const good: MoveAnalysis = { classification: 'good', cpl: 0, searchScoreFromWhite: 0 };
const placeholder: MoveAnalysis = { classification: 'good', cpl: 0, searchScoreFromWhite: 0, superseded: true };
const same = (a: number[], b: number[]) => JSON.stringify(a) === JSON.stringify(b);

check('nothing classified: every real move waits, the rotation does not', same(unclassifiedMoveIndexes(log), [0, 2, 3]), JSON.stringify(unclassifiedMoveIndexes(log)));
log = updateMoveAnalysisAt(log, 0, good);
log = updateMoveAnalysisAt(log, 2, placeholder);
check('a superseded placeholder still waits', same(unclassifiedMoveIndexes(log), [2, 3]), JSON.stringify(unclassifiedMoveIndexes(log)));
log = updateMoveAnalysisAt(log, 2, good);
log = updateMoveAnalysisAt(log, 3, good);
check('all real moves classified: nothing waits', unclassifiedMoveIndexes(log).length === 0, JSON.stringify(unclassifiedMoveIndexes(log)));

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
if (failures) process.exitCode = 1;
