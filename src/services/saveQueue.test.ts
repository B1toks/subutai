import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStartingPosition } from '../engine';
import { createGameLog } from '../recording/log';
import { memoryGames } from '../infra/fakes/memoryGames';
import { createSaveQueue, type FinishedGameSave, type SaveSummary } from './saveQueue';

const job = (id: string, total: number): FinishedGameSave => ({
  outcome: 'human-win',
  points: { total } as FinishedGameSave['points'],
  durationMs: 1000,
  log: createGameLog(id, createStartingPosition(1), 1, 0),
  gameMode: 'classic',
  botLevel: 'strong',
  chess960Id: 'RNBQKBNR',
  seed: 1,
});

/** A summary that shows `shown` and writes down what it is told. */
function summary(shown: string | null = null) {
  const seen: string[] = [];
  let current = shown;
  const s: SaveSummary = {
    shows: (id) => id === current,
    setSaving: (v) => seen.push(`saving ${v}`),
    setPersonalBest: (v) => seen.push(`best ${v}`),
    setSaved: (r) => seen.push(`saved ${r.gameId} new=${r.isNewBest} rank=${r.newRank}`),
    setError: (m) => seen.push(`error ${m}`),
  };
  return { s, seen, show: (id: string | null) => { current = id; } };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('save queue', () => {
  afterEach(() => vi.restoreAllMocks());

  it('saves one game at a time, in order', async () => {
    const games = memoryGames();
    const q = createSaveQueue(games.repo, summary().s);
    games.hold();
    const a = q.queue(job('a', 50), 'u', 'Name');
    const b = q.queue(job('b', 60), 'u', 'Name');
    await flush();
    // a is in flight; b has not started
    expect(games.calls).toEqual(['best', 'save a']);
    games.release();
    await Promise.all([a, b]);
    expect(games.calls).toEqual(['best', 'save a', 'saved a', 'best', 'save b', 'saved b']);
    expect(games.saved.map((g) => g.log.id)).toEqual(['a', 'b']);
    expect(games.saved[0]).toMatchObject({ uid: 'u', displayName: 'Name', humanColor: 'white', botLevel: 'strong' });
  });

  it('fills the summary of the game it shows, the old best first, then the new one', async () => {
    const games = memoryGames({ best: 40 });
    const ui = summary('a');
    await createSaveQueue(games.repo, ui.s).queue(job('a', 50), 'u', 'Name');
    expect(ui.seen).toEqual(['saving true', 'best 40', 'saved g1 new=true rank=1', 'best 50', 'saving false']);
  });

  it('leaves alone a summary that shows another game', async () => {
    const games = memoryGames();
    const ui = summary('other');
    await createSaveQueue(games.repo, ui.s).queue(job('a', 50), 'u', 'Name');
    expect(ui.seen).toEqual([]);
    expect(games.saved).toHaveLength(1);
  });

  it('tells a refusal by the rules from a lost connection, and never rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const games = memoryGames();
    const ui = summary('a');
    const q = createSaveQueue(games.repo, ui.s);
    games.failNext({ code: 'permission-denied' });
    await expect(q.queue(job('a', 50), 'u', 'Name')).resolves.toBeUndefined();
    games.failNext(new Error('offline'));
    await q.queue(job('a', 50), 'u', 'Name');
    expect(ui.seen.filter((x) => x.startsWith('error'))).toEqual([
      'error This game wasn’t counted: the server refused to save it.',
      'error Could not save this game. Check your connection.',
    ]);
    // the queue goes on after a failure
    await q.queue(job('a', 50), 'u', 'Name');
    expect(games.saved).toHaveLength(1);
  });
});
