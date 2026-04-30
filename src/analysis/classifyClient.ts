import ClassifyWorker from './classify.worker.ts?worker';
import type { BoardState, Move } from '../engine';
import type { ClassifyOptions, MoveAnalysis } from './classify';
import type { ClassifyResponse } from './classify.worker';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (a: MoveAnalysis) => void>();
const failed = new Map<number, (err: string) => void>();

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
      // eslint-disable-next-line no-console
      console.warn('[classifier] worker error', error);
      errCb?.(error ?? 'classify failed');
    }
  };
  worker.onerror = (e) => {
    // eslint-disable-next-line no-console
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

/** Tear the worker down (e.g. before navigation). */
export function terminateClassifier(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  pending.clear();
  failed.clear();
}
