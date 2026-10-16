import SearchWorker from './search.worker.ts?worker';
import type { BoardState, Move } from '../engine';
import { planBotMove, type AgentContext } from './agents';
import type { SearchOptions, SearchResult } from './search';
import type { SearchRequest, SearchResponse } from './search.worker';

// Main-thread side of search.worker.ts, after classifyClient.ts: one
// worker for the page, built on first use, answers matched by id.

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (r: SearchResult | undefined) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new SearchWorker();
  worker.onmessage = (e: MessageEvent<SearchResponse>) => {
    const { id, ok, result, error } = e.data;
    const w = waiting.get(id);
    waiting.delete(id);
    if (ok) w?.resolve(result);
    else {
      console.warn('[search] worker error', error);
      w?.reject(new Error(error ?? 'search failed'));
    }
  };
  worker.onerror = (e) => {
    console.error('[search] worker crashed', e.message);
  };
  return worker;
}

type Unsent = SearchRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

function post(req: Unsent): Promise<SearchResult | undefined> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ ...req, id });
  });
}

/** searchPosition (search.ts), on the search worker. */
export async function searchAsync(state: BoardState, options: SearchOptions): Promise<SearchResult> {
  const result = await post({ kind: 'search', state, options });
  return result!;
}

/** ttClear (search.ts) on the search worker, in turn with the searches
 *  sent before it: a new game's searches start from an empty table. */
export function clearSearchTable(): void {
  void post({ kind: 'clear' });
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
