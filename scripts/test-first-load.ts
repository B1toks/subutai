/* The first-load ceiling: the gzip bytes of the JS and CSS that dist/index.html
 * references (what an empty first visit downloads before the first screen),
 * measured as ship-check's bundle-budget does (gzip level 6). The ceiling is
 * 288.5 KB, 295 424 B, from v1.2.1; it was 287.6 KB (294 553 B), and v1.2.0
 * shipped 3 B under it.
 *
 * Run after a build. Git Bash: npx vite build && npx tsx scripts/test-first-load.ts
 * PowerShell: npx.cmd vite build; npx.cmd tsx scripts/test-first-load.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const FIRST_LOAD_CEILING_BYTES = 295_424;

const dist = path.resolve(process.argv[2] ?? 'dist');
const html = path.join(dist, 'index.html');
if (!existsSync(html)) {
  console.log(`FAIL no ${html}: build first (npx vite build)`);
  process.exit(1);
}
const refs = [...readFileSync(html, 'utf8').matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
  .map((m) => m[1].replace(/^\/subutai\//, '').replace(/^\//, ''));
let bytes = 0;
const missing: string[] = [];
for (const ref of refs) {
  const file = path.join(dist, ref);
  if (existsSync(file)) bytes += gzipSync(readFileSync(file), { level: 6 }).length;
  else missing.push(ref);
}
const line = `first load ${bytes} B gzip across ${refs.length} files (ceiling ${FIRST_LOAD_CEILING_BYTES} B)`;
if (missing.length) {
  console.log(`FAIL ${line}; index.html references files the build does not have: ${missing.join(', ')}`);
  process.exit(1);
}
if (bytes > FIRST_LOAD_CEILING_BYTES) {
  console.log(`FAIL ${line}: ${bytes - FIRST_LOAD_CEILING_BYTES} B over`);
  process.exit(1);
}
console.log(`PASS ${line}, ${FIRST_LOAD_CEILING_BYTES - bytes} B to spare`);
