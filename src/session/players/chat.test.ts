import { describe, expect, it } from 'vitest';
import { createStartingPosition, type Move } from '../../engine';
import { createStore } from '../store';
import { createSession, step } from '../step';
import type { Action, SessionEvent, SessionState } from '../types';
import { createChatPlayer, withGuess } from './chat';
import { createHumanPlayer } from './human';
import { createTurns } from './turns';

const newStore = () =>
  createStore<SessionState, Action, SessionEvent>(createSession({ initial: createStartingPosition(3), seed: 3, now: 0 }), step);
const flush = () => new Promise((r) => setTimeout(r, 0));
const firstMove = (s: SessionState) => s.legal.find((m) => m.kind !== 'topologyToggle' && m.from && m.to)!;

describe('chat player', () => {
  it('plays the elected move as chat\'s, and tells what followed it', async () => {
    const store = newStore();
    const turns = createTurns(store);
    const seen: string[] = [];
    const chat = createChatPlayer({
      color: 'white',
      elect: (_board, legal) => Promise.resolve(legal.find((m) => m.kind !== 'topologyToggle' && m.from && m.to) ?? null),
      cancel: () => seen.push('cancel'),
      played: (action, events, _before, index) => seen.push(`${action.type} by ${events.find((e) => e.type === 'move')?.actor} at ${index}`),
    });
    turns.seat({ white: chat, black: null });
    await flush();
    await flush();
    expect(store.getState().log.moves.length).toBe(1);
    // An answered turn is not aborted: chat's round is revealed by then,
    // and cancelRound leaves a revealed round alone anyway.
    expect(seen).toEqual(['move by chat at 0']);
    turns.stop();
  });

  it('the player here shares the seat: their move first drops the vote', async () => {
    const store = newStore();
    const turns = createTurns(store);
    let elected: (m: Move | null) => void = () => {};
    let cancels = 0;
    const chat = createChatPlayer({
      color: 'white',
      elect: () => new Promise((r) => { elected = r; }),
      cancel: () => cancels++,
      played: () => { throw new Error('chat did not play'); },
    });
    turns.seat({ white: chat, black: null });
    const asked = store.getState();
    expect(turns.act({ type: 'move', move: firstMove(asked), actor: 'human', now: 0 }).length).toBeGreaterThan(0);
    expect(cancels).toBe(1);
    elected(firstMove(asked)); // too late: the turn is over
    await flush();
    expect(store.getState().log.moves.length).toBe(1);
    turns.stop();
  });

  it('votes only in classic games', async () => {
    const store = newStore();
    store.dispatch({ type: 'setMode', mode: 'roulette' });
    const turns = createTurns(store);
    let votes = 0;
    turns.seat({
      white: createChatPlayer({ color: 'white', elect: () => { votes++; return Promise.resolve(null); }, cancel: () => {}, played: () => {} }),
      black: null,
    });
    await flush();
    expect(votes).toBe(0);
    turns.stop();
  });
});

describe('guess the streamer', () => {
  it('opens a guess with the player\'s turn and drops it when the turn ends', () => {
    const store = newStore();
    const turns = createTurns(store);
    const seen: string[] = [];
    const guess = withGuess(createHumanPlayer('white'), {
      open: (board) => seen.push(`open ${board.sideToMove}`),
      cancel: () => seen.push('cancel'),
    });
    turns.seat({ white: guess, black: null });
    expect(seen).toEqual(['open white']);
    turns.act({ type: 'move', move: firstMove(store.getState()), actor: 'human', now: 0 });
    expect(seen).toEqual(['open white', 'cancel']);
    turns.stop();
  });
});
