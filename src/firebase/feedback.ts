import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './client';
import type { GameOutcome } from '../analysis/points';

export type FeedbackType = 'game' | 'general';
export type FeedbackRating = 'love' | 'good' | 'meh' | 'bad';

export interface FeedbackGameContext {
  outcome: GameOutcome;
  moveCount: number;
  points: number;
  chess960Id: string;
}

export interface FeedbackPayload {
  type: FeedbackType;
  playerId: string;
  playerName: string;
  rating?: FeedbackRating;
  liked?: string;
  disliked?: string;
  comment?: string;
  // Only for type='game': either bound to a saved game by id, or just
  // carrying denormalised context when the save failed and there's no id.
  gameId?: string;
  gameContext?: FeedbackGameContext;
}

const TEXT_LIMIT = 1000;
const UA_LIMIT = 200;

export async function submitFeedback(payload: FeedbackPayload): Promise<string> {
  const clean: Record<string, unknown> = {
    type: payload.type,
    playerId: payload.playerId,
    playerName: payload.playerName,
    createdAt: serverTimestamp(),
    userAgent: navigator.userAgent.substring(0, UA_LIMIT),
  };
  if (payload.rating) clean.rating = payload.rating;
  if (payload.liked?.trim()) clean.liked = payload.liked.trim().substring(0, TEXT_LIMIT);
  if (payload.disliked?.trim()) clean.disliked = payload.disliked.trim().substring(0, TEXT_LIMIT);
  if (payload.comment?.trim()) clean.comment = payload.comment.trim().substring(0, TEXT_LIMIT);
  if (payload.gameId) clean.gameId = payload.gameId;
  if (payload.gameContext) clean.gameContext = payload.gameContext;

  const docRef = await addDoc(collection(db, 'feedback'), clean);
  return docRef.id;
}

export function hasAnyContent(payload: Partial<FeedbackPayload>): boolean {
  return Boolean(
    payload.rating ||
      payload.liked?.trim() ||
      payload.disliked?.trim() ||
      payload.comment?.trim(),
  );
}
