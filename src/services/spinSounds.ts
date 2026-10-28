import { audio } from '../audio/AudioController';
import type { SessionEvent } from '../session/types';

/** v1.1.6: the beat of a Roulette slot landing (session 'rouletteSlot',
 *  timed by session/reveal.ts), and the closing chime on the last. */
export function spinSoundsOnEvents(events: readonly SessionEvent[]): void {
  for (const e of events) {
    if (e.type === 'rouletteSlot') audio.play(e.last ? 'rouletteSlotLast' : 'rouletteSlot');
  }
}
