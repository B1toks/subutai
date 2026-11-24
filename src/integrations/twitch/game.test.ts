import { describe, expect, it, vi } from 'vitest';
import { createStartingPosition } from '../../engine';
import { createStore } from '../../session/store';
import { createSession, step } from '../../session/step';
import type { Action, SessionEvent, SessionState } from '../../session/types';
import { twitchChat, type TwitchChatMessage } from './chat';
import { moveVoting } from './moveVoting';
import { resultOf, twitchGame, type TwitchGameChange } from './game';

// Chat's game follows the session, not the panel: a new game clears the
// result calls and the leaderboard, the end of the game scores the calls.

const say = (nick: string, text: string): TwitchChatMessage => ({
  id: `${nick}-${text}`,
  nick,
  displayName: nick,
  color: '',
  text,
  ts: 0,
});

describe('twitchGame', () => {
  it('scores the result calls when the game ends, and a new game clears them', () => {
    let hear: (m: TwitchChatMessage) => void = () => {};
    vi.spyOn(twitchChat, 'onMessage').mockImplementation((cb) => {
      hear = cb;
      return () => {};
    });
    const store = createStore<SessionState, Action, SessionEvent>(
      createSession({ initial: createStartingPosition(7), seed: 7, now: 0 }),
      step,
    );
    const changes: TwitchGameChange[] = [];
    twitchGame.onChange((what) => changes.push(what));
    twitchGame.follow(store);
    expect(changes).toEqual([]); // the game already on the board is not a new one

    hear(say('ann', '!white'));
    hear(say('bob', '!w'));
    hear(say('ann', '!b')); // the latest call counts
    hear(say('cy', 'gg'));
    expect(twitchGame.counts()).toEqual({ white: 1, black: 1, draw: 0 });
    expect(twitchGame.getResult()).toBeNull();

    store.dispatch({ type: 'resign', side: 'white' });
    expect(twitchGame.getResult()).toBe('black');
    expect(changes).toEqual(['ended']);
    expect(moveVoting.getScores()).toEqual([expect.objectContaining({ nick: 'ann', points: 3 })]);

    store.dispatch({ type: 'newGame', initial: createStartingPosition(9), now: 1 });
    expect(changes).toEqual(['ended', 'newGame']);
    expect(twitchGame.counts()).toEqual({ white: 0, black: 0, draw: 0 });
    expect(twitchGame.getResult()).toBeNull();
    expect(moveVoting.getScores()).toEqual([]);
  });

  it('reads the result off the game on the board', () => {
    const s = createSession({ initial: createStartingPosition(7), seed: 7, now: 0 });
    expect(resultOf(s)).toBeNull();
    expect(resultOf(step(s, { type: 'resign', side: 'black' }).state)).toBe('white');
  });

  it('a loss on time is a result too (P6)', () => {
    const s = createSession({ initial: createStartingPosition(7), seed: 7, now: 0 });
    expect(resultOf(step(s, { type: 'flag', side: 'white' }).state)).toBe('black');
    expect(resultOf(step(s, { type: 'flag', side: 'black' }).state)).toBe('white');
  });
});
