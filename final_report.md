# Kinetic Chess 960 — Independent QA Audit

**Auditor:** Claude (independent tester)
**Date:** 2026-07-21
**Scope:** `src/engine/**`, `src/ai/**`, `src/analysis/**`, `src/App.tsx`, `src/components/MultiplayerGameView.tsx`, `src/firebase/**`, `firestore.rules`
**Branch:** `main` (commit `c62f49f`)
**Method:** Full source read of the engine + UI/sync layers, plus two numerical verifications via faithful JS ports of the exact engine functions (no npm registry available in the sandbox, so I ported `chess960.ts` and `auxetic.ts` line-for-line and executed them in Node 22).

---

## Executive summary

The **engine core is genuinely good**: pure, immutable, dependency-free, and topology-aware throughout. The kinetic coordinate remap — the most fragile-sounding part of the design — is mathematically sound (verified bijection). The multiplayer move pipeline uses real Firestore transactions with in-transaction turn re-checks, so the classic "both players move at once" race is handled correctly.

The defects cluster in three places: (1) a **Chess960 generator bug** that makes 43% of positions unreachable, (2) a **client-authoritative trust model** in multiplayer (Firestore rules let any participant rewrite the whole match doc, including the move log and outcome), and (3) **a stale en-passant marker that survives a rotation**. None of these crash the app; all are correctness/integrity issues.

On the specifically-flagged **"rook promotes to queen" bug: I could not reproduce it in the current code.** The engine, the promotion dialog, and the notation round-trip all preserve the chosen piece. See DEF-9 for where it plausibly lived and the auto-queen fallbacks that remain.

**Counts:** 1 critical, 5 medium, 6 minor.

---

## 1. Base chess logic

### DEF-1 — Stale `enPassantTarget` survives rotation / pass moves  — **MEDIUM**
**File:** `src/engine/auxetic.ts` L275-298 (`applyRotationMove`, `applyPassMove`)
`applyMove` recomputes `enPassantTarget` on every move (null unless a fresh double-push). But `applyRotationMove` and `applyPassMove` only spread `...state` and override `topologyState`/`sideToMove`/clocks/`lastMoveWasRotation` — **they never clear `enPassantTarget`**. So the marker set by a double-push in topology A is carried across a rotation.

**Consequences (two):**
1. **Phantom en-passant capture.** After `1. e4` (EP target `e3`, Black to move), Black rotates. Now White is to move in topology B with `enPassantTarget` still `e3`. If any White pawn's capture target in the B-geometry equals `e3`, `generatePawnMoves` (`moves.ts` L535-541) emits an `enPassant` move; `applyMove` then removes `capturedSquare = to[0] + from[1]` (`moves.ts` L683) — a wrong/empty square. Narrow but reachable.
2. **Polluted position identity.** `positionSignature` (`board.ts` L50) and `zobristHash` (`zobrist.ts` L94-97) both fold in the EP target. The rotation's recorded signature carries a stale `e3`, so two positions that are truly identical can hash differently → threefold repetition can be missed.

**Repro:** In topology A, double-push a pawn; on the reply, call `applyRotationMove`; inspect `state.enPassantTarget` — it is still set, whereas after any normal reply it would be `null`.
**Fix:** In both `applyRotationMove` and `applyPassMove` add `enPassantTarget: null`. (En passant is intentionally A-only, so clearing it on a topology change is always correct.)

### DEF-2 — Castling transit-square attack test doesn't remove the king's own shadow  — **MINOR**
**File:** `src/engine/moves.ts` L443-445 (`generateCastlingMoves` → `trySide`)
Transit squares are tested with `isSquareAttacked(state, sq, enemy, topology)` on the pre-castling position **with the king still on its origin**. In FRC layouts where the king moves along a rank that a friendly-blocked enemy slider looks down, the king can block the attacker to its own transit square and be wrongly allowed to castle through check. Standard engines mask out the moving king first. Rare, but a real correctness edge in 960.
**Fix:** Evaluate transit-square attacks on a copy with the king square emptied (or test each transit square with the king virtually removed).

### DEF-3 — `isInsufficientMaterial` assumes non-kinetic geometry  — **MINOR / design**
**File:** `src/engine/moves.ts` L239-270
K+B vs K and K+N vs K are declared draws. Under rotation a "bad" bishop or a lone knight can reach squares it never could in standard chess, so forced-mate reasoning behind the standard insufficient-material table doesn't strictly hold. Low practical impact; document it or gate the check behind topology A.

**Passing checks in this section:** piece movement (topology-aware rays in `auxetic.ts`), promotion move generation (`moves.ts` L499-514 emits all four pieces with correct `promotion`), threefold (`test-mp-draws.ts` asserts it, history resets on irreversible moves), 50-move (`halfmoveClock >= 100`), the novel "escape check by toggling topology" rule (`canEscapeViaToggle`, `moves.ts` L192-217).

---

## 2. Chess960-specific

### DEF-4 — Knight-placement double-indexing → only 544 of 960 positions reachable  — **MEDIUM**
**File:** `src/engine/variants/chess960.ts` L34-40
```ts
const idx = knightCandidates[randomInt(knightCandidates.length - i, seed)]; // idx is a FILE VALUE
knightIndexes.push(knightCandidates[idx]);   // indexes AGAIN by a value → often undefined
knightCandidates.splice(idx, 1);             // splices by a value, not the drawn position
```
`randomInt` returns a *position*; the code then treats `knightCandidates[position]` (a file value) as a second index. `idx` frequently exceeds the array length, so `knightCandidates[idx]` is `undefined` and `splice(idx,1)` removes nothing.

**Why it doesn't crash:** the final placement loop (L55-73) derives knights as the *fallback* type, so piece counts are always right and every generated position is legal. The damage is to *coverage and fairness*: because `occupied` is missing the knight files, `rookKingCandidates` keeps extra entries and rook/king always take the three lowest files — knights get pushed to the right.

**Verified numerically (20,000 seeds, port of the exact function):**
- distinct back ranks produced: **544 / 960** (43% unreachable)
- undefined knight index occurred in **11,421 / 20,000 (57%)** of generations
- knight file histogram a→h: **27.4% 14.0% 15.4% 14.0% 16.4% 25.4% 37.8% 49.5%** (uniform would be ~25% each; instead h-file 49.5%, b-file 14%)
- **invalid positions: 0** (bishops always opposite colors, king always between rooks, counts always correct)

**Repro:** `for (let s=1;s<=20000;s++) generate(s)`, collect distinct back-rank strings → 544. Full harness kept at `/outputs/verify.mjs` from the audit run.
**Fix:** draw by position, not value:
```ts
const pos = randomInt(knightCandidates.length, seed);
const file = knightCandidates[pos];
knightIndexes.push(file);
knightCandidates.splice(pos, 1);
```

**Passing:** `chess960FromBackRankKey` and `isValidChess960Key` (L93-161) are correct and clean — explicit-key games (and multiplayer, which uses the back-rank key) are unaffected. The bug only touches seed-based random generation.

### Castling after rotation ("broken rows")
Castling anchors are stored as absolute squares in `castlingRights` and matched against the king's `kingStartSquares`. `generateCastlingMoves` reads live piece positions, so a rotation that scrambles the back rank simply makes castling unavailable that turn (paths blocked / king not on its start), which is the correct outcome. No defect found; behaves sanely.

---

## 3. Kinetic rotation (2×2 segments)

### PASS — Coordinate remap is a verified bijection
**File:** `src/engine/auxetic.ts` L38-75 (`getSquarePosition` topology B), L148-187 (`getPhysicalMapB`, `stepInDirection`)
Ported `getSquarePosition('B')` and mapped all 64 squares to physical cells: **64 distinct cells, 0 collisions, 0 empty cells, all integer, all in range → bijection OK.** Sliding rays, knight jumps and pawn steps all route through `stepInDirection` on this map, so attack/threat lines recompute correctly after a rotation. This is the part most likely to be broken in a project like this, and it's solid.

### PASS — Rotation that would leave the king in check is blocked (classic)
**File:** `src/App.tsx` L2376-2388 (MP classic) and L2404-2407 (solo classic); helper `rotateIsLegal` L309-316
Both the solo and the MP-classic rotate paths toggle a scratch copy, find the mover's king, and refuse the rotation if the king would be attacked. Back-to-back rotation is also blocked (`state.lastMoveWasRotation`, L2363). The "rotation makes the king's position illegal" edge case is handled here. (Roulette mode intentionally allows self-check — it's a capture-the-king variant.)

### DEF-5 — Rotation legality is UI-only; engine + sync don't re-validate  — **MEDIUM**
**Files:** `src/engine/auxetic.ts` L286-298; `src/components/MultiplayerGameView.tsx` `sendMove` L272-368 / `sendRotate` L371-419
`applyRotationMove` performs the flip unconditionally — no king-safety guard lives in the engine. The only guard is in `handleRotate` (App). The MP write path (`sendMove({kind:'topologyToggle'})`) does **not** re-run the king-safety or back-to-back check inside the transaction, and `rebuildBoardFromMatch` (L114-125) applies stored toggles blindly. So a modified/buggy client can submit an illegal rotation and the opponent will replay it. This is the rotation-specific instance of the broader trust gap (DEF-6).
**Fix:** Move the legality check into the engine (`applyRotationMove` returns `null`/throws on illegal), and re-validate inside the Firestore transaction before appending the toggle.

**"Rotation during check / mid-move":** rotation is only offered on the human's turn with no piece mid-selection (`handleRotate` early-returns unless `currentPlayer === 'human'`); selection state is cleared on commit. No inconsistent-state path found.

---

## 4. AI / UI layer (arrows, highlight, analysis)

### PASS — Hints/threat overlays refresh on rotation
Hint is invalidated whenever topology changes (`App.tsx` L2162-2164 effect keyed on `state.topologyState`). Threat/king-danger overlays are `useMemo`s derived from `state` (e.g. L1665-1671), so they recompute on every board change. The AI search itself considers rotation as a candidate move with proper king-safety + no-back-to-back guards (`ai/search.ts` L180-186), and the Zobrist/TT key includes the topology bit (`zobrist.ts` L93) so A/B positions don't collide in the transposition table.

### DEF-6 — Classifier worker has no cancellation/superseding under rapid rotations  — **MEDIUM**
**File:** `src/analysis/classifyClient.ts` (whole file); consumers in `App.tsx` (`classifyAsync(...)`, e.g. L3792)
A single worker processes messages **serially, FIFO**, keyed by a monotonic id, with **no debounce and no way to drop superseded requests**. Each classify runs a search up to its `budgetMs` (commonly ~1000 ms). Rapid successive rotations/moves enqueue one ~1s job each; the worker falls behind, arrows/eval land late, and stale jobs still run to completion before newer ones start. Per-move results are keyed by `moveIdx` so they don't paint the *wrong* move, but the backlog is a real responsiveness problem exactly in the "spam the rotate button" scenario the design invites.
**Fix:** track a `latestRequestId`; when a newer request is posted, reject/ignore the resolution of older ones (or `terminate()` + recreate the worker to hard-cancel), and debounce classify calls (~150 ms).

### DEF-7 — `computeHint` / `searchPosition` run on the main thread  — **MINOR**
**File:** `src/App.tsx` L2295-2330 (`searchPosition` with `budgetMs: 500`, plus a second 300 ms probe for the rotation line)
Hint computation is synchronous on the UI thread — up to ~800 ms of search per invocation. Rapid input can jank the render. Consider moving hint search onto the existing worker or lowering the budget on interaction.

---

## 5. PvP shared state / synchronization

### PASS — Simultaneous-move race is correctly handled
`sendMove` (`MultiplayerGameView.tsx` L321-355) wraps the write in `runTransaction`, **re-reads `currentTurn` inside the transaction** (L326), and appends to `log.moves` off the freshly-read doc. Two clients cannot both append; the loser throws `NOT_YOUR_TURN`. The board is fully re-derived from the log on every snapshot (`rebuildBoardFromMatch`), so state is deterministic and self-healing across reconnects. This is the right architecture.

### DEF-8 — Firestore rules allow any participant to rewrite the entire match doc; no server-side move validation  — **CRITICAL**
**File:** `firestore.rules` L83-90 (`/matches/{code}` `allow update`)
```
allow update: if request.auth != null && (
  resource.data.host.uid == request.auth.uid
  || (resource.data.guest != null && resource.data.guest.uid == request.auth.uid)
  || ...claim path...
);
```
Any authenticated participant may write **any field to any value** — `log.moves`, `currentTurn`, `outcome`, clocks, even the opponent's participant record. There is no validation that: it's the writer's turn, the appended move is legal, only one move was appended, or `outcome` matches the board. The client-side transaction guards are **cooperative only** and a custom client bypasses them entirely. A player can force a win (`outcome`), rewrite history, move on the opponent's turn, or corrupt the shared log (which then desyncs *both* clients, since both replay the same poisoned log). Because completed games feed the leaderboard (`src/firebase/leaderboard.ts`, `games.ts`), this is also a competitive-integrity hole.
**Repro:** As guest, `updateDoc(matches/CODE, { outcome: 'guest-win', status: 'completed' })` on someone else's turn — the rules permit it.
**Fix:** This is genuinely hard to do fully in Firestore rules (chess legality can't be expressed there). Realistic options: (a) constrain updates in rules to append-only single-element `log.moves` growth + turn ownership + immutable `host`/`outcome`-except-via-resign, and (b) move authoritative move validation to a Cloud Function / trusted server that owns `currentTurn` and `outcome`. At minimum, lock down `outcome`, `currentTurn`, and opponent fields.

### DEF-9 — Multiplayer rotation not re-validated server/tx-side  — **MEDIUM**
Same root as DEF-5, surfaced through the sync layer: MP rotations ride through `sendMove`/`sendRotate` without a transaction-side legality check, so an injected illegal rotation replays on the opponent. Rolled up under DEF-8's fix (server-authoritative validation).

### DEF-10 — Auto-forfeit compares client `Date.now()` to server `lastActivity`  — **MINOR/MEDIUM**
**File:** `src/components/MultiplayerGameView.tsx` L199-224
The waiting peer measures `Date.now() - lastActivity.toMillis()` and writes a forfeit past a threshold. `Date.now()` is the local wall clock; `lastActivity` is a server timestamp. A waiting peer whose clock runs fast can forfeit a live opponent early (or a slow clock delays a legitimate forfeit). The in-transaction re-check (L212-218) narrows but doesn't eliminate the window.
**Fix:** Derive elapsed time from server time (e.g. a `serverTimestamp()` heartbeat compared server-side, or Firestore's `request.time` in a Function), not the client clock.

### DEF-11 — `training_games` world-writable  — **MINOR**
**File:** `firestore.rules` L44-48 — `allow create: if true;` lets unauthenticated clients write arbitrary training-game docs (spam/abuse vector). Gate on `request.auth != null` at least.

---

## 6. Architecture / fragility

- **`App.tsx` is a ~264 KB / ~5,500-line God component** holding the entire solo game loop, roulette mode, MP glue, analysis orchestration, audio, Twitch, and UI. Dozens of interacting `useState`/`useRef` values with subtle ordering constraints (comments repeatedly note "so hook order stays stable"). This is the single biggest maintainability risk and where regressions like the reported promotion bug hide. Recommend extracting the solo game reducer into the engine layer and splitting MP/roulette/analysis into hooks.
- **No automated test suite / CI.** The only checks are ad-hoc scripts (`scripts/repro960.ts`, `scripts/test-mp-draws.ts`) that require `npx tsx` and aren't wired to `npm test`. The engine is pure and eminently unit-testable — the bugs above (DEF-1, DEF-4) would be caught by a handful of tests. Add Vitest + a CI gate.
- **Two position-identity functions** (`positionSignature` in `board.ts` and `zobristHash` in `zobrist.ts`) both fold in EP target, so the DEF-1 stale-EP leak affects both repetition detection and TT keying. Fixing DEF-1 resolves both.
- **Positives worth preserving:** engine purity/immutability, deterministic log-replay model for MP, topology-aware Zobrist, transaction-guarded turn handoff.

### DEF-12 — Promotion piece selector renders white glyphs for both colors  — **MINOR (cosmetic)**
**File:** `src/App.tsx` L5414 — the promotion dialog always renders `glyphForPiece('white', type)`, so Black's promotion picker shows white pieces. Cosmetic only; the committed piece is correct.

---

## On the reported "rook → queen" promotion bug

I traced every promotion path and **could not reproduce it in the current code**:
- Engine `applyMove` uses `move.promotion` verbatim (`moves.ts` L718-720) — not hardcoded to queen.
- Move generation emits all four promotion pieces (`moves.ts` L496-514).
- Solo dialog → `handlePromotion(type)` matches on `m.promotion === pieceType` and commits that move (`App.tsx` L3758-3766, dialog L5406-5418).
- SAN serialize (`computeSAN`, `recording/log.ts` L47-48 → `=R`) and parse (`memory/notation.ts` L23-25, L65-70) round-trip the piece correctly.

**Where it plausibly lived / still-present auto-queen fallbacks** (candidate regressions to watch): the roulette and MP-fallback paths force queen when a promotion move arrives without a `promotion` field —
`App.tsx` L3520-3521, L3604-3605 (`move.kind === 'promotion' && !move.promotion ? { ...move, promotion: 'queen' }`). These are intentional for roulette's uninterrupted multi-action flow, but if any caller ever routes a *classic* promotion through them without first setting the piece, it would silently become a queen. If the bug is still observed in classic solo, it is not in the code paths above and may already be fixed; I'd want a concrete repro (960 key + move list) to bisect further.

---

## Priority table

| ID | Defect | Area | Severity | Fix effort |
|----|--------|------|----------|-----------|
| DEF-8 | Match doc fully rewritable; no server-side move validation | PvP / security | **Critical** | High |
| DEF-4 | Chess960 knight bug → 544/960 reachable, biased | Chess960 | Medium | Low |
| DEF-1 | Stale `enPassantTarget` survives rotation/pass | Engine / rotation | Medium | Low |
| DEF-6 | Classifier worker: no cancel/debounce under rapid rotations | AI/UI perf | Medium | Medium |
| DEF-5 | Rotation legality UI-only, not engine/tx-enforced | Rotation / sync | Medium | Medium |
| DEF-9 | MP rotation not re-validated (rolls into DEF-8) | PvP | Medium | Medium |
| DEF-10 | Auto-forfeit uses client clock vs server time | PvP | Minor/Med | Medium |
| DEF-2 | Castling transit check ignores king's own shadow | Engine | Minor | Low |
| DEF-3 | Insufficient-material unsound under rotation | Engine | Minor | Low |
| DEF-7 | Hint search on main thread (jank) | AI/UI perf | Minor | Low |
| DEF-11 | `training_games` world-writable | Security | Minor | Low |
| DEF-12 | Promotion dialog shows white glyphs for Black | UI cosmetic | Minor | Low |

**Recommended order:** DEF-8 (integrity) → DEF-4 + DEF-1 (quick, high-value correctness one-liners) → DEF-6/DEF-5 → the rest. Add a Vitest suite alongside DEF-4/DEF-1 so these don't regress.
