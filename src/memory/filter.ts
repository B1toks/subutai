/**
 * Position filter for the Memory panel.
 *
 * B5 — the original matcher demanded a full 8-character pattern, so
 * any partial query ("RQK", "BBN") silently matched nothing and the
 * search read as broken. Patterns are now 1–8 chars of R|Q|K|N|B|*
 * (case-insensitive, * = any) and match as a sliding window anywhere
 * in the back-rank string:
 *   RQKRNBBN — exact board
 *   R****BBN — full-width wildcard pattern
 *   BBN      — any board with two bishops + knight adjacent
 *   *Q*      — any board (wildcards only always match)
 */
export function matches960Pattern(config: string, pattern: string): boolean {
  const c = config.toUpperCase();
  const p = pattern.toUpperCase().trim();
  if (c.length !== 8 || p.length === 0 || p.length > 8) return false;
  if (!/^[RQKNB*]+$/.test(p)) return false;

  for (let start = 0; start + p.length <= 8; start++) {
    let ok = true;
    for (let i = 0; i < p.length; i++) {
      if (p[i] !== '*' && p[i] !== c[start + i]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}
