import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteField,
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase/client';
import {
  subscribeMatch,
  type MatchDoc,
  type MatchEndReason,
  type MatchOutcome,
} from '../firebase/matches';
import {
  createPositionFromBackRankKey,
  type BoardState,
  type Move,
  type PieceType,
} from '../engine';
import { applyMove, isInCheck } from '../engine/moves';
import { applyRotationMove } from '../engine/auxetic';
import { computeSAN } from '../recording/log';
import { drawOfferHolds, inactivityForfeitApplies, turnStartedMs } from '../firebase/matchEnd';
import {
  canAnswerDraw,
  canOfferDraw,
  drawOfferBlock,
  standingDrawOffer,
  type DrawTable,
} from '../utils/drawOffer';

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
/** firestore.rules holds the same 90 s, from the start of the turn
 *  (turnStartedMs): before it, by server time, only the idle player can
 *  end the match with their own 'X-resign'. */
export const OPPONENT_OFFLINE_FORFEIT_MS = 90_000;

/** The waiting peer ends the match for an opponent idle past the limit.
 *  Transaction-guarded: a move or another ending that lands first wins. */
export async function writeInactivityForfeit(code: string, myUid: string): Promise<void> {
  const ref = doc(db, 'matches', code);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data() as MatchDoc;
    if (data.outcome) return;
    if (!inactivityForfeitApplies(data)) return; // a move started the clock
    if (drawOfferHolds(data)) return; // they wait for my answer to their offer
    const txLast = turnStartedMs(data);
    if (
      typeof txLast === 'number' &&
      Date.now() - txLast < OPPONENT_OFFLINE_FORFEIT_MS
    ) {
      return;
    }
    const outcome: MatchOutcome =
      data.host.uid === myUid ? 'guest-resign' : 'host-resign';
    tx.update(ref, {
      status: 'completed',
      outcome,
      endReason: 'inactive',
      lastActivity: serverTimestamp(),
    });
  });
}

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
  /** Resolves true when THIS resignation is the outcome that was written
   *  (false: it failed, or another outcome landed first). `reason` is
   *  'flag' when my own clock ran out. */
  resign: (reason?: 'resign' | 'flag') => Promise<boolean>;
  /** Race-safe terminal-outcome write (mate/draw detected locally, or the
   *  opponent's flag fall). Resolves false only when the write failed —
   *  the rules refuse a claim for the opponent before 90 s of their
   *  inactivity, so that one is retried. */
  writeOutcomeIfFirst: (outcome: MatchOutcome, endReason?: MatchEndReason) => Promise<boolean>;
  /** Draw offers (src/utils/drawOffer.ts): the match's offer, and me in
   *  `waiting` while I have offered and not moved since. That lock lives
   *  in this tab only; the rules hold the rest (one offer at a time,
   *  retired by any move). */
  drawTable: DrawTable<string>;
  /** A draw offer or answer is being written. */
  drawBusy: boolean;
  /** Offer a draw at the current ply. */
  offerDraw: () => Promise<void>;
  /** Accept (the match ends as a draw by agreement) or decline the
   *  opponent's standing offer. */
  answerDraw: (accept: boolean) => Promise<void>;
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

/** R-1 — the timestamp of a new log entry. firestore.rules takes one no
 *  earlier than the previous entry and, in a match with a clock, within
 *  60 s of server time; the
 *  previous entry is the opponent's, stamped by their clock, which can be
 *  ahead of mine by more than the time I took to reply. Stamped inside the
 *  transaction, so a retried write is not stamped at the first try. */
function nextMoveTimestamp(moves: MatchDoc['log']['moves']): number {
  return Math.max(Date.now(), moves[moves.length - 1]?.timestamp ?? 0);
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
  // Draw offers write on their own flag: sharing `busy` would drop a move
  // clicked while an offer is on its way.
  const [drawBusy, setDrawBusy] = useState(false);
  // The match I have offered a draw in and not moved since (one at most).
  const [drawLockCode, setDrawLockCode] = useState<string | null>(null);

  // Reset internal state when the parent swaps matches (or clears).
  useEffect(() => {
    setMatchState(activeMatch);
    setError(null);
    setSelfAfkWarning(false);
    setDrawLockCode(null);
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
    if (
      matchState.currentTurn !== myUid ||
      !inactivityForfeitApplies(matchState) ||
      drawOfferHolds(matchState)
    ) {
      setSelfAfkWarning(false);
      return;
    }
    const interval = setInterval(() => {
      const last = turnStartedMs(matchState);
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
    if (!inactivityForfeitApplies(matchState)) return;
    if (drawOfferHolds(matchState)) return; // answer their offer first
    const interval = setInterval(() => {
      const last = turnStartedMs(matchState);
      if (typeof last !== 'number') return;
      const elapsed = Date.now() - last;
      if (elapsed < OPPONENT_OFFLINE_FORFEIT_MS) return;
      void writeInactivityForfeit(matchState.code, myUid).catch((err) =>
        console.error('[mp] forfeit write failed', err),
      );
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
    // Q.D.4: when the side-to-move is in check, the slot match is skipped
    // — the player MUST be able to escape with any piece. Action still
    // gets spent; no slot consumed.
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
      const inCheck = isInCheck(liveBoard);
      if (!inCheck) {
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
    }
    setBusy(true);
    setError(null);
    try {
      const san = computeSAN(liveBoard, move);
      // Stamped in the transaction (nextMoveTimestamp).
      const savedMove = {
        move,
        san,
        topology: liveBoard.topologyState,
      };
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'matches', liveMatch.code);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('MATCH_GONE');
        const data = snap.data() as MatchDoc;
        if (data.currentTurn !== liveMyUid) throw new Error('NOT_YOUR_TURN');
        if (data.status !== 'active') throw new Error('MATCH_NOT_ACTIVE');
        const patch: Record<string, unknown> = {
          'log.moves': [
            ...data.log.moves,
            { ...savedMove, timestamp: nextMoveTimestamp(data.log.moves) },
          ],
          lastActivity: serverTimestamp(),
          turnStartedAt: serverTimestamp(),
        };
        if (data.gameMode === 'roulette') {
          const newActions = (data.rouletteActionsLeft ?? 0) - 1;
          // Q.D.4: when in check, slotIndex stays -1 (no slot consumed).
          // Action still ticks down so multi-action turns terminate cleanly.
          const newUsed =
            slotIndex >= 0
              ? [...(data.usedRouletteSlots ?? []), slotIndex]
              : (data.usedRouletteSlots ?? []);
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
        // Any move retires a draw offer; the field goes with it.
        if (data.drawOffer) patch.drawOffer = deleteField();
        tx.update(ref, patch);
      });
      setDrawLockCode(null); // I have moved: I may offer again
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
      // Stamped in the transaction (nextMoveTimestamp).
      const savedMove = {
        move: toggleMove,
        san,
        topology: liveBoard.topologyState,
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
          'log.moves': [
            ...data.log.moves,
            { ...savedMove, timestamp: nextMoveTimestamp(data.log.moves) },
          ],
          lastActivity: serverTimestamp(),
          turnStartedAt: serverTimestamp(),
        };
        // Rotate uses an action but doesn't consume a slot.
        if (newActions <= 0) {
          Object.assign(patch, buildTurnEndPatch());
        } else {
          patch.rouletteActionsLeft = newActions;
        }
        if (data.drawOffer) patch.drawOffer = deleteField();
        tx.update(ref, patch);
      });
      setDrawLockCode(null);
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
        setError('No pieces left to spin. Game ending.');
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
      setError('Spin failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resign(reason: 'resign' | 'flag' = 'resign'): Promise<boolean> {
    if (liveMatch.status !== 'active') return false;
    let wrote = false;
    setBusy(true);
    setError(null);
    try {
      const outcome: MatchOutcome = isHost ? 'host-resign' : 'guest-resign';
      // R13 hardening: transaction-guarded like every other outcome write —
      // a resign racing a flag-fall (or the opponent's resign) must not
      // clobber the outcome that landed first. Losing the race is fine:
      // the game is over either way.
      await runTransaction(db, async (tx) => {
        wrote = false; // a transaction body can run more than once
        const ref = doc(db, 'matches', liveMatch.code);
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        if ((snap.data() as MatchDoc).outcome) return;
        tx.update(ref, {
          status: 'completed',
          outcome,
          endReason: reason,
          lastActivity: serverTimestamp(),
        });
        wrote = true;
      });
    } catch (err) {
      console.error('[mp] resign failed', err);
      setError('Could not resign. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
    return wrote;
  }

  async function writeOutcomeIfFirst(
    outcome: MatchOutcome,
    endReason?: MatchEndReason,
  ): Promise<boolean> {
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
          ...(endReason ? { endReason } : {}),
          lastActivity: serverTimestamp(),
        });
      });
      return true;
    } catch (err) {
      console.error('[mp] outcome write failed', err);
      return false;
    }
  }

  const drawTable: DrawTable<string> = {
    offer: liveMatch.drawOffer ?? null,
    waiting: drawLockCode === liveMatch.code ? [liveMyUid] : [],
  };

  // R-7 — an offer I make on my own turn holds the 90 s (drawOfferHolds):
  // nobody but me can end the match for me while I wait for the answer,
  // and a decline starts my turn over. One offer per ply between both of
  // us, which the rules hold too, so the hold cannot be renewed.
  async function offerDraw(): Promise<void> {
    if (liveMatch.status !== 'active' || liveMatch.outcome) return;
    if (!canOfferDraw(drawTable, liveMyUid, liveMatch.log.moves.length)) return;
    if (drawBusy) return;
    setDrawBusy(true);
    setError(null);
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'matches', liveMatch.code);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('MATCH_GONE');
        const data = snap.data() as MatchDoc;
        if (data.status !== 'active' || data.outcome) throw new Error('MATCH_NOT_ACTIVE');
        const plies = data.log.moves.length;
        // One at a time: the opponent's offer, landed meanwhile, wins.
        const block = drawOfferBlock({ offer: data.drawOffer ?? null, waiting: [] }, liveMyUid, plies);
        if (block) {
          throw new Error(
            block === 'answer'
              ? 'DRAW_OFFER_STANDS'
              : block === 'declined'
                ? 'DRAW_OFFER_DECLINED'
                : 'DRAW_OFFER_BLOCKED',
          );
        }
        tx.update(ref, {
          drawOffer: { by: liveMyUid, atPly: plies },
          lastActivity: serverTimestamp(),
        });
      });
      setDrawLockCode(liveMatch.code);
    } catch (err) {
      console.error('[mp] draw offer failed', err);
      const msg = err instanceof Error ? err.message : '';
      setError(
        msg === 'MATCH_NOT_ACTIVE'
          ? 'Match is no longer active.'
          : msg === 'DRAW_OFFER_STANDS'
            ? `${opponentDisplayName} has just offered a draw.`
            : msg === 'DRAW_OFFER_DECLINED'
              ? 'A draw was declined this move. Offer one after the next move.'
              : 'Could not offer a draw. Try again.',
      );
    } finally {
      setDrawBusy(false);
    }
  }

  async function answerDraw(accept: boolean): Promise<void> {
    if (!canAnswerDraw(liveMatch.drawOffer, liveMyUid, liveMatch.log.moves.length)) return;
    if (drawBusy) return;
    setDrawBusy(true);
    setError(null);
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'matches', liveMatch.code);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('MATCH_GONE');
        const data = snap.data() as MatchDoc;
        if (data.status !== 'active' || data.outcome) throw new Error('MATCH_NOT_ACTIVE');
        // A move that landed first retired the offer: nothing to answer.
        const offer = standingDrawOffer(data.drawOffer, data.log.moves.length);
        if (!offer || offer.by === liveMyUid) throw new Error('DRAW_OFFER_GONE');
        // An accept leaves the offer on the finished match. A decline marks
        // it, so nobody offers again at this ply, and when the offer was made
        // on its maker's turn it starts that turn over: they waited for me.
        tx.update(
          ref,
          accept
            ? {
                status: 'completed',
                outcome: 'draw',
                endReason: 'agreement',
                lastActivity: serverTimestamp(),
              }
            : {
                drawOffer: { by: offer.by, atPly: offer.atPly, declined: true },
                lastActivity: serverTimestamp(),
                ...(drawOfferHolds(data) ? { turnStartedAt: serverTimestamp() } : {}),
              },
        );
      });
    } catch (err) {
      console.error('[mp] draw answer failed', err);
      const msg = err instanceof Error ? err.message : '';
      setError(
        msg === 'MATCH_NOT_ACTIVE'
          ? 'Match is no longer active.'
          : msg === 'DRAW_OFFER_GONE'
            ? 'The draw offer is gone: a move came first.'
            : accept
              ? 'Could not accept the draw. Try again.'
              : 'Could not decline the draw. Try again.',
      );
    } finally {
      setDrawBusy(false);
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
    drawTable,
    drawBusy,
    offerDraw,
    answerDraw,
  };
}
