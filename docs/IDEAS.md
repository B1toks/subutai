# Ideas parking lot

Loose ideas worth keeping, not yet scoped or built. Move an idea into
`ROADMAP.md` (with a plan) once it's ready to actually build.

## Focus / Ritual mode (not built)

"Чи є Музика як ритуал/вайб — lo-fi chess під свій трек?" The building
blocks already exist and are real (not stubs): MusicDock plays the
player's own Spotify track/playlist alongside the game; BeatEngine does
live BPM detection (essentia.js/TempoCNN) and syncs rotation, victory
strobes, and capture timing to it; there's also a built-in generative
ambient layer (Eno-style — quiet filtered floor + sparse mid-register
notes, not static loops) with 4 theme-matched palettes and warm/dark/
adaptive moods. What's missing is the RITUAL FRAMING around all of that:

- No dedicated "Focus mode" that dims the UI chrome to something close to
  just-the-board, signaling "this is a session, not a tab."
- No default curated lo-fi preset — the player has to paste their own
  Spotify link before any of the music system does anything.
- No entrance beat — sitting down to play reads exactly like opening any
  other web page, not like starting something.

Candidate shape for a future session: a single toggle (maybe living next
to ThemeToggle, or triggered by an idle/first-visit moment) that (a)
dims/hides non-essential chrome, (b) auto-starts the built-in ambient
layer with no Spotify link required, (c) plays a short, quiet entrance
transition. Possibly the natural home for a lighter version of "rotation
changes the theme" (see below) — a Focus-mode-only palette shift instead
of applying it globally. Not scoped, not started.

## Daily Trap Challenge (requested, not yet built)

From the R15 self-play trap-mining work (`docs/R15-DATA-FINDINGS.md` §5):
4807 self-play games surfaced a table of the most "trap-prone" chess960
starting positions — early moves (4-10) where the eval swings hard
against whoever just moved, i.e. positions that reliably fool players.
User wants a Wordle-style daily feature built on this: one shared
position/line per day, everyone plays the same trap, a potential sponsor
slot on the daily header once there's real traffic to justify it.

Needs actual scoping before building: how a "day" resolves the same
position for everyone (server-driven pick vs. a deterministic seed from
the date), what "solving" the trap means as a win condition (survive N
moves? find the only non-losing reply? beat the position outright?),
whether attempts are capped per day, and a results-sharing format (a
Wordle-style emoji-grid summary is the obvious playbook). Candidate for
the next work session — real feature, not a quick add.

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
