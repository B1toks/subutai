import ClassifyWorker from './classify.worker.ts?worker';
import type { BoardState, Move } from '../engine';
import type { ClassifyOptions, MoveAnalysis } from './classify';
import type { ClassifyResponse } from './classify.worker';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (a: MoveAnalysis) => void>();
const failed = new Map<number, (err: string) => void>();

/** V1 (DEF-6) — neutral result handed to callers whose request was
 *  superseded. Resolving rather than rejecting keeps every call site on its
 *  happy path: a dropped live-game classify just renders as an unremarkable
 *  move, and a dropped review run is discarded by its own cancelled flag. */
const NEUTRAL: MoveAnalysis = {
  classification: 'good',
  cpl: 0,
  searchScoreFromWhite: 0,
  superseded: true,
};

/**
 * Lazily create the classifier worker. Re-used across the session — building
 * a Worker costs ~5–10 ms of script-eval, which we only want to pay once.
 */
function getWorker(): Worker {
  if (worker) return worker;
  worker = new ClassifyWorker();
  worker.onmessage = (e: MessageEvent<ClassifyResponse>) => {
    const { id, ok, analysis, error } = e.data;
    if (ok && analysis) {
      const cb = pending.get(id);
      pending.delete(id);
      failed.delete(id);
      cb?.(analysis);
    } else {
      const errCb = failed.get(id);
      pending.delete(id);
      failed.delete(id);
       
      console.warn('[classifier] worker error', error);
      errCb?.(error ?? 'classify failed');
    }
  };
  worker.onerror = (e) => {
     
    console.error('[classifier] worker crashed', e.message);
  };
  return worker;
}

/**
 * Classify a move on the worker thread. Resolves with the MoveAnalysis once
 * the worker comes back. Rejects only on worker-side errors (the search
 * itself never throws, so this is unusual).
 */
export function classifyAsync(
  stateBefore: BoardState,
  move: Move,
  stateAfter: BoardState,
  opts?: ClassifyOptions,
): Promise<MoveAnalysis> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    failed.set(id, reject);
    getWorker().postMessage({ id, stateBefore, move, stateAfter, opts });
  });
}

/**
 * V1 (DEF-6) — hard-cancel everything queued or in flight.
 *
 * The worker processes requests serially with no way to skip one, so a
 * superseded batch (the classic case: a Game Review restarted because its
 * log prop changed) used to sit behind the previous batch's full queue —
 * up to a minute of "Analyzing 0/28" with no visible progress. Terminating
 * the worker drops that work instantly; the next classifyAsync lazily
 * builds a fresh one. Every pending promise settles with NEUTRAL so no
 * caller is left hanging.
 */
export function cancelPendingClassifications(): void {
  if (!worker) return;
  worker.terminate();
  worker = null;
  const waiting = [...pending.values()];
  pending.clear();
  failed.clear();
  for (const resolve of waiting) resolve(NEUTRAL);
}

/** Tear the worker down (e.g. before navigation). */
export function terminateClassifier(): void {
  cancelPendingClassifications();
}
