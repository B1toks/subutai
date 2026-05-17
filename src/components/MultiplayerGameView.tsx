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
} from '../engine';
import { applyMove } from '../engine/moves';
import { applyRotationMove } from '../engine/auxetic';
import { computeSAN } from '../recording/log';

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
  resign: () => Promise<void>;
  /** Race-safe terminal-outcome write (mate/draw detected locally). */
  writeOutcomeIfFirst: (outcome: MatchOutcome) => Promise<void>;
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

  async function sendMove(move: Move): Promise<void> {
    if (liveMatch.status !== 'active') return;
    if (liveMatch.currentTurn !== liveMyUid) return;
    if (busy) return;
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
      const opponentUid = isHost
        ? liveMatch.guest!.uid
        : liveMatch.host.uid;
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'matches', liveMatch.code);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('MATCH_GONE');
        const data = snap.data() as MatchDoc;
        if (data.currentTurn !== liveMyUid) throw new Error('NOT_YOUR_TURN');
        if (data.status !== 'active') throw new Error('MATCH_NOT_ACTIVE');
        tx.update(ref, {
          'log.moves': [...data.log.moves, savedMove],
          currentTurn: opponentUid,
          lastActivity: serverTimestamp(),
        });
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
    busy,
    error,
    clearError: () => setError(null),
    sendMove,
    resign,
    writeOutcomeIfFirst,
  };
}
