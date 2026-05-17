import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './client';
import type { BestGameSnapshot, UserProfile } from './types';

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  bestGamePoints: number;
  bestGameId?: string;
  bestGameSnapshot?: BestGameSnapshot;
  gamesPlayed: number;
  longestSurvivalMoves: number;
}

export type LeaderboardCursor = QueryDocumentSnapshot<DocumentData> | null;

export interface LeaderboardPage {
  entries: LeaderboardEntry[];
  cursor: LeaderboardCursor;
  hasMore: boolean;
}

const PAGE_SIZE = 25;

export type BoardType = 'classic' | 'roulette';

export async function fetchLeaderboardPage(
  cursor?: LeaderboardCursor,
  boardType: BoardType = 'classic',
): Promise<LeaderboardPage> {
  // Stage O: roulette leaderboard reads a parallel field group on /users so
  // the two ranking systems are completely isolated. Both queries use the
  // single-field index Firestore creates automatically — no composite index
  // needed for `where + orderBy on the same field`.
  const pointsField =
    boardType === 'roulette' ? 'rouletteBestPoints' : 'bestGamePoints';
  const constraints = [
    where(pointsField, '>', 0),
    orderBy(pointsField, 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(PAGE_SIZE),
  ];
  const snap = await getDocs(query(collection(db, 'users'), ...constraints));

  const entries: LeaderboardEntry[] = snap.docs.map((d) => {
    const p = d.data() as UserProfile;
    if (boardType === 'roulette') {
      return {
        uid: p.uid,
        displayName: p.displayName,
        bestGamePoints: p.rouletteBestPoints ?? 0,
        bestGameId: p.rouletteBestGameId,
        bestGameSnapshot: p.rouletteBestSnapshot,
        gamesPlayed: p.rouletteGamesPlayed ?? 0,
        // Roulette has no survival-moves analogue yet — pass 0 so the
        // existing UI just renders "—".
        longestSurvivalMoves: 0,
      };
    }
    return {
      uid: p.uid,
      displayName: p.displayName,
      bestGamePoints: p.bestGamePoints ?? 0,
      bestGameId: p.bestGameId,
      bestGameSnapshot: p.bestGameSnapshot,
      gamesPlayed: p.gamesPlayed ?? 0,
      longestSurvivalMoves: p.longestSurvivalMoves ?? 0,
    };
  });

  const lastDoc = snap.docs[snap.docs.length - 1] ?? null;
  return {
    entries,
    cursor: lastDoc,
    hasMore: snap.docs.length === PAGE_SIZE,
  };
}
