/* Resolves the application source these tests run against.
 *
 * By default that is ../../src of this checkout. Point QA_SRC at another
 * checkout's src/ to run the same tests against a different branch
 * without copying anything:
 *
 *   QA_SRC=C:/projects/chess/src npx tsx qa/engine/fuzz-invariants.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SRC_ROOT = path.resolve(process.env.QA_SRC ?? path.join(here, '..', '..', 'src'));
export const QA_ROOT = path.resolve(here, '..');

if (!fs.existsSync(path.join(SRC_ROOT, 'engine', 'moves.ts'))) {
  throw new Error(`QA_SRC does not look like the app's src/: ${SRC_ROOT}`);
}

export function srcModule<T>(rel: string): Promise<T> {
  return import(pathToFileURL(path.join(SRC_ROOT, rel)).href) as Promise<T>;
}

export type EngineIndex = typeof import('../../src/engine/index');
export type EngineMoves = typeof import('../../src/engine/moves');
export type EngineAuxetic = typeof import('../../src/engine/auxetic');
export type EngineBoard = typeof import('../../src/engine/board');
export type RecordingLog = typeof import('../../src/recording/log');
export type MemoryBuild = typeof import('../../src/memory/build');
export type MemoryNotation = typeof import('../../src/memory/notation');
export type AiSearch = typeof import('../../src/ai/search');
export type AiTT = typeof import('../../src/ai/tt');

export async function loadEngine() {
  const [index, moves, auxetic, board] = await Promise.all([
    srcModule<EngineIndex>('engine/index.ts'),
    srcModule<EngineMoves>('engine/moves.ts'),
    srcModule<EngineAuxetic>('engine/auxetic.ts'),
    srcModule<EngineBoard>('engine/board.ts'),
  ]);
  return { index, moves, auxetic, board };
}

/** Deterministic PRNG so every failure is reproducible from its seed. */
export function mulberry32(a: number) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
