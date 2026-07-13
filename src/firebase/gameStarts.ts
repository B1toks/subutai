import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './client';

/** R15 data gap: completed games are the ONLY thing /games records, so
 *  abandonment ("started playing, closed the tab") is invisible. This logs a
 *  tiny doc on the human's first move of a solo run; the offline funnel then
 *  compares starts vs completions. Same auth gate as saveCompletedGame so the
 *  two series stay comparable. Fire-and-forget — a lost ping must never
 *  affect play. */
export function logGameStart(args: {
  uid: string;
  chess960Id: string;
  seed: number;
  gameMode: 'classic' | 'roulette';
}): void {
  addDoc(collection(db, 'game_starts'), {
    playerId: args.uid,
    chess960Id: args.chess960Id,
    seed: args.seed,
    gameMode: args.gameMode,
    createdAt: serverTimestamp(),
  }).catch((err) => {
    console.warn('[gameStarts] ping failed', err);
  });
}
