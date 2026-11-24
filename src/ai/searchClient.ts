import SearchWorker from './search.worker.ts?worker';
import type { BoardState, Move } from '../engine';
import { planBotMove, type AgentContext } from './agents';
import { searchPosition, type SearchOptions, type SearchResult } from './search';
import type { SearchRequest, SearchResponse } from './search.worker';

// Main-thread side of search.worker.ts, after classifyClient.ts: one
// worker for the page, built on first use, answers matched by id.

/** What the requests of a worker that failed as a whole (its file did not
 *  load, as on a page left open across a deploy, or it crashed) are
 *  refused with, as against one search failing inside it. */
const workerFailed = new Error('search worker failed');

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (r: SearchResult | undefined) => void; reject: (e: Error) => void }>();
/** The worker failed: this page searches on the main thread from now on,
 *  as the bot did in v1.1.7, rather than building a worker that fails
 *  again (or fetching a file that is not there) before every move. No
 *  reload: it would lose a timed or Roulette game, which useResumeGame
 *  does not bring back. */
let mainThreadOnly = false;

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
  w.onerror = (e) => {
    // Every request still waiting is refused (none is left hanging) and
    // searched on the main thread, as is every later one.
    if (worker !== w) return;
    // A file that did not load raises a bare Event, with no message.
    console.error('[search] worker crashed', (e as Partial<ErrorEvent>).message ?? e);
    w.terminate();
    worker = null;
    mainThreadOnly = true;
    const refused = [...waiting.values()];
    waiting.clear();
    for (const p of refused) p.reject(workerFailed);
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

/** searchPosition (search.ts), on the search worker; on the main thread
 *  once the worker has failed (mainThreadOnly). An error of one search
 *  inside a working worker is passed on as before. */
export async function searchAsync(state: BoardState, options: SearchOptions): Promise<SearchResult> {
  if (!mainThreadOnly) {
    try {
      return (await post({ kind: 'search', state, options }))!;
    } catch (err) {
      if (err !== workerFailed) throw err;
    }
  }
  // Its table is the main thread's own and a new game does not clear it
  // (no room in the first load): an old game's entries are positions like
  // any other, they only shape the search as a warm table does.
  return searchPosition(state, options);
}

/** ttClear (search.ts) on the search worker, in turn with the searches
 *  sent before it: a new game's searches start from an empty table. */
export function clearSearchTable(): void {
  // A worker that fails here leaves the next search to the main thread.
  if (!mainThreadOnly) post({ kind: 'clear' }).catch(() => {});
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
