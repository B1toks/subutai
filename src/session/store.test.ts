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
});
