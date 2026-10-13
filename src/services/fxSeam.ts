/**
 * window.subutaiFX — the DevTools seam that fires the board's big moments
 * on demand (check, strobe, dust, mate), so QA can look at each one
 * without playing a line out.
 *
 * One object for the whole page, created here. Each hook that owns an
 * effect registers its own entry (useConsoleSeams: check, strobe, dust;
 * useEndgame: mate), in any order: the entries no longer depend on which
 * hook's effect ran first, and a hook re-running its effect replaces only
 * its own entries.
 */
type FxEntry = (...args: never[]) => void;

const fx: Record<string, FxEntry> = {};

if (typeof window !== 'undefined') {
  (window as unknown as { subutaiFX?: Record<string, FxEntry> }).subutaiFX = fx;
}

/** Sets window.subutaiFX[name]; a later registration of the name wins. */
export function registerFx(name: string, entry: FxEntry): void {
  fx[name] = entry;
}
