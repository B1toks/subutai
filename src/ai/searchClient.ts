import SearchWorker from './search.worker.ts?worker';
import type { BoardState, Move } from '../engine';
import { planBotMove, type AgentContext } from './agents';
import { searchPosition, ttClear, type SearchOptions, type SearchResult } from './search';
import { settleAll, type Waiting } from '../utils/workerRequests';
import type { SearchRequest, SearchResponse } from './search.worker';

// Main-thread side of search.worker.ts, after classifyClient.ts: one
// worker for the page, built on first use, answers matched by id.

/** What the requests of a worker that failed as a whole (its file did not
 *  load, as on a page left open across a deploy, or it crashed) are
 *  refused with, as against one search failing inside it. */
const workerFailed = new Error();

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, Waiting<SearchResult | undefined>>();
/** The worker failed: this page searches on the main thread from now on,
 *  as the bot did in v1.1.7, rather than building a worker that fails
 *  again (or fetching a file that is not there) before every move. No
 *  reload: it would lose a timed or Roulette game, which useResumeGame
 *  does not bring back. */
let mainThreadOnly = false;

/** The worker failed as a whole, or could not be had at all: every
 *  request still waiting is refused (none is left hanging) and searched on
 *  the main thread, as is every later one. */
function fail(why: unknown): void {
  console.error('[search] worker failed', why);
  worker?.terminate();
  worker = null;
  mainThreadOnly = true;
  settleAll(waiting, (p) => p.reject(workerFailed));
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new SearchWorker();
  worker = w;
  w.onmessage = (e: MessageEvent<SearchResponse>) => {
    const { id, ok, result, error } = e.data;
    const p = waiting.get(id);
    waiting.delete(id);
    if (ok) p?.resolve(result);
    else {
      console.warn('[search] worker error', error);
      p?.reject(new Error(error ?? 'search failed'));
    }
  };
  // A crash raises an ErrorEvent (its message shows in the console); a
  // file that did not load, a bare Event.
  w.onerror = (e) => {
    if (worker === w) fail(e);
  };
  return w;
}

type Unsent = SearchRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

function post(req: Unsent): Promise<SearchResult | undefined> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    // A Worker that cannot be built (a worker-src policy, no module
    // workers) fails as a crash does. One request that cannot be sent
    // (it cannot be cloned) is refused alone: the worker is fine.
    let w: Worker;
    try {
      w = getWorker();
    } catch (err) {
      fail(err);
      return;
    }
    try {
      w.postMessage({ ...req, id });
    } catch (err) {
      waiting.delete(id);
      reject(err);
    }
  });
}

/** searchPosition (search.ts), on the search worker; on the main thread
 *  once the worker has failed (mainThreadOnly). An error of one search
 *  inside a working worker is passed on as before. `wanted`: whether the
 *  asker still wants the answer (its bot turn not aborted, its hint's
 *  board still on the table). A search that was waiting when the worker
 *  failed, and is no longer wanted, is refused instead of run here, where
 *  each one would hold up the page for its whole budget. */
export async function searchAsync(
  state: BoardState,
  options: SearchOptions,
  wanted?: () => boolean,
): Promise<SearchResult> {
  if (!mainThreadOnly) {
    try {
      return (await post({ kind: 'search', state, options }))!;
    } catch (err) {
      if (err !== workerFailed || (wanted && !wanted())) throw err;
    }
  }
  return searchPosition(state, options);
}

/** ttClear (search.ts) on the search worker, in turn with the searches
 *  sent before it, or on the main thread once the worker has failed (as
 *  v1.1.7's new game did): a new game's searches start from an empty table
 *  (its key leaves out the variant's rules). */
export function clearSearchTable(): void {
  if (mainThreadOnly) ttClear();
  // A worker that fails here leaves the next search to the main thread.
  else post({ kind: 'clear' }).catch(() => {});
}

/** SubutaiAgent.chooseMove (agents.ts), its search on the search worker:
 *  the level's slip roll here, then the search there. */
export async function chooseBotMove(
  state: BoardState,
  legalMoves: readonly Move[],
  context?: AgentContext,
  wanted?: () => boolean,
): Promise<Move | null> {
  const plan = planBotMove(state, legalMoves, context);
  if ('slip' in plan) return plan.slip;
  return (await searchAsync(state, plan.search, wanted)).bestMove;
}
