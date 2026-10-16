import { describe, expect, it } from 'vitest';
import { createStore } from './store';

type A = { type: 'add'; n: number } | { type: 'noop' };

const counter = () =>
  createStore<number, A, string>(0, (s, a) =>
    a.type === 'add' ? { state: s + a.n, events: [`+${a.n}`] } : { state: s, events: [] },
  );

describe('createStore', () => {
  it('keeps the state step returns and tells both kinds of listener', () => {
    const store = counter();
    const seen: string[] = [];
    store.subscribe(() => seen.push(`render ${store.getState()}`));
    store.onEvents((events, state) => seen.push(`${events.join(',')} -> ${state}`));
    expect(store.dispatch({ type: 'add', n: 2 })).toEqual(['+2']);
    expect(store.getState()).toBe(2);
    expect(seen).toEqual(['render 2', '+2 -> 2']);
  });

  it('a refused action changes nothing and tells nobody', () => {
    const store = counter();
    let calls = 0;
    store.subscribe(() => calls++);
    store.onEvents(() => calls++);
    expect(store.dispatch({ type: 'noop' })).toEqual([]);
    expect(calls).toBe(0);
  });

  it('unsubscribes', () => {
    const store = counter();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    off();
    store.dispatch({ type: 'add', n: 1 });
    expect(calls).toBe(0);
  });

  it("a listener that throws stops nobody; its error is the store's fatal one", () => {
    const store = counter();
    const boom = new Error('boom');
    const seen: string[] = [];
    store.subscribe(() => {
      seen.push('turns');
      throw boom;
    });
    store.subscribe(() => seen.push(`react ${String(store.getFatal() === boom)}`));
    store.onEvents((events) => seen.push(`events ${events.join(',')}`));
    expect(store.getFatal()).toBeNull();
    expect(store.dispatch({ type: 'add', n: 1 })).toEqual(['+1']);
    expect(store.getState()).toBe(1);
    expect(store.getFatal()).toBe(boom);
    // React hears the change, the events go out, and React is told again.
    expect(seen).toEqual(['turns', 'react true', 'events +1', 'turns', 'react true']);
  });

  it('keeps the first error: a listener throwing later does not replace it', () => {
    const store = counter();
    const first = new Error('first');
    let renders = 0;
    store.subscribe(() => renders++);
    store.onEvents(() => {
      throw first;
    });
    store.dispatch({ type: 'add', n: 1 });
    expect(store.getFatal()).toBe(first);
    expect(renders).toBe(2); // told of the change, then of the error
    store.onEvents(() => {
      throw new Error('second');
    });
    store.dispatch({ type: 'add', n: 1 });
    expect(store.getFatal()).toBe(first);
  });
});
