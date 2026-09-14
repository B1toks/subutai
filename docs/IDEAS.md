# Ideas parking lot

Loose ideas worth keeping, not yet scoped or built. Move an idea into
`ROADMAP.md` (with a plan) once it's ready to actually build.

## Rotate changes the theme (neon branch, 2026-09-14)

User's idea, said in passing: when the board rotates (topology A → B), the
whole app theme could shift with it — not just the board geometry, the
*mood*. E.g. classic wood while in topology A, and on rotate the page
cross-fades into the neon palette (or cyberpunk, or whatever theme is
active) for topology B, then fades back on the next rotate.

Why it's interesting: rotation is already the game's signature "everything
just changed" moment (R17c's dust-shockwave FX exists for exactly this
beat). Tying a full palette shift to it would make that moment even
bigger — visually dramatizes "you are now playing a different board."

Open questions before building:
- Full theme swap (background + pieces + accents) or just an accent/tint
  shift? A full swap risks fighting the user's own chosen theme preference
  (ThemeToggle) — rotation-driven and user-driven theme selection would
  need to coexist, maybe as "topology B = user's theme + a tint" rather
  than switching to a hardcoded second theme.
- Does it apply to every theme or only neon (where the two-tone cyan/
  magenta language already suggests "A-side / B-side")?
- Cost: a CSS custom-property cross-fade on topology change, gated by
  prefers-reduced-motion like every other R17 effect. Should be cheap —
  a few hours, not a redesign.

Not built. Candidate for whoever picks up the neon branch next, alongside
the rest of the layout experiment verdict (see R15-NEXT-PLAN.md history
in memory — the branch is `design/neon-stitch`, frozen pending the user's
own hands-on review).
