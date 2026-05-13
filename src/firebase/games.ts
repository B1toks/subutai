import {
  addDoc,
  collection,
  doc,
  getCountFromServer,
  getDoc,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { db } from './client';
import type { GameLog, LoggedMove } from '../recording/log';
import type { GamePoints, GameOutcome } from '../analysis/points';
import type { TopologyState } from '../engine/types';
import { createPositionFromBackRankKey } from '../engine';
import { toggleTopology } from '../engine/auxetic';

interface StoredMove {
  san?: string;
  move: LoggedMove['move'];
  topology?: TopologyState;
  timestamp: number;
}

interface StoredGameLog {
  initialTopology: TopologyState;
  moves: StoredMove[];
}

/** The shape of a /games/{id} document as it lives in Firestore. */
export interface SavedGameDoc {
  playerId: string;
  playerName: string;
  chess960Id: string;
  seed: number;
  humanColor: 'white' | 'black';
  log: StoredGameLog;
  outcome: GameOutcome;
  moveCount: number;
  points: GamePoints;
  vsAI: true;
  createdAt: Timestamp;
}

export interface SaveGameResult {
  gameId: string;
  isNewBest: boolean;
  newRank: number | null;
}

/**
 * Persist a completed game and (if the run counts) update the player's profile
 * stats. Returns whether this was a personal best and the player's current rank.
 */
export async function saveCompletedGame(args: {
  uid: string;
  displayName: string;
  log: GameLog;
  outcome: GameOutcome;
  points: GamePoints;
  chess960Id: string;
  seed: number;
  humanColor: 'white' | 'black';
}): Promise<SaveGameResult> {
  const { uid, displayName, log, outcome, points, chess960Id, seed, humanColor } = args;

  const gameRef = await addDoc(collection(db, 'games'), {
    playerId: uid,
    playerName: displayName,
    chess960Id,
    seed,
    humanColor,
    log: serializeGameLog(log),
    outcome,
    moveCount: points.moveCount,
    points,
    vsAI: true,
    createdAt: serverTimestamp(),
  });

  let isNewBest = false;
  if (points.counted) {
    const userRef = doc(db, 'users', uid);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      const cur = (snap.exists() ? snap.data() : {}) as Record<string, unknown>;
      const oldBest = (cur.bestGamePoints as number | undefined) ?? 0;
      isNewBest = points.total > oldBest;

      const patch: Record<string, unknown> = {
        gamesPlayed: ((cur.gamesPlayed as number | undefined) ?? 0) + 1,
        gamesWon:
          ((cur.gamesWon as number | undefined) ?? 0) +
          (outcome === 'human-win' ? 1 : 0),
        gamesDrawn:
          ((cur.gamesDrawn as number | undefined) ?? 0) +
          (outcome === 'draw' ? 1 : 0),
        longestSurvivalMoves: Math.max(
          (cur.longestSurvivalMoves as number | undefined) ?? 0,
          points.moveCount,
        ),
        lastGameAt: serverTimestamp(),
        lastActive: serverTimestamp(),
      };
      if (isNewBest) {
        patch.bestGamePoints = points.total;
        patch.bestGameId = gameRef.id;
        patch.bestGameSnapshot = {
          chess960Id,
          moveCount: points.moveCount,
          outcome,
          createdAt: serverTimestamp(),
        };
      }
      tx.update(userRef, patch);
    });
  }

  let newRank: number | null = null;
  if (points.counted) {
    try {
      newRank = await computeRank(uid);
    } catch (err) {
      console.error('[games] computeRank failed', err);
    }
  }

  return { gameId: gameRef.id, isNewBest, newRank };
}

export async function getPersonalBest(uid: string): Promise<number | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  const best = snap.data()?.bestGamePoints as number | undefined;
  return typeof best === 'number' ? best : null;
}

async function computeRank(uid: string): Promise<number> {
  const userSnap = await getDoc(doc(db, 'users', uid));
  const myBest = (userSnap.data()?.bestGamePoints as number | undefined) ?? 0;

  const q = query(
    collection(db, 'users'),
    where('bestGamePoints', '>', myBest),
  );
  const count = await getCountFromServer(q);
  return count.data().count + 1;
}

/**
 * Slim payload for Firestore: only what's needed to replay the game later.
 * The initialState is reconstructable from chess960Id + initialTopology, so
 * we drop ~3-5 KB of redundant pieces/positionHistory. MoveAnalysis floats
 * are also stripped — replay regenerates them on demand.
 */
function serializeGameLog(log: GameLog): StoredGameLog {
  return {
    initialTopology: log.initialTopology,
    moves: log.moves.map(stripMove),
  };
}

function stripMove(m: LoggedMove): StoredMove {
  const { san, move, topology, timestamp } = m;
  return { san, move, topology, timestamp };
}

/**
 * Inverse of serializeGameLog. Rebuilds a full GameLog (with regenerated
 * initialState) from a /games document so existing replay machinery works
 * without any if-branches.
 */
export function deserializeGameLog(saved: SavedGameDoc): GameLog {
  let initialState = createPositionFromBackRankKey(saved.chess960Id);
  if (saved.log.initialTopology === 'B') {
    initialState = toggleTopology(initialState);
  }
  return {
    id: `replay-${Date.now()}`,
    createdAt: new Date().toISOString(),
    randomSeed: saved.seed,
    initialTopology: saved.log.initialTopology,
    initialState,
    moves: saved.log.moves.map((m) => ({
      san: m.san,
      move: m.move,
      topology: m.topology,
      timestamp: m.timestamp,
    })),
  };
}

export async function fetchSavedGame(gameId: string): Promise<SavedGameDoc | null> {
  const snap = await getDoc(doc(db, 'games', gameId));
  return snap.exists() ? (snap.data() as SavedGameDoc) : null;
}
