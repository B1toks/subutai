/** fix/v1.1.4 — the rolling budget of server-clock probes
 *  (firebase/clockProbe.ts): at most PROBE_CAP in any PROBE_WINDOW_MS. */
export const PROBE_CAP = 20;
export const PROBE_WINDOW_MS = 30 * 60_000;

/** Takes a slot (`times` holds the probe times, oldest first); false when
 *  the cap is reached. */
export function takeProbeSlot(times: number[], now: number, cap = PROBE_CAP, windowMs = PROBE_WINDOW_MS): boolean {
  while (times.length > 0 && now - times[0] >= windowMs) times.shift();
  if (times.length >= cap) return false;
  times.push(now);
  return true;
}
