# R15 — data mining findings (2026-07-12)

Source: full offline dump of Firestore (`scripts/dump-games.mjs`,
`scripts/dump-training-games.mjs`), evals recomputed with the in-app
classifier at search budget 150ms / depth 5 (`scripts/label-human-games.ts`),
reports from `scripts/report-r15.mjs`. Dumps live in gitignored `data/`.

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

## 1. Survival funnel (118 games with non-empty logs)

moveCount = full moves. Buckets x outcome:

| moves | human-win | ai-win | resign | total |
|---|---|---|---|---|
| 1-10 | 37 | 13 | 13 | **63 (53%)** |
| 11-20 | 11 | 15 | 3 | 29 |
| 21-30 | 3 | 13 | 1 | 17 |
| 31-40 | 1 | 3 | 1 | 5 |
| 41-50 | 2 | 0 | 0 | 2 |
| 50+ | 2 | 0 | 0 | 2 |

- **53% of games are over by move 10.** The early game is the entire product
  experience for most players.
- "Survive 50 moves" is reached by **2% of games** (2/118... wins at 50+ do
  exist but are unicorns). As a headline goal it is way too hard; either
  rebrand it as an epic achievement or add a nearer milestone (move 20 is
  already top-40% of games).
- Half the 1-10 bucket wins are roulette king-captures — fast wins are a
  roulette phenomenon, not classic chess skill.

## 2. First human blunder (cpl >= 250 at search d5)

- 98/118 games contain one; median arrival: **move 4** (p25 move 2, p75 move 6).
  92 of 98 first blunders happen inside moves 1-10.
- Average human cpl by phase: moves 1-10 -> 272cp, 11-20 -> 289cp,
  21-30 -> 258cp, 31+ -> 130cp. Players who survive get *better* (survivor
  bias, but the early-game error rate is the onboarding problem).
- What precedes the first blunder (2 plies before): quiet position 34,
  capture/exchange 28, **own rotation 25**, bot rotation 11.
- Implications: hints/encouragement must target moves 2-6, not the midgame;
  the current -2.5 encouragement threshold is reachable by move ~5 for most
  players. A "careful, this is where most games are lost" cue in moves 3-8
  would hit the real failure window.

## 3. Rotation statistics

- 110 human rotations, 94 bot rotations across 118 games (84 games have >= 1).
  Median rotation happens at move 8.
- Eval delta for the side that rotates (search eval, own perspective,
  n=89 human rotations with a prior eval): mean **-277cp**, median -89cp.
  Improved (>+50cp): 3. Worsened (<-50cp): 54.
- Bot rotations: mean -206cp, median -20cp (7 improved / 36 worsened).
- Reading: "a simple rotate changes everything" is TRUE — the eval swing is
  huge — but for the person rotating it is overwhelmingly a *negative* swing
  at engine depth 5. Rotation is a chaos move, not a rescue move, at least
  by shallow-engine judgement. The "rotate might save you" encouragement line
  oversells it; "rotate changes everything, for both of you" is the honest
  marketing line. Caveats: evals across a topology flip are noisy, n is small,
  and a losing player may rationally prefer variance even at eval cost.
- 25 first-blunders directly follow the player's own rotation — rotating and
  then not re-reading the new board is a recognizable failure pattern worth a
  tutorial beat ("after you rotate, re-check your hanging pieces").

## 4. Comebacks / encouragement threshold

- Of 56 human wins, **33 (59%) passed through <= -2.5 pawns** at some point.
  Comebacks are the NORM here, not the exception — the encouragement system's
  premise ("players in -2.5 holes can still win") is confirmed by data, and
  this is a strong marketing stat ("59% of wins came back from dead").

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
