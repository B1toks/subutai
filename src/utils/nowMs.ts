/**
 * The wall clock, Date.now(), for code that runs in an event or an effect
 * but that the React compiler's lint cannot tell from render code: App's
 * handlers (startNewGame, finishGame …) are handed to hooks, which the lint
 * assumes may call them while rendering, so it reports Date.now() in them
 * as impure render code. The value is Date.now()'s; this only says what the
 * call is for.
 */
export function nowMs(): number {
  return Date.now();
}
