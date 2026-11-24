import ClassifyWorker from './classify.worker.ts?worker';
import type { BoardState, Move } from '../engine';
import type { ClassifyOptions, MoveAnalysis } from './classify';
import type { ClassifyResponse } from './classify.worker';
import { settleAll, type Waiting } from '../utils/workerRequests';

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, Waiting<MoveAnalysis>>();

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
  const w = new ClassifyWorker();
  worker = w;
  w.onmessage = (e: MessageEvent<ClassifyResponse>) => {
    const { id, ok, analysis, error } = e.data;
    const p = waiting.get(id);
    waiting.delete(id);
    if (ok && analysis) p?.resolve(analysis);
    else {
      console.warn('[classifier] worker error', error);
      p?.reject(error ?? 'classify failed');
    }
  };
  w.onerror = (e) => {
    // The worker failed as a whole (its file did not load, or it crashed):
    // every request still waiting is refused (none is left hanging; the
    // move goes without a verdict), and the next one builds a new worker.
    if (worker !== w) return;
    // A file that did not load raises a bare Event, with no message.
    const message = (e as Partial<ErrorEvent>).message;
    console.error('[classifier] worker crashed', message ?? e);
    w.terminate();
    worker = null;
    const err = new Error(message);
    settleAll(waiting, (p) => p.reject(err));
  };
  return w;
}

/**
 * Classify a move on the worker thread. Resolves with the MoveAnalysis once
 * the worker comes back. Rejects on worker-side errors (the search itself
 * never throws, so this is unusual) and when the worker fails as a whole.
 */
export function classifyAsync(
  stateBefore: BoardState,
  move: Move,
  stateAfter: BoardState,
  opts?: ClassifyOptions,
): Promise<MoveAnalysis> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
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
  settleAll(waiting, (p) => p.resolve(NEUTRAL));
}

/** Tear the worker down (e.g. before navigation). */
export function terminateClassifier(): void {
  cancelPendingClassifications();
}
