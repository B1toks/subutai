/* fix/v1.1.4: active server-clock probes (src/firebase/clockProbe.ts).
 * Checks the rolling budget (at most PROBE_CAP probes in any
 * PROBE_WINDOW_MS, slots come back as the window slides) and that a
 * probe's bounds, T - ackAt <= offset <= T - sentAt, put the estimate
 * within half the up/down asymmetry of the true offset, whatever the
 * device skew.
 *
 * Run: npx tsx scripts/test-clock-probe.ts
 */
import { PROBE_CAP, PROBE_WINDOW_MS, takeProbeSlot } from '../src/utils/probeBudget';
import { ServerClockEstimate } from '../src/firebase/serverClock';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) {
    failures++;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

// Budget
const times: number[] = [];
let granted = 0;
for (let i = 0; i < 100; i++) if (takeProbeSlot(times, i * 1000)) granted++;
check('cap within one window', granted === PROBE_CAP, String(granted));
check('slot back once the oldest leaves the window', takeProbeSlot(times, PROBE_WINDOW_MS));
check('but only one', !takeProbeSlot(times, PROBE_WINDOW_MS));
// A steady 5-minute cadence plus a burst of 3 never hits the cap.
const steady: number[] = [];
let refused = 0;
for (const t of [0, 2500, 6000]) if (!takeProbeSlot(steady, t)) refused++;
for (let t = 300_000; t <= 4 * 3600_000; t += 300_000) if (!takeProbeSlot(steady, t)) refused++;
check('burst + every 5 min stays under the cap', refused === 0, String(refused));
// 40 writes per 30 min per player was the ceiling asked for.
check('cap at most 40 per 30 min', PROBE_CAP <= 40 && PROBE_WINDOW_MS === 30 * 60_000);

// Probe bounds → estimate error
let worst = 0;
for (let run = 0; run < 2000; run++) {
  const skew = (Math.random() * 2 - 1) * 600_000; // device clock off by up to ±10 min
  const up = 10 + Math.random() * 400;
  const down = 10 + Math.random() * 400;
  const est = new ServerClockEstimate();
  const realSent = 1_800_000_000_000 + Math.random() * 1e6;
  const T = Math.round(realSent + up); // server commit, server clock = real
  const sentAt = realSent + skew;
  const ackAt = realSent + up + down + skew;
  est.noteOwnWrite(T, sentAt, ackAt, 1000);
  const offset = est.offsetMs(ackAt, 1000);
  const err = offset - -skew;
  const allowed = Math.abs(up - down) / 2 + 1;
  if (Math.abs(err) > allowed) {
    check(`probe error within asymmetry/2 (run ${run})`, false, `err ${err} allowed ${allowed}`);
    break;
  }
  worst = Math.max(worst, Math.abs(err) - (allowed - 1));
}
check('probe error never above asymmetry/2', worst <= 1, String(worst));

if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
console.log('ALL PASS');
