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

export async function fetchLeaderboardPage(
  cursor?: LeaderboardCursor,
): Promise<LeaderboardPage> {
  const constraints = [
    where('bestGamePoints', '>', 0),
    orderBy('bestGamePoints', 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(PAGE_SIZE),
  ];
  const snap = await getDocs(query(collection(db, 'users'), ...constraints));

  const entries: LeaderboardEntry[] = snap.docs.map((d) => {
    const p = d.data() as UserProfile;
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
