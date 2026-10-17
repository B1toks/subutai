import { isBotStrength, type BotStrength } from '../ai/agents';
import { LIVE_SESSION_KEY } from './storage';
import { localData } from '../infra/localData';

/** V1 — pointer to the solo game in progress, for a new tab to resume.
 *  The key lives next to Memory's, whose entry it points at. */
export interface LiveSession {
  gameId: string;
  opponentMode: 'ai' | 'local';
  gameMode: string;
  timed: boolean;
  savedAt: number;
  /** The level the game was started against. The level pills are locked
   *  mid-game; without this a resume would silently take whatever level
   *  another tab has written since. Absent in pre-fix pointers. */
  botLevel?: BotStrength;
  /** N-1 — the game on the board is not one that may be ranked (it was
   *  resumed from Memory, or imported). A reload keeps it that way. Absent
   *  in older pointers, which are then treated as unranked too. */
  unranked?: boolean;
}

export function writeLiveSession(s: LiveSession): void {
  try {
    localData.set(LIVE_SESSION_KEY, JSON.stringify(s));
  } catch {
    /* private mode — the tab just starts fresh */
  }
}

export function readLiveSession(): LiveSession | null {
  try {
    const raw = localData.get(LIVE_SESSION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LiveSession>;
    if (typeof v.gameId !== 'string' || typeof v.savedAt !== 'number') return null;
    return {
      gameId: v.gameId,
      opponentMode: v.opponentMode === 'local' ? 'local' : 'ai',
      gameMode: typeof v.gameMode === 'string' ? v.gameMode : 'classic',
      timed: v.timed === true,
      savedAt: v.savedAt,
      botLevel: isBotStrength(v.botLevel) ? v.botLevel : undefined,
      unranked: v.unranked === true || v.unranked === undefined,
    };
  } catch {
    return null;
  }
}

export function clearLiveSession(): void {
  try {
    localData.remove(LIVE_SESSION_KEY);
  } catch {
    /* private mode */
  }
}
