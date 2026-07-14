# R15 — next steps: plan + handoff (written 2026-07-13)

Audience: any session (or weaker model) picking this work up cold. Everything
needed is in this file + `docs/R15-DATA-FINDINGS.md` (the numbers). Read both
before touching code.

## 1. Where we are

Repo: `C:\projects\chess` (branch `main`, everything ships to main).
App: Subutai — auxetic Chess960 vs bot, React 19 + Vite + Firebase
(project `subutai-chess`), deployed via `npm run deploy` (gh-pages).

R15 status:

| step | state | commits |
|---|---|---|
| 0 dump + inventory | DONE | 620fade |
| 1 analytics (funnel / first blunder / rotate) | DONE | 7383892 (doc) |
| 2 public stats on `/?stats=1` | DONE | c34fbdd |
| 1b game-start ping (abandonment) | code DONE, **rules NOT deployed** | c338baf |
| 4-lite data-driven coaching beats | DONE | (this commit) |
| 3 human-move predictor | DEFERRED until ~500 human games | — |

Headline data (details in R15-DATA-FINDINGS.md): 53% of games end by move 10;
median first human blunder = move 4; rotating usually hurts the rotator
(mean -277cp); 59% of human wins came back from <= -2.5 pawns.

## 2. Blocked on the user (do not attempt from an agent)

- **Deploy `firestore.rules`** — the `game_starts` block exists in the repo
  but not in prod, so every ping currently dies with permission-denied
  (harmless, logged as console.warn). Either
  `npx firebase-tools login && npx firebase-tools deploy --only firestore:rules`
  or paste the file into Firebase console > Firestore > Rules.

## 3. Task queue (in order, each independently shippable)

### T1 — confirm pings land (5 min, after rules deploy)
Where: browser, prod or `npm run dev` (port 5173, path `/subutai/`).
How: sign in (name modal, anon auth), make one move in a solo game, then in
Firebase console check `/game_starts` for a new doc
`{playerId, chess960Id, seed, gameMode, createdAt}`.
Code under test: `src/firebase/gameStarts.ts` + the `startPingedLogIdRef`
effect in `src/App.tsx` (search "R15: abandonment ping").
Accept: one doc per game, none for multiplayer/auto/replay.

### T2 — abandonment funnel v2 (half a day, needs ~2 weeks of pings)
Where: `scripts/dump-training-games.mjs` already dumps ANY collection:
`node scripts/dump-training-games.mjs game_starts` -> `data/game-starts-dump.json`.
How: extend `scripts/report-r15.mjs` with report 4: joins starts vs
completions. A start with no `/games` doc from the same `playerId` within
~2h of `createdAt` = abandoned run. Report: abandonment rate overall, by
gameMode, and the histogram "abandoned after N completed games that day".
Careful: completions only save for signed-in users WITH displayName — starts
have the same gate, so the join is fair by construction.
Accept: report prints "starts / completed / abandoned (rate)" without NaN,
counts reconcile (starts >= completions in any window).

### T3 — marketing stats page v2 (2-3 h)
Where: `src/components/StatsPage.tsx` (route: `/?stats=1`, lazy-loaded from
`App.tsx` via `isStatsMode`). CSS: `.funnel-*` and `.stat*` blocks at the
bottom of `src/App.css`.
How: add to "Hall of numbers": comeback stat — % of wins that passed through
<= -2.5 pawns. That needs evals, which Firestore does NOT store, so either
(a) hardcode the offline number (59%, from findings doc) with a footnote, or
(b) skip. Do NOT try to compute it client-side.
Also worth adding once T2 data exists: "X% of started games get finished".
Accept: `npx tsc -b` clean; page renders with no console errors; no em-dashes
in user-facing strings (project rule).

### T4 — predictor v1 (LATER: trigger when `/games` count >= ~500)
Check count: `node scripts/dump-games.mjs` prints the count as it pages.
Why deferred: 121 human games over 73 distinct chess960 starts — an
opening-book (position-frequency) model has no repeated positions to learn
from. Feature-based only.
Data prep (all offline):
1. `node scripts/dump-games.mjs` (public read, no auth needed).
2. `npx tsx scripts/label-human-games.ts` — replays every game through the
   in-app classifier (search 150ms/depth5), ~0.7s/move, writes
   `data/human-games-labelled.json`. Fields per move: `{i, san, mover,
   isHuman, rotation, evalW (cp, White perspective, AFTER the move), cpl,
   cls, isMate, timestamp}`.
3. Training set = human moves only (`isHuman && !rotation`).
Features that exist without new plumbing: material balance, game phase
(ply), last opponent move kind (capture? — join `move.kind` from the raw
dump by index like `report-r15.mjs` does), was there a rotation in the last
2 plies, eval before the move, number of legal moves (recompute via
`generateLegalMoves` from `src/engine/moves`).
Model: start with a hand-tuned "humanlike score" = engine score + bonuses
(captures over quiet moves, queen moves early, penalise long quiet lines),
validated against the labelled corpus: metric = top-1/top-3 agreement with
the actual human move. Only reach for real ML (tfjs is already a dependency)
if the heuristic tops out below ~30% top-3.
Integration points (both already have seams):
- hard guess mode: model's predicted move as an extra arrow — the vote/arrow
  machinery lives in `src/twitch/moveVoting.ts` + variant-arrow rendering in
  `App.tsx` (search `variant-overlay`).
- humanlike bot: bot samples the "most human" move at some temperature —
  bot move selection is in `src/ai/` (entry: `searchPosition` callers).
Accept: a script `scripts/eval-predictor.mjs` printing top-1/top-3 accuracy
on a held-out 20% of games, and the number beats "always engine best move"
baseline on top-3.

### T5 — bot flavours from self-play corpus (independent of T4)
`data/training-games-dump.json` = 4807 self-play games, every move has
`searchScore` (cp, White perspective). Mine "typical trap" positions: moves
where the score swings >= 300cp within the first 10 full moves. Cluster by
motif (which piece moved, capture or not). Output: a list the bot can use to
prefer lines humans typically fumble ("punishes typical mistakes" level).
This is exploratory — timebox a day, write findings into
R15-DATA-FINDINGS.md before building anything into the bot.

### T6 — pipeline rerun cadence
Every few weeks (or before any data decision):
```
node scripts/dump-games.mjs
node scripts/dump-training-games.mjs            # training_games
node scripts/dump-training-games.mjs game_starts
node scripts/inventory-games.mjs                # field coverage table
npx tsx scripts/label-human-games.ts            # ~35 min for 3k moves
node scripts/report-r15.mjs                     # the three reports
```
`data/` is gitignored (contains playerIds, 40+ MB). Never commit dumps.

## 4. Gotchas a weaker model WILL hit (read carefully)

- **Firestore evals**: `/games` docs have NO move evals — `serializeGameLog`
  in `src/firebase/games.ts` strips them on purpose. Always recompute via
  `scripts/label-human-games.ts`. `/training_games` DOES store `searchScore`.
- **App.tsx is ~4200 lines with ordering traps.** Hooks reference
  block-scoped consts declared mid-file; an effect placed above
  `positionLabel` (line ~3860) fails `tsc` with TS2448 "used before
  declaration". Place new effects near similar ones (R5 encouragement block)
  and run `npx tsc -b` after EVERY App.tsx edit.
- **Move parity**: solo human is always White (`HUMAN_COLOR` const). Even
  ply index = human's action — but ONLY in classic; roulette has a
  2-actions-per-turn economy that breaks parity. Gate parity logic to
  `gameMode === 'classic'`.
- **Running TS scripts**: `npx tsx scripts/<file>.ts` (imports are
  extensionless; plain `node` won't resolve them). Plain `.mjs` scripts run
  with `node` directly.
- **Firebase access from Node**: `/games` is world-readable; `training_games`
  and `game_starts` need `signInAnonymously` (see
  `scripts/dump-training-games.mjs` — it takes a collection name argument).
- **Browser verification in this env**: screenshots often time out and
  `read_page` ref coordinates go stale after the board resizes — clicks then
  hit the wrong tile SILENTLY. Verify by driving the DOM with
  `javascript_tool` (`button.click()`) and asserting on `MOVES (n)` text and
  `.toast-container` content instead of pixels.
- **House style**: no em-dashes in user-facing strings; no AI/co-author
  attribution in commits; commit messages `feat(r15-x): ...`; everything on
  `main`; commit before each stage.
- **Toast API**: `toast.show(text, 'info', ms)` via `useToast` in App. For
  one-shot-per-game beats dedupe with a `useRef` holding `log.id` (see
  `earlyTipLogIdRef` / `rotateTipLogIdRef`).
- **StatsPage**: two independent loaders (`loadHumanStats` over `/games`,
  `loadStats` over `/training_games`); human block renders only when its
  load succeeded, so a rules change can't blank the page.

## 5. Definition of done for R15 as a whole

- [x] Inventory + dumps reproducible by script
- [x] Funnel / first-blunder / rotate reports with real numbers
- [x] Public stats page fed by live data
- [x] Coaching reacts to where players actually fail (moves 2-10, post-rotate)
- [ ] Abandonment measurable end-to-end (blocked on rules deploy -> T1 -> T2)
- [ ] Predictor decision revisited at ~500 human games (T4)
