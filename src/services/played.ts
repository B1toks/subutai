import type { SessionEvent } from '../session/types';

export type MoveEvent = Extract<SessionEvent, { type: 'move' }>;

/**
 * A move somebody made now — not a frame of a replay shown again. Every
 * service that counts or records play (beat combo, saves, chat votes,
 * analytics, the coach) looks only at these; the board's sound and effects
 * also react to replayed moves.
 */
export function isPlayed(e: SessionEvent): e is MoveEvent {
  return e.type === 'move' && e.actor !== 'replay';
}
