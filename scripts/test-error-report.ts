/* fix/v1.1.4: the report behind "Details" on the error screen
 * (src/utils/errorReport.ts). Checks that the page address keeps only
 * the query values the app itself reads and never the fragment, that the
 * stacks are cut to their first lines, and that a non-Error throw still
 * gives a report.
 *
 * Run: npx tsx scripts/test-error-report.ts
 */
import { buildErrorReport, errorSummary, safeUrl } from '../src/utils/errorReport';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) {
    failures++;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

// safeUrl
check('plain', safeUrl('https://subutai.honchar.dev/') === 'https://subutai.honchar.dev/');
check(
  'known keys keep values',
  safeUrl('https://x.dev/subutai/?game=abc123&stats=1') === 'https://x.dev/subutai/?game=abc123&stats=1',
  safeUrl('https://x.dev/subutai/?game=abc123&stats=1'),
);
const secret = safeUrl('https://x.dev/?code=SECRET&state=S2&game=g1#access_token=TOKEN');
check('unknown values dropped', !secret.includes('SECRET') && !secret.includes('S2'), secret);
check('fragment dropped', !secret.includes('TOKEN') && secret.endsWith('#…'), secret);
check('unknown keys still listed', secret.includes('code=…') && secret.includes('state=…'), secret);
check('unparsable', safeUrl('not a url') === '(unparsable URL)');

// errorSummary
check('Error summary', errorSummary(new TypeError('boom')) === 'TypeError: boom');
check('string throw', errorSummary('oops') === 'Non-Error thrown: oops');

// buildErrorReport
const err = new Error('Failed to fetch dynamically imported module: https://x.dev/assets/FriendLobby-abc.js');
err.stack = [
  `Error: ${err.message}`,
  ...Array.from({ length: 20 }, (_, i) => `    at frame${i} (https://x.dev/assets/index.js:1:${i})`),
].join('\n');
const comp = Array.from({ length: 20 }, (_, i) => `\n    at Comp${i}`).join('');
const report = buildErrorReport({
  error: err,
  componentStack: comp,
  version: '9.9.9',
  href: 'https://x.dev/?game=g1&token=T#frag',
  userAgent: 'UA/1',
  at: new Date('2026-10-09T12:00:00Z'),
});
const lines = report.split('\n');
check('version first', lines[0] === 'Subutai v9.9.9', lines[0]);
check('time', report.includes('Time: 2026-10-09T12:00:00.000Z'));
check('url safe', report.includes('URL: https://x.dev/?game=g1&token=…#…') && !report.includes('#frag'), report);
check('error line', report.includes(`Error: Error: ${err.message}`));
check('stack cut to 8, first frame kept', report.includes('at frame0 ') && report.includes('at frame7 ') && !report.includes('at frame8 '), report);
check('stack header not repeated', !lines.some((l) => l.trim() === `Error: ${err.message}`));
check('components cut to 8', report.includes('at Comp7') && !report.includes('at Comp8'), report);
const bare = buildErrorReport({ error: 42, version: '1', href: 'https://x.dev/', userAgent: 'UA', at: new Date(0) });
check('non-Error report', bare.includes('Error: Non-Error thrown: 42') && !bare.includes('Stack:') && !bare.includes('Components:'), bare);

if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
console.log('ALL PASS');
