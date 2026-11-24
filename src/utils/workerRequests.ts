/** A request waiting on a worker (searchClient, classifyClient): how its
 *  promise is settled. */
export interface Waiting<T> {
  resolve: (r: T) => void;
  reject: (e: unknown) => void;
}

/** Every request still waiting on a worker that is gone (failed, or
 *  cancelled) is settled by `settle` and forgotten: none is left hanging. */
export function settleAll<T>(waiting: Map<number, Waiting<T>>, settle: (w: Waiting<T>) => void): void {
  const all = [...waiting.values()];
  waiting.clear();
  for (const w of all) settle(w);
}
