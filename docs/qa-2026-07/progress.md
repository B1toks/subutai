# QA Audit Progress — Kinetic Chess 960

_Independent QA pass. Final report saved as `final_report.md`._

Last updated: 2026-07-21 — **AUDIT COMPLETE**

## Legend
✅ done · ⏳ in progress · ❌ not started

---

## Setup ✅
Repo connected at `C:\projects\chess` (main). Engine in `src/engine/`; UI monolith `src/App.tsx`; PvP `src/firebase/` + `MultiplayerGameView.tsx`. No test framework; verified numeric claims via faithful JS ports run in Node 22.

## 1. Base chess logic ✅
- Movement, promotion (engine + dialog + notation round-trip all correct), check/mate/stalemate (incl. novel topology-toggle escape), threefold, 50-move — all correct.
- DEF-1 (MEDIUM): stale `enPassantTarget` survives rotation/pass — affects EP capture + repetition/zobrist identity.
- DEF-2 (MINOR): castling transit-square attack test doesn't remove king's shadow.
- DEF-3 (MINOR): insufficient-material table unsound under rotation.
- Reported rook→queen promotion bug: NOT reproducible in current code; documented auto-queen fallbacks (App L3520/3604) as likely historical source.

## 2. Chess960 specifics ✅
- DEF-4 (MEDIUM): knight double-index bug → **VERIFIED 544/960 reachable** (20k seeds), 57% hit rate, skewed knight distribution; all positions still legal.
- FromBackRankKey / validation correct. Castling after rotation behaves sanely (no defect).

## 3. Kinetic rotation ✅
- PASS: topology-B mapping is a **verified bijection** (64 cells, no collisions/gaps).
- PASS: rotation-into-illegal-king blocked at UI (solo + MP classic); back-to-back rotation blocked.
- DEF-5 (MEDIUM): legality is UI-only — engine `applyRotationMove` + MP tx don't re-validate.
- DEF-1 stale-EP also lands here. Zobrist topology-aware (PASS).

## 4. AI / UI layer ✅
- PASS: hint invalidated on rotation; threat overlays are state-derived memos; AI search handles rotation with guards; TT key includes topology.
- DEF-6 (MEDIUM): classifier worker has no cancel/superseding/debounce → backlog under rapid rotations.
- DEF-7 (MINOR): hint search runs on main thread (~800ms) → jank.

## 5. PvP shared state / sync ✅
- PASS: move transaction re-checks `currentTurn` inside tx → simultaneous-move race handled; log-replay model is deterministic/self-healing.
- DEF-8 (CRITICAL): Firestore rules let any participant rewrite entire match doc (log, currentTurn, outcome); no server-side move validation → cheating/forced-outcome/log corruption; affects leaderboard.
- DEF-9 (MEDIUM): MP rotation not re-validated (rolls into DEF-8).
- DEF-10 (MINOR/MED): auto-forfeit uses client clock vs server time.
- DEF-11 (MINOR): `training_games` world-writable.

## 6. Architecture + final_report.md ✅
- App.tsx ~264KB God component; no automated tests/CI; duplicated position-identity funcs; strong engine purity + deterministic MP replay.
- DEF-12 (MINOR): promotion dialog shows white glyphs for Black.
- **`final_report.md` written** with per-defect description/file-line/severity/repro/fix + priority table (1 critical, 5 medium, 6 minor).
