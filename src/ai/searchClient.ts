import SearchWorker from './search.worker.ts?worker';
import type { BoardState, Move } from '../engine';
import { planBotMove, type AgentContext } from './agents';
import { searchPosition, type SearchOptions, type SearchResult } from './search';
import type { SearchRequest, SearchResponse } from './search.worker';
import { canAutoReload, markAutoReload } from '../utils/chunkReload';

// Main-thread side of search.worker.ts, after classifyClient.ts: one
// worker for the page, built on first use, answers matched by id.

/** What the requests of a worker that failed as a whole (its file did not
 *  load, or it crashed) are refused with, as against one search failing
 *  inside it. `loadFailed`: it failed before answering anything, which is
 *  what a page left open across a deploy sees when it asks for a worker
 *  file the new deploy no longer has. (A plain Error with a flag, not a
 *  class: the first load has no room for one.) */
export type SearchWorkerError = Error & { readonly loadFailed: boolean };

const isWorkerFailure = (err: unknown): err is SearchWorkerError =>
  typeof (err as Partial<SearchWorkerError> | null)?.loadFailed === 'boolean';

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (r: SearchResult | undefined) => void; reject: (e: Error) => void }>();
/** The page is reloading: what is asked meanwhile waits for it. */
let reloading = false;

function getWorker(): Worker {
  if (worker) return worker;
  const w = new SearchWorker();
  let answered = false;
  worker = w;
  w.onmessage = (e: MessageEvent<SearchResponse>) => {
    answered = true;
    const { id, ok, result, error } = e.data;
    const p = waiting.get(id);
    waiting.delete(id);
    if (ok) p?.resolve(result);
    else {
      console.warn('[search] worker error', error);
      p?.reject(new Error(error ?? 'search failed'));
    }
  };
  w.onerror = (e) => {
    // Every request still waiting is refused (none is left hanging), and
    // the next one builds a new worker.
    if (worker !== w) return;
    const message = (e as Partial<ErrorEvent>).message || 'search worker failed';
    console.error('[search] worker crashed', message);
    w.terminate();
    worker = null;
    const refused = [...waiting.values()];
    waiting.clear();
    const err: SearchWorkerError = Object.assign(new Error(message), { loadFailed: !answered });
    for (const p of refused) p.reject(err);
  };
  return w;
}

type Unsent = SearchRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

function post(req: Unsent): Promise<SearchResult | undefined> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ ...req, id });
  });
}

/**
 * A search the worker could not answer. A worker file that did not load
 * reloads the page once (utils/chunkReload.ts, as the error boundary does
 * for a lazy screen): the reload fetches the deploy's own files. Already
 * reloaded, or the worker crashed later on: the search runs here, on the
 * main thread, as the bot's did before it had a worker. An error of one
 * search inside a working worker is passed on as before.
 */
function recover(err: unknown, state: BoardState, options: SearchOptions): Promise<SearchResult> {
  if (!isWorkerFailure(err)) return Promise.reject(err);
  if (reloading) return new Promise<SearchResult>(() => {});
  if (err.loadFailed) {
    const now = Date.now();
    if (canAutoReload(now) && markAutoReload(now)) {
      reloading = true;
      window.location.reload();
      return new Promise<SearchResult>(() => {});
    }
  }
  // Its table is the main thread's own and a new game does not clear it
  // (no room in the first load): an old game's entries are positions like
  // any other, they only shape the search as a warm table does.
  return Promise.resolve(searchPosition(state, options));
}

/** searchPosition (search.ts), on the search worker; on the main thread
 *  if the worker fails (see recover). */
export async function searchAsync(state: BoardState, options: SearchOptions): Promise<SearchResult> {
  try {
    const result = await post({ kind: 'search', state, options });
    return result!;
  } catch (err) {
    return recover(err, state, options);
  }
}

/** ttClear (search.ts) on the search worker, in turn with the searches
 *  sent before it: a new game's searches start from an empty table. */
export function clearSearchTable(): void {
  // A worker that fails here is built again for the next search, which
  // recovers on its own.
  post({ kind: 'clear' }).catch(() => {});
}

/** SubutaiAgent.chooseMove (agents.ts), its search on the search worker:
 *  the level's slip roll here, then the search there. */
export async function chooseBotMove(
  state: BoardState,
  legalMoves: readonly Move[],
  context?: AgentContext,
): Promise<Move | null> {
  const plan = planBotMove(state, legalMoves, context);
  if ('slip' in plan) return plan.slip;
  return (await searchAsync(state, plan.search)).bestMove;
}
