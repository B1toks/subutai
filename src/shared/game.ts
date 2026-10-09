import type { Color } from '../engine';

/** Where a solo or hot-seat game stands. Anything but 'active' is over. */
export type GameStatus =
  | 'active'
  | 'checkmate'
  | 'draw_stalemate'
  | 'draw_material'
  | 'draw_repetition'
  | 'draw_50move'
  | 'king_captured_white_wins'
  | 'king_captured_black_wins'
  // V1 — solo time control: the side that runs out of time loses.
  | 'timeout_white'
  | 'timeout_black'
  // QA-11 — the named side resigned. Its own status, so the banner, the
  // winner and the endgame cut no longer read a resignation as a mate.
  | 'resigned_white'
  | 'resigned_black'
  // Hot-seat: one side offered a draw and the other accepted. A 'draw_'
  // status like the rest, so it gets the handshake cut and a draw result.
  | 'draw_agreement';

export type GameMode = 'classic' | 'roulette';

/** Against the bot the human always plays White. */
export const HUMAN_COLOR: Color = 'white';
