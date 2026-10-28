import type { Store } from './store';
import { revealOf } from './step';
import type { Action, SessionEvent, SessionState } from './types';

type SessionStore = Store<SessionState, Action, SessionEvent>;

/** v1.1.6: a slot lands every 400 ms; the last one settles 200 ms (its
 *  CSS landing, .roulette-face-landed, runs 180 ms) before the bag is live. */
export const REVEAL_SLOT_MS = 400;
export const REVEAL_SETTLE_MS = 200;

export interface Reveal {
  stop(): void;
}

/**
 * The clock of a bag landing (RouletteReveal): 'spinSlot' 400 ms after the
 * reveal begins and after each slot, then 'spinLand' 200 ms after the last.
 * step() has no clock, so this lives beside it, as the turns driver does:
 * it watches the store and acts on what it sees. Each beat is timed from
 * the one before, so a busy frame delays it without squeezing the rest.
 * A reveal that ends any other way (a new game, a mode click, leaving the
 * match) is simply no longer there: its timer is dropped, and an action
 * for it that comes late is refused (it names its reveal by `since`).
 */
export function createReveal(store: SessionStore): Reveal {
  let pending: { since: number; shown: number; timer: ReturnType<typeof setTimeout> } | null = null;

  function clear() {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  }

  function refresh() {
    const r = revealOf(store.getState());
    if (!r) {
      clear();
      return;
    }
    if (pending && pending.since === r.since && pending.shown === r.shown) return;
    clear();
    const landed = r.shown >= r.slots.length;
    const since = r.since;
    pending = {
      since,
      shown: r.shown,
      timer: setTimeout(() => {
        pending = null;
        store.dispatch(landed ? { type: 'spinLand', since } : { type: 'spinSlot', since });
      }, landed ? REVEAL_SETTLE_MS : REVEAL_SLOT_MS),
    };
  }

  const unsubscribe = store.subscribe(refresh);
  refresh();
  return {
    stop() {
      unsubscribe();
      clear();
    },
  };
}
