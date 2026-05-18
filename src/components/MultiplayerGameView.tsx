import { useEffect, useMemo, useRef, useState } from 'react';
import {
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase/client';
import {
  subscribeMatch,
  type MatchDoc,
  type MatchOutcome,
} from '../firebase/matches';
import {
  createPositionFromBackRankKey,
  type BoardState,
  type Move,
  type PieceType,
} from '../engine';
import { applyMove } from '../engine/moves';
import { applyRotationMove } from '../engine/auxetic';
import { computeSAN } from '../recording/log';

const ROULETTE_PIECE_BAG: PieceType[] = [
  'pawn',
  'knight',
  'bishop',
  'rook',
  'queen',
  'king',
];
/** Match solo App.tsx constants: 4 slots per spin, 2 actions per turn. */
const ROULETTE_SLOT_COUNT = 4;
const ROULETTE_MAX_ACTIONS = 2;

/** Roll a 4-element slot bag from the active player's remaining piece
 *  types, mirroring solo App.tsx spinRoulette() including the early-game
 *  pawn bias. Returns null when the player has no pieces (game over). */
function rollRouletteBag(
  state: BoardState,
  side: 'white' | 'black',
  pawnBoost: boolean,
): PieceType[] | null {
  const present = new Set<PieceType>();
  for (const sq of Object.keys(state.pieces) as Array<keyof typeof state.pieces>) {
    const p = state.pieces[sq];
    if (p && p.color === side) present.add(p.type);
  }
  const active = ROULETTE_PIECE_BAG.filter((t) => present.has(t));
  if (active.length === 0) return null;
  const pool: PieceType[] =
    pawnBoost && active.includes('pawn') ? [...active, 'pawn'] : active;
  const out: PieceType[] = [];
  for (let i = 0; i < ROULETTE_SLOT_COUNT; i++) {
    out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out;
}

/** Find the first slot index whose type matches `moverType` AND isn't
 *  already in `used`. Returns -1 if none available — mirrors solo
 *  consumeSlotIndex semantics. */
function consumeSlotIndex(
  bag: PieceType[],
  used: number[],
  moverType: PieceType,
): number {
  for (let i = 0; i < bag.length; i++) {
    if (bag[i] === moverType && !used.includes(i)) return i;
  }
  return -1;
}

const OPPONENT_OFFLINE_WARN_MS = 60_000;
const OPPONENT_OFFLINE_FORFEIT_MS = 90_000;

export interface MultiplayerSyncHandle {
  matchState: MatchDoc;
  boardState: BoardState;
  /** uid of the seat I occupy in this match. */
  myUid: string;
  myColor: 'white' | 'black';
  opponentDisplayName: string;
  isMyTurn: boolean;
  isHost: boolean;
  /** Stage T1: warning shown to the player who's ON the clock and idle.
   *  The opponent (waiting peer) still runs the silent forfeit watchdog. */
  selfAfkWarning: boolean;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  sendMove: (move: Move) => Promise<void>;
  /** Q.D.3: rotate as a roulette action. Topology toggle costs an
   *  action but doesn't consume a slot. */
  sendRotate: () => Promise<void>;
  resign: () => Promise<void>;
  /** Race-safe terminal-outcome write (mate/draw detected locally). */
  writeOutcomeIfFirst: (outcome: MatchOutcome) => Promise<void>;
  // Q.D.3: full solo-roulette parity. The bag, action count and used
  // slot indices live on the match doc so both peers can render the
  // SAME chip strip + Spin button + slot-consumption UI as solo.
  isRouletteMode: boolean;
  rouletteSlots: PieceType[] | null;
  rouletteActionsLeft: number;
  usedRouletteSlots: number[];
  /** How many spins I've personally completed in this match. Used to
   *  gate the first one behind a manual click (subsequent auto-fire). */
  mySpinCount: number;
  /** Spin a new 4-slot bag from my remaining piece types. */
  spinRoulette: () => Promise<void>;
}

/** Rebuild the canonical board from the log. Topology toggles (Rotate)
 *  flow through here just like any other move (Stage T1). */
export function rebuildBoardFromMatch(match: MatchDoc): BoardState {
  let state = createPositionFromBackRankKey(match.chess960Id);
  for (const entry of match.log.moves) {
    if (entry.move.kind === 'topologyToggle') {
      state = applyRotationMove(state);
      continue;
    }
    if (!entry.move.from || !entry.move.to) continue;
    state = applyMove(state, entry.move);
  }
  return state;
}

/**
 * Subscribes to /matches/{code} and exposes the live doc + write helpers.
 * Returns null when no match is active so App can short-circuit the
 * single-player path without conditionally calling hooks.
 *
 * Invariants:
 *  - The hook is always called; pass `null` when no match is active.
 *  - All write helpers throw if called before activeMatch is set.
 *  - Auto-forfeit fires only on the WAITING peer (whoever isn't on move),
 *    so the disconnected side never races with itself.
 */
export function useMultiplayerSync(
  activeMatch: MatchDoc | null,
  myUid: string | null,
  onMatchEvicted: () => void,
): MultiplayerSyncHandle | null {
  const [matchState, setMatchState] = useState<MatchDoc | null>(activeMatch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selfAfkWarning, setSelfAfkWarning] = useState(false);

  // Reset internal state when the parent swaps matches (or clears).
  useEffect(() => {
    setMatchState(activeMatch);
    setError(null);
    setSelfAfkWarning(false);
  }, [activeMatch?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  const code = activeMatch?.code ?? null;
  const evictedRef = useRef(onMatchEvicted);
  evictedRef.current = onMatchEvicted;

  // Realtime subscription.
  useEffect(() => {
    if (!code) return;
    const unsub = subscribeMatch(code, (doc) => {
      if (!doc) {
        evictedRef.current();
        return;
      }
      setMatchState(doc);
    });
    return unsub;
  }, [code]);

  // Stage T1: warning shown to the player WHO IS ON THE CLOCK and idle.
  // Helps the active peer notice they need to move; the waiting peer
  // shouldn't be nagged about themselves (they're already not on turn).
  useEffect(() => {
    if (!matchState || !myUid) return;
    if (matchState.status !== 'active' || matchState.outcome) return;
    if (matchState.currentTurn !== myUid) {
      setSelfAfkWarning(false);
      return;
    }
    const interval = setInterval(() => {
      const last = matchState.lastActivity?.toMillis?.();
      if (typeof last !== 'number') return;
      const elapsed = Date.now() - last;
      setSelfAfkWarning(elapsed >= OPPONENT_OFFLINE_WARN_MS);
    }, 3000);
    return () => clearInterval(interval);
  }, [matchState, myUid]);

  // Auto-forfeit watchdog. Only the WAITING peer (NOT on move) measures
  // and writes the forfeit, so the on-turn / possibly-disconnected side
  // never has to race itself. The silent forfeit is intentional —
  // backgrounded tabs can't render banners anyway.
  useEffect(() => {
    if (!matchState || !myUid) return;
    if (matchState.status !== 'active' || matchState.outcome) return;
    if (matchState.currentTurn === myUid) return;
    const interval = setInterval(() => {
      const last = matchState.lastActivity?.toMillis?.();
      if (typeof last !== 'number') return;
      const elapsed = Date.now() - last;
      if (elapsed < OPPONENT_OFFLINE_FORFEIT_MS) return;
      const outcome: MatchOutcome =
        matchState.host.uid === myUid ? 'guest-resign' : 'host-resign';
      const ref = doc(db, 'matches', matchState.code);
      void runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const data = snap.data() as MatchDoc;
        if (data.outcome) return;
        const txLast = data.lastActivity?.toMillis?.();
        if (
          typeof txLast === 'number' &&
          Date.now() - txLast < OPPONENT_OFFLINE_FORFEIT_MS
        ) {
          return;
        }
        tx.update(ref, {
          status: 'completed',
          outcome,
          lastActivity: serverTimestamp(),
        });
      }).catch((err) => console.error('[mp] forfeit write failed', err));
    }, 4000);
    return () => clearInterval(interval);
  }, [matchState, myUid]);

  // Always compute (even when null) so hook order stays stable across the
  // null → active transition. Cheap enough — the log is tiny in practice.
  const boardState = useMemo(
    () => (matchState ? rebuildBoardFromMatch(matchState) : null),
    [matchState],
  );

  if (!matchState || !myUid || !boardState) return null;

  // Capture into narrowed locals so the closures below don't have to re-check.
  const liveMatch = matchState;
  const liveBoard = boardState;
  const liveMyUid = myUid;

  const isHost = liveMatch.host.uid === liveMyUid;
  const myColor = isHost
    ? liveMatch.host.color
    : liveMatch.guest?.color ?? 'white';
  const opponent = isHost ? liveMatch.guest : liveMatch.host;
  const opponentDisplayName = opponent?.displayName ?? 'opponent';
  const isMyTurn =
    liveMatch.status === 'active' && liveMatch.currentTurn === liveMyUid;

  // Q.D.3: full solo-roulette parity. Read straight off the live doc;
  // old matches without these fields default to classic-style defaults.
  const isRouletteMode = liveMatch.gameMode === 'roulette';
  const rouletteSlots = liveMatch.rouletteSlots ?? null;
  const rouletteActionsLeft = liveMatch.rouletteActionsLeft ?? 0;
  const usedRouletteSlots = liveMatch.usedRouletteSlots ?? [];
  const mySpinCount = liveMatch.rouletteSpinsByPlayer?.[liveMyUid] ?? 0;
  const opponentUid = isHost ? liveMatch.guest!.uid : liveMatch.host.uid;

  /** Build the patch that ends my turn (resets roulette state, hands the
   *  clock to my opponent with a fresh 2-action allotment). */
  function buildTurnEndPatch(): Record<string, unknown> {
    return {
      currentTurn: opponentUid,
      rouletteSlots: null,
      rouletteActionsLeft: 0,
      usedRouletteSlots: [],
    };
  }

  async function sendMove(move: Move): Promise<void> {
    if (liveMatch.status !== 'active') return;
    if (liveMatch.currentTurn !== liveMyUid) return;
    if (busy) return;
    // Q.D.3: roulette MP — must have a bag spun, and the piece type must
    // match an unused slot.
    let slotIndex = -1;
    if (isRouletteMode) {
      if (rouletteSlots === null) {
        setError('Spin the roulette first.');
        return;
      }
      if (rouletteActionsLeft <= 0) {
        setError('No actions left this turn.');
        return;
      }
      if (move.kind === 'topologyToggle') {
        // Use sendRotate() — it bookkeeps actions without touching slots.
        setError('Use the Rotate button.');
        return;
      }
      const movingPiece = move.from ? liveBoard.pieces[move.from] : undefined;
      if (!movingPiece) return;
      slotIndex = consumeSlotIndex(
        rouletteSlots,
        usedRouletteSlots,
        movingPiece.type,
      );
      if (slotIndex < 0) {
        setError(`No matching ${movingPiece.type} slot left.`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const san = computeSAN(liveBoard, move);
      const savedMove = {
        move,
        san,
        topology: liveBoard.topologyState,
        timestamp: Date.now(),
      };
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'matches', liveMatch.code);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('MATCH_GONE');
        const data = snap.data() as MatchDoc;
        if (data.currentTurn !== liveMyUid) throw new Error('NOT_YOUR_TURN');
        if (data.status !== 'active') throw new Error('MATCH_NOT_ACTIVE');
        const patch: Record<string, unknown> = {
          'log.moves': [...data.log.moves, savedMove],
          lastActivity: serverTimestamp(),
        };
        if (data.gameMode === 'roulette') {
          const newActions = (data.rouletteActionsLeft ?? 0) - 1;
          const newUsed = [...(data.usedRouletteSlots ?? []), slotIndex];
          if (newActions <= 0) {
            // Turn over — hand the clock to opponent with a fresh bag-less
            // slate (they'll spin on their side).
            Object.assign(patch, buildTurnEndPatch());
          } else {
            // Still my turn for one more action. Slot bag stays; bookkeep
            // the consumed slot + decremented action count.
            patch.rouletteActionsLeft = newActions;
            patch.usedRouletteSlots = newUsed;
          }
        } else {
          // Classic MP: every move ends the turn.
          patch.currentTurn = opponentUid;
        }
        tx.update(ref, patch);
      });
    } catch (err) {
      console.error('[mp] move failed', err);
      const msg = err instanceof Error ? err.message : 'MOVE_FAILED';
      setError(
        msg === 'NOT_YOUR_TURN'
          ? "It's not your turn anymore."
          : msg === 'MATCH_NOT_ACTIVE'
            ? 'Match is no longer active.'
            : 'Move failed. Check your connection.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendRotate(): Promise<void> {
    if (liveMatch.status !== 'active') return;
    if (liveMatch.currentTurn !== liveMyUid) return;
    if (busy) return;
    if (!isRouletteMode) {
      // Classic MP rotate: goes through sendMove as a topologyToggle
      // (a normal turn-ending move).
      void sendMove({ kind: 'topologyToggle' });
      return;
    }
    if (rouletteActionsLeft <= 0) {
      setError('No actions left this turn.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const toggleMove: Move = { kind: 'topologyToggle' };
      const san = computeSAN(liveBoard, toggleMove);
      const savedMove = {
        move: toggleMove,
        san,
        topology: liveBoard.topologyState,
        timestamp: Date.now(),
      };
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'matches', liveMatch.code);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('MATCH_GONE');
        const data = snap.data() as MatchDoc;
        if (data.currentTurn !== liveMyUid) throw new Error('NOT_YOUR_TURN');
        if (data.status !== 'active') throw new Error('MATCH_NOT_ACTIVE');
        const newActions = (data.rouletteActionsLeft ?? 0) - 1;
        const patch: Record<string, unknown> = {
          'log.moves': [...data.log.moves, savedMove],
          lastActivity: serverTimestamp(),
        };
        // Rotate uses an action but doesn't consume a slot.
        if (newActions <= 0) {
          Object.assign(patch, buildTurnEndPatch());
        } else {
          patch.rouletteActionsLeft = newActions;
        }
        tx.update(ref, patch);
      });
    } catch (err) {
      console.error('[mp] rotate failed', err);
      setError('Rotate failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function spinRoulette(): Promise<void> {
    if (!isRouletteMode) return;
    if (liveMatch.status !== 'active') return;
    if (liveMatch.currentTurn !== liveMyUid) return;
    if (rouletteSlots !== null) return; // already spun this turn
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const totalSpins = liveMatch.rouletteSpinCount ?? 0;
      const pawnBoost = totalSpins < 3;
      const rolled = rollRouletteBag(liveBoard, myColor, pawnBoost);
      if (!rolled) {
        setError('No pieces left to spin — game ending.');
        return;
      }
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'matches', liveMatch.code);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('MATCH_GONE');
        const data = snap.data() as MatchDoc;
        if (data.currentTurn !== liveMyUid) throw new Error('NOT_YOUR_TURN');
        if (data.status !== 'active') throw new Error('MATCH_NOT_ACTIVE');
        if (data.rouletteSlots) return; // race — another tab spun
        const spins = { ...(data.rouletteSpinsByPlayer ?? {}) };
        spins[liveMyUid] = (spins[liveMyUid] ?? 0) + 1;
        tx.update(ref, {
          rouletteSlots: rolled,
          rouletteActionsLeft: ROULETTE_MAX_ACTIONS,
          usedRouletteSlots: [],
          rouletteSpinsByPlayer: spins,
          rouletteSpinCount: (data.rouletteSpinCount ?? 0) + 1,
          lastActivity: serverTimestamp(),
        });
      });
    } catch (err) {
      console.error('[mp] spin failed', err);
      setError('Spin failed — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resign(): Promise<void> {
    if (liveMatch.status !== 'active') return;
    setBusy(true);
    setError(null);
    try {
      const outcome: MatchOutcome = isHost ? 'host-resign' : 'guest-resign';
      await updateDoc(doc(db, 'matches', liveMatch.code), {
        status: 'completed',
        outcome,
        lastActivity: serverTimestamp(),
      });
    } catch (err) {
      console.error('[mp] resign failed', err);
      setError('Could not resign. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function writeOutcomeIfFirst(outcome: MatchOutcome): Promise<void> {
    const ref = doc(db, 'matches', liveMatch.code);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const data = snap.data() as MatchDoc;
        if (data.outcome) return;
        tx.update(ref, {
          status: 'completed',
          outcome,
          lastActivity: serverTimestamp(),
        });
      });
    } catch (err) {
      console.error('[mp] outcome write failed', err);
    }
  }

  return {
    matchState: liveMatch,
    boardState: liveBoard,
    myUid: liveMyUid,
    myColor,
    opponentDisplayName,
    isMyTurn,
    isHost,
    selfAfkWarning,
    isRouletteMode,
    rouletteSlots,
    rouletteActionsLeft,
    usedRouletteSlots,
    mySpinCount,
    spinRoulette,
    sendRotate,
    busy,
    error,
    clearError: () => setError(null),
    sendMove,
    resign,
    writeOutcomeIfFirst,
  };
}
