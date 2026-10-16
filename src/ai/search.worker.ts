/// <reference lib="webworker" />

import type { BoardState } from '../engine';
import { searchPosition, ttClear, type SearchOptions, type SearchResult } from './search';

// The game's search, off the main thread: the bot's move, the hint, the
// self-play labels. One worker, so they share one transposition table, as
// they did on the main thread; requests run one at a time, in order.

export type SearchRequest =
  | { readonly id: number; readonly kind: 'search'; readonly state: BoardState; readonly options: SearchOptions }
  | { readonly id: number; readonly kind: 'clear' };

export interface SearchResponse {
  readonly id: number;
  readonly ok: boolean;
  readonly result?: SearchResult;
  readonly error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<SearchRequest>) => {
  const req = e.data;
  try {
    if (req.kind === 'clear') {
      ttClear();
      ctx.postMessage({ id: req.id, ok: true } satisfies SearchResponse);
      return;
    }
    const result = searchPosition(req.state, req.options);
    ctx.postMessage({ id: req.id, ok: true, result } satisfies SearchResponse);
  } catch (err) {
    ctx.postMessage({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies SearchResponse);
  }
};
