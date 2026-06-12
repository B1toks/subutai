/**
 * T2 — chat predictions. Viewers type !white / !black / !draw (or the
 * short forms !w !b !d) while a game is running; the latest command
 * per viewer counts, so people can change their mind until the game
 * ends. When it does, everyone who called the result is a winner.
 */

import type { TwitchChatMessage } from './chat';

export type PredictionPick = 'white' | 'black' | 'draw';
export type GameResult = PredictionPick;

export interface PredictionState {
  /** nick → latest pick. */
  votes: Map<string, { pick: PredictionPick; displayName: string; color: string }>;
}

export function emptyPredictions(): PredictionState {
  return { votes: new Map() };
}

const COMMANDS: Record<string, PredictionPick> = {
  '!white': 'white',
  '!w': 'white',
  '!black': 'black',
  '!b': 'black',
  '!draw': 'draw',
  '!d': 'draw',
};

/** Returns the pick if the message is a prediction command, else null. */
export function parsePrediction(text: string): PredictionPick | null {
  const word = text.trim().toLowerCase().split(/\s+/)[0];
  return COMMANDS[word] ?? null;
}

/** Apply a chat message to the state. Returns true when it was a vote
 *  (callers re-render the tally only then). */
export function applyPrediction(state: PredictionState, msg: TwitchChatMessage): boolean {
  const pick = parsePrediction(msg.text);
  if (!pick) return false;
  state.votes.set(msg.nick, {
    pick,
    displayName: msg.displayName,
    color: msg.color,
  });
  return true;
}

export function tally(state: PredictionState): Record<PredictionPick, number> {
  const t: Record<PredictionPick, number> = { white: 0, black: 0, draw: 0 };
  for (const v of state.votes.values()) t[v.pick]++;
  return t;
}

export interface PredictionWinner {
  nick: string;
  displayName: string;
  color: string;
}

export function winnersFor(state: PredictionState, result: GameResult): PredictionWinner[] {
  const out: PredictionWinner[] = [];
  for (const [nick, v] of state.votes) {
    if (v.pick === result) out.push({ nick, displayName: v.displayName, color: v.color });
  }
  return out;
}
