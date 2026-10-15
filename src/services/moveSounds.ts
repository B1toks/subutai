import { audio } from '../audio/AudioController';
import type { GameStatus } from '../shared/game';
import type { SessionEvent } from '../session/types';

/**
 * The sound of a move, one per batch that holds one: checkmate > promotion
 * > capture > move. A checkmate is the game ending in the same batch (a
 * move that mates); the bot's mate is settled in a later batch, after its
 * classification, so it sounds as a plain move, as it always has.
 * Brilliant / blunder voices come from the classifier, not from here.
 */
export function moveSoundsOnEvents(events: readonly SessionEvent[], status: GameStatus): void {
  const move = events.find((e) => e.type === 'move');
  if (!move || move.type !== 'move') return;
  if (status === 'checkmate') {
    audio.play('checkmate');
    return;
  }
  const kind = move.move.kind;
  if (kind === 'promotion') {
    audio.play('promotion');
    return;
  }
  if (kind === 'capture' || kind === 'enPassant') {
    audio.play('capture');
    return;
  }
  audio.play('move');
}
