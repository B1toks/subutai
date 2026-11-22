import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPositionFromBackRankKey } from '../engine';
import { legalMovesFor } from '../session/rules';

// A stand-in for the search worker: it records what it is sent and
// answers or fails only when a test tells it to.
const fake = vi.hoisted(() => {
  class FakeWorker {
    static made: FakeWorker[] = [];
    sent: { id: number; kind: string }[] = [];
    terminated = false;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    constructor() {
      FakeWorker.made.push(this);
    }
    postMessage(msg: { id: number; kind: string }) {
      this.sent.push(msg);
    }
    terminate() {
      this.terminated = true;
    }
    answer(id: number, result: unknown) {
      this.onmessage?.({ data: { id, ok: true, result } });
    }
    /** What a worker file that 404s, or a crash, raises on the Worker. */
    fail(message?: string) {
      this.onerror?.(message === undefined ? { type: 'error' } : { type: 'error', message });
    }
  }
  return { FakeWorker, reload: { can: false, marked: 0 } };
});

vi.mock('./search.worker.ts?worker', () => ({ default: fake.FakeWorker }));
vi.mock('../utils/chunkReload', () => ({
  canAutoReload: () => fake.reload.can,
  markAutoReload: () => {
    fake.reload.marked++;
    return true;
  },
}));

const board = createPositionFromBackRankKey('RNBQKBNR');
const options = { budgetMs: 40, maxDepth: 2 };
const flush = () => new Promise((r) => setTimeout(r, 0));
const pendingState = async <T>(p: Promise<T>) => {
  let settled = false;
  p.then(() => (settled = true), () => (settled = true));
  await flush();
  return settled ? 'settled' : 'pending';
};

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  fake.FakeWorker.made = [];
  fake.reload.can = false;
  fake.reload.marked = 0;
  reload = vi.fn();
  vi.stubGlobal('window', { location: { reload } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('search worker that fails', () => {
  it('refuses every waiting request, ends the worker, and the next request builds a new one', async () => {
    const { searchAsync } = await import('./searchClient');
    const a = searchAsync(board, options);
    const b = searchAsync(board, options);
    const first = fake.FakeWorker.made[0];
    expect(first.sent).toHaveLength(2);
    first.fail('boom');
    // Both were refused and searched here instead: neither is left hanging.
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.bestMove).not.toBeNull();
    expect(rb.bestMove).not.toBeNull();
    expect(first.terminated).toBe(true);

    const c = searchAsync(board, options);
    expect(fake.FakeWorker.made).toHaveLength(2);
    const second = fake.FakeWorker.made[1];
    const answer = { bestMove: null, score: 7, pv: [] };
    second.answer(second.sent[0].id, answer);
    await expect(c).resolves.toEqual(answer);
  });

  it('a worker file that did not load reloads the page once, and the requests wait for it', async () => {
    fake.reload.can = true;
    const { searchAsync } = await import('./searchClient');
    const a = searchAsync(board, options);
    const b = searchAsync(board, options);
    fake.FakeWorker.made[0].fail();
    expect(await pendingState(a)).toBe('pending');
    expect(await pendingState(b)).toBe('pending');
    expect(fake.reload.marked).toBe(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('already reloaded: the search runs on the main thread', async () => {
    fake.reload.can = false;
    const { searchAsync } = await import('./searchClient');
    const a = searchAsync(board, options);
    fake.FakeWorker.made[0].fail();
    const r = await a;
    expect(r.bestMove).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('a worker that crashes after it has answered is not a stale file: no reload, main thread', async () => {
    fake.reload.can = true;
    const { searchAsync } = await import('./searchClient');
    const first = searchAsync(board, options);
    const w = fake.FakeWorker.made[0];
    w.answer(w.sent[0].id, { bestMove: null, score: 0, pv: [] });
    await first;
    const next = searchAsync(board, options);
    w.fail('out of memory');
    const r = await next;
    expect(r.bestMove).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
    expect(fake.reload.marked).toBe(0);
  });

  it('one search failing inside a working worker is passed on, as before', async () => {
    const { searchAsync } = await import('./searchClient');
    const a = searchAsync(board, options);
    const w = fake.FakeWorker.made[0];
    w.onmessage?.({ data: { id: w.sent[0].id, ok: false, error: 'bad position' } });
    await expect(a).rejects.toThrow('bad position');
    expect(w.terminated).toBe(false);
  });

  it('the bot still moves: chooseBotMove answers with a legal move', async () => {
    const { chooseBotMove } = await import('./searchClient');
    const legal = legalMovesFor('classic', board);
    const move = chooseBotMove(board, legal, { strength: 'strong' });
    fake.FakeWorker.made[0].fail();
    const chosen = await move;
    expect(chosen).not.toBeNull();
    expect(legal.some((m) => m.from === chosen!.from && m.to === chosen!.to && m.kind === chosen!.kind)).toBe(true);
  });

  // Vitest fails the run on an unhandled rejection, so settling is the check.
  it('a new game clearing the table does not leave a rejection behind', async () => {
    const { clearSearchTable } = await import('./searchClient');
    clearSearchTable();
    fake.FakeWorker.made[0].fail();
    await flush();
    await flush();
    expect(fake.FakeWorker.made[0].terminated).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });
});
