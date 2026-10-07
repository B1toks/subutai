// The v1.0.2 client for the old-client suite (v102.test.mjs): its src/ is
// written out of git once per commit into node_modules/.cache (outside git
// and lint), so the loader runs it beside this branch's own src/. Bare
// imports there (firebase, react) resolve to the same node_modules, and its
// src/firebase/client.ts gets client-stub.mjs like ours (loader.mjs).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const OLD_CLIENT_REF = 'v1.0.2';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const ROOT = path.join(REPO, 'node_modules', '.cache', 'subutai-old-client');

const git = (...args) => execFileSync('git', args, { cwd: REPO, maxBuffer: 256 << 20 });

/** File URL of the old client's src/ directory (with a trailing slash). */
export function oldClientSrc() {
  const sha = git('rev-parse', `${OLD_CLIENT_REF}^{commit}`).toString().trim();
  const stamp = path.join(ROOT, 'COMMIT');
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== sha) {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    // cwd, not -C: Git Bash's GNU tar reads "C:\…" as a remote host.
    execFileSync('tar', ['-x'], { cwd: ROOT, input: git('archive', '--format=tar', sha, 'src') });
    writeFileSync(stamp, sha);
  }
  return pathToFileURL(path.join(ROOT, 'src') + path.sep);
}
