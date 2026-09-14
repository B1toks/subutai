# Ideas parking lot

Loose ideas worth keeping, not yet scoped or built. Move an idea into
`ROADMAP.md` (with a plan) once it's ready to actually build.

## Rotate changes the theme — DONE 2026-09-14 (main, not the neon branch)

User's idea, said in passing: when the board rotates (topology A → B), the
whole app theme could shift with it — not just the board geometry, the
*mood*.

**Resolution of the three open questions below, and why:**
1. **Tint, not a full swap.** A full palette swap risked fighting the
   user's own theme choice (ThemeToggle). The actual build shifts hue on
   the ambient background gradient only — piece colors, accent colors, and
   panel chrome are untouched and stay 100% whatever theme the user picked.
2. **No conflict with ThemeToggle**, because of a fact discovered while
   building this: the ambient `--eval-c1`/`--eval-c2` background gradient
   on `.app-shell` was ALREADY identical across every `[data-theme]` — it
   never read the active theme at all. So layering a topology-driven hue
   shift into that one gradient doesn't touch anything theme-owned.
3. **Applies to every theme**, not just neon — since the gradient it rides
   on was already theme-agnostic, scoping the tint to one theme would have
   been arbitrary.

**Implementation** (`src/App.tsx`, `evalToColors`): topology A keeps the
original warm ramp (gold when winning ~hsl(45°), crimson when losing
~hsl(355°), warm-brown neutral `#2a2520`/`#1a1612`). Topology B uses the
same lightness/saturation shape with cool hues instead (cyan ~hsl(195°)
winning, violet ~hsl(275°) losing, cool-slate neutral `#1a1c2a`/`#12131f`).
Driven off `state.topologyState` — the COMMITTED board, never the rotate
button's hover-preview, so the room's mood never flickers on a mere hover
(same rule R17c's dust-wave FX already follows). The cross-fade itself is
free: it rides the pre-existing `@property`-registered 0.6s transition
that already smoothly interpolated eval-driven color changes.

Verified live: rotating a fresh game flips `#2a2520/#1a1612` (A, neutral)
to `#1a1c2a/#12131f` (B, neutral); playing into a bad B-side position
produced `hsl(275°, …)` — the cool violet "losing" branch — confirming
the win/lose math works inside topology B too, not just the neutral case.
