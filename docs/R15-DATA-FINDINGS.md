# R15 — data mining findings (2026-07-12, rev. 2026-07-20 solo-only)

Source: full offline dump of Firestore (`scripts/dump-games.mjs`,
`scripts/dump-training-games.mjs`), evals recomputed with the in-app
classifier at search budget 150ms / depth 5 (`scripts/label-human-games.ts`),
reports from `scripts/report-r15.mjs`. Dumps live in gitignored `data/`.

> **Rev. 2026-07-20 — PvP decontamination.** 38 of the 121 `/games` docs
> turned out to be PvP match records (`vsAI: false`, host-perspective), not
> human-vs-bot games. The labeller now skips them and every number below is
> recomputed over the **83 solo games** (77 with a first blunder). Biggest
> corrections: games over by move 10 are 40% (was 53% — PvP inflated the
> early bucket), comeback share of wins is **71%** (was 59%), median human
> rotation moved to move 11 (was 8). Directionally every conclusion
> survived.

## 0. What actually exists (inventory)

| collection | docs | what it is |
|---|---|---|
| `/games` | 121 | human vs AI, 18 players, 2026-05-13..07-09, ~3100 moves |
| `/training_games` | 4807 | bot SELF-PLAY (stage-j labelling run, 05-16..29), 337k moves with `searchScore` |
| `/matches` | 58 | multiplayer (38 completed, 35 with move logs) |

Key corrections to the R15 premise:

- The "5k games" are bot self-play, not humans. Human corpus = 121 games.
- `/games` stores **no evals** — `serializeGameLog` strips MoveAnalysis
  (`src/firebase/games.ts`). Recomputed offline for this report.
- Abandoned games never reach Firestore (save fires on completion only), so
  "quit vs lost" was unmeasurable. Fixed going forward: `logGameStart` ping
  writes one `/game_starts` doc on the human's first move (r15-1 commit).
  **Needs `firestore.rules` deploy before the pings land.**
- 121 human games spread over 73 distinct chess960 starts — opening positions
  almost never repeat, so a frequency-table "opening book" predictor has no
  data to stand on. Any human-move model must be feature-based.

## 1. Survival funnel (83 solo games with non-empty logs)

moveCount = full moves. Buckets x outcome:

| moves | human-win | ai-win | resign | total |
|---|---|---|---|---|
| 1-10 | 19 | 10 | 4 | **33 (40%)** |
| 11-20 | 10 | 14 | 3 | 27 |
| 21-30 | 1 | 13 | 1 | 15 |
| 31-40 | 1 | 3 | 1 | 5 |
| 41-50 | 1 | 0 | 0 | 1 |
| 50+ | 2 | 0 | 0 | 2 |

- **40% of games are over by move 10, 72% by move 20.** The early game is
  still the bulk of the product experience.
- "Survive 50 moves" is reached by **2% of games** (2/83). As a headline
  goal it is way too hard; either rebrand it as an epic achievement or add
  a nearer milestone (move 20 is already top-28% of games).
- Fast 1-10 wins skew roulette king-captures — fast wins are a roulette
  phenomenon, not classic chess skill.

## 2. First human blunder (cpl >= 250 at search d5)

- 77/83 games contain one; median arrival: **move 4** (p25 move 2, p75 move 6).
  69 of 77 first blunders happen inside moves 1-10.
- Average human cpl by phase: moves 1-10 -> 273cp, 11-20 -> 286cp,
  21-30 -> 244cp, 31+ -> 121cp. Players who survive get *better* (survivor
  bias, but the early-game error rate is the onboarding problem).
- What precedes the first blunder (2 plies before): quiet position 28,
  capture/exchange 23, **own rotation 19 (25%)**, bot rotation 7.
- Implications: hints/encouragement must target moves 2-6, not the midgame;
  the current -2.5 encouragement threshold is reachable by move ~5 for most
  players. A "careful, this is where most games are lost" cue in moves 3-8
  would hit the real failure window.

## 3. Rotation statistics

- 84 human rotations, 75 bot rotations across 83 solo games.
  Median rotation happens at move 11.
- Eval delta for the side that rotates (search eval, own perspective,
  n=68 human rotations with a prior eval): mean **-224cp**, median -70cp.
  Improved (>+50cp): 4. Worsened (<-50cp): 39.
- Bot rotations: mean -129cp, median -7cp (8 improved / 25 worsened).
- Reading: "a simple rotate changes everything" is TRUE — the eval swing is
  huge — but for the person rotating it is overwhelmingly a *negative* swing
  at engine depth 5. Rotation is a chaos move, not a rescue move, at least
  by shallow-engine judgement. The "rotate might save you" encouragement line
  oversells it; "rotate changes everything, for both of you" is the honest
  marketing line. Caveats: evals across a topology flip are noisy, n is small,
  and a losing player may rationally prefer variance even at eval cost.
- 19 of 77 first-blunders (25%) directly follow the player's own rotation —
  rotating and then not re-reading the new board is a recognizable failure
  pattern worth a tutorial beat ("after you rotate, re-check your hanging
  pieces"). Shipped as the r15-4lite post-rotate toast.

## 4. Comebacks / encouragement threshold

- Of 34 solo human wins, **24 (71%) passed through <= -2.5 pawns** at some
  point. Comebacks are the NORM here, not the exception — the encouragement
  system's premise ("players in -2.5 holes can still win") is confirmed by
  data, and this is a strong marketing stat ("71% of wins came back from
  dead").

## 5. Self-play trap mining (T5, 2026-07-13, `scripts/mine-traps.mjs`)

Definition: a "fumble" = a move in the first 10 full moves whose eval swing is
>= 300cp AGAINST the mover (searchScore labels, stage-j self-play, n=4807 games).

- 7532 early fumbles in 2660 games (55% of games have one). Volume rises
  monotonically move 1 -> 10 (31 -> 1321): more contact, more traps.
- **Fumbled-move motifs:** quiet pawn pushes lead (2014), then knight moves
  (1247 quiet + 864 captures = 2111 total — the knight is the #1 piece-level
  trap source). Queen moves fumble 841 times combined.
- **Punishing replies:** knight capture is the top punishing motif (1198),
  then pawn capture (805). Knights punish; pawns collect.
- **Rotation contrast (the headline):** only 3% of engine fumbles follow a
  rotation within 2 plies (244 vs 7288) — but **25% of human first blunders
  do** (19/77, §2). Rotation-blindness is a *human-specific* failure mode:
  the engine re-reads the rotated board perfectly, people don't. This both
  justifies the post-rotate coaching beat (shipped in r15-4lite) and suggests
  a dirty-but-honest bot flavour: rotating more often against humans is a
  legitimate difficulty lever that costs the engine ~nothing.
- Fumble-prone starts cluster around cramped knight corners
  (NBRQBKRN 112, BBQRKRNN 95, QBBRKRNN 88, ...). A "trappy" daily-challenge
  start can be picked straight from this table.
- Caveat: self-play blunders come from the engine's own noise/depth limits,
  not human psychology — treat motifs as "where the position is sharp", not
  "what humans do wrong". The human-side ground truth is §2.

Bot-flavour recommendations derived (NOT implemented):
1. "Punisher" difficulty: bias the bot toward sharp lines (knight contact,
   capture-rich positions) in moves 4-10 where the fumble density peaks.
2. Rotation pressure: raise bot rotation frequency vs humans — humans blunder
   after rotations, the bot does not.
3. Daily trap start: seed the day's chess960Id from the fumble-prone table.

## Where this leaves the R15 plan

- Step 0 (dump+inventory): DONE. Step 1 (analytics): DONE (this doc).
- Step 2 (public stats): DONE — /?stats=1 now opens with player-facing hero,
  hall of numbers and the survival funnel, live from /games.
- Step 3 (human-move predictor): the frequency-book v0 is dead on arrival
  (73 distinct starts / 121 games). Options: (a) feature-based v1 on ~1550
  human moves + 35 MP logs now, accepting weak accuracy; (b) defer until
  /game_starts + more traffic grow the corpus, revisit at ~500 human games.
- Step 4 (humanlike bot / smarter hints): the self-play corpus + blunder map
  already support "punishes typical early mistakes" bot flavour and
  move-3-8 hint timing without any ML.
