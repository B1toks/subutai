import {
  addDoc,
  collection,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore';
import { db } from './client';
import type { GameLog, LoggedMove } from '../recording/log';
import type { GameOutcome } from '../analysis/points';
import type { TopologyState } from '../engine/types';

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

/** Shape of a /training_games/{id} document. Intentionally separate from
 *  /games — auto-played runs don't earn points, don't show in the
 *  leaderboard, and may be written without auth. */
export interface TrainingGameDoc {
  chess960Id: string;
  seed: number;
  moveCount: number;
  outcome: GameOutcome;
  log: StoredGameLog;
  finalEvalFromWhite: number;
  aiVersion: string;
  createdAt: Timestamp;
}

function serializeGameLog(log: GameLog): StoredGameLog {
  return {
    initialTopology: log.initialTopology,
    moves: log.moves.map((m) => ({
      san: m.san,
      move: m.move,
      topology: m.topology,
      timestamp: m.timestamp,
    })),
  };
}

export async function saveTrainingGame(args: {
  log: GameLog;
  chess960Id: string;
  seed: number;
  outcome: GameOutcome;
  moveCount: number;
  finalEvalFromWhite: number;
  aiVersion: string;
}): Promise<string> {
  const ref = await addDoc(collection(db, 'training_games'), {
    chess960Id: args.chess960Id,
    seed: args.seed,
    moveCount: args.moveCount,
    outcome: args.outcome,
    log: serializeGameLog(args.log),
    finalEvalFromWhite: args.finalEvalFromWhite,
    aiVersion: args.aiVersion,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
