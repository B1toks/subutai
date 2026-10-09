import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_SESSION_KEY } from './storage';
import { clearLiveSession, readLiveSession, writeLiveSession, type LiveSession } from './liveSession';

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

const session: LiveSession = {
  gameId: 'g1',
  opponentMode: 'local',
  gameMode: 'roulette',
  timed: true,
  savedAt: 123,
  botLevel: 'normal',
  unranked: false,
};

describe('live session pointer', () => {
  it('reads back what it wrote, under subutai_live_session', () => {
    writeLiveSession(session);
    expect(LIVE_SESSION_KEY).toBe('subutai_live_session');
    expect(JSON.parse(store.get(LIVE_SESSION_KEY)!)).toEqual(session);
    expect(readLiveSession()).toEqual(session);
  });
  it('is gone after a clear', () => {
    writeLiveSession(session);
    clearLiveSession();
    expect(readLiveSession()).toBeNull();
  });
  it('refuses a pointer without a game id or a time', () => {
    store.set(LIVE_SESSION_KEY, JSON.stringify({ savedAt: 1 }));
    expect(readLiveSession()).toBeNull();
    store.set(LIVE_SESSION_KEY, JSON.stringify({ gameId: 'g1' }));
    expect(readLiveSession()).toBeNull();
    store.set(LIVE_SESSION_KEY, '{not json');
    expect(readLiveSession()).toBeNull();
  });
  it('fills in an old pointer: vs AI, classic, untimed, no level, and unranked', () => {
    store.set(LIVE_SESSION_KEY, JSON.stringify({ gameId: 'g1', savedAt: 5, botLevel: 'grandmaster' }));
    expect(readLiveSession()).toEqual({
      gameId: 'g1',
      opponentMode: 'ai',
      gameMode: 'classic',
      timed: false,
      savedAt: 5,
      botLevel: undefined,
      unranked: true,
    });
  });
  it('lets a private-mode storage error pass quietly', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    expect(() => writeLiveSession(session)).not.toThrow();
    expect(() => clearLiveSession()).not.toThrow();
    expect(readLiveSession()).toBeNull();
  });
});
