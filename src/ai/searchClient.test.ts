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
  return { FakeWorker };
});

vi.mock('./search.worker.ts?worker', () => ({ default: fake.FakeWorker }));

const board = createPositionFromBackRankKey('RNBQKBNR');
const options = { budgetMs: 40, maxDepth: 2 };
const flush = () => new Promise((r) => setTimeout(r, 0));

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  fake.FakeWorker.made = [];
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
  it('refuses every waiting request, ends the worker, and the page searches on the main thread from then on', async () => {
    const { searchAsync } = await import('./searchClient');
    // A worker that has answered once, then crashes with two requests waiting.
    const warm = searchAsync(board, options);
    const first = fake.FakeWorker.made[0];
    first.answer(first.sent[0].id, { bestMove: null, score: 0, pv: [] });
    await warm;
    const a = searchAsync(board, options);
    const b = searchAsync(board, options);
    expect(first.sent).toHaveLength(3);
    first.fail('out of memory');
    // Both were refused and searched here instead: neither is left hanging.
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.bestMove).not.toBeNull();
    expect(rb.bestMove).not.toBeNull();
    expect(first.terminated).toBe(true);

    // No new worker: the next search runs here too.
    const c = await searchAsync(board, options);
    expect(c.bestMove).not.toBeNull();
    expect(fake.FakeWorker.made).toHaveLength(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a worker file that did not load: no reload, the search runs on the main thread, and so does every later one', async () => {
    const { searchAsync, clearSearchTable } = await import('./searchClient');
    const a = searchAsync(board, options);
    const b = searchAsync(board, options);
    fake.FakeWorker.made[0].fail(); // a worker file that 404s raises a bare Event
    expect((await a).bestMove).not.toBeNull();
    expect((await b).bestMove).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();

    // A new game, then its first search: the file is not fetched again.
    clearSearchTable();
    expect((await searchAsync(board, options)).bestMove).not.toBeNull();
    expect(fake.FakeWorker.made).toHaveLength(1);
    expect(fake.FakeWorker.made[0].sent).toHaveLength(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it('one search failing inside a working worker is passed on, as before', async () => {
    const { searchAsync } = await import('./searchClient');
    const a = searchAsync(board, options);
    const w = fake.FakeWorker.made[0];
    w.onmessage?.({ data: { id: w.sent[0].id, ok: false, error: 'bad position' } });
    await expect(a).rejects.toThrow('bad position');
    expect(w.terminated).toBe(false);
    // The worker is still used for the next search.
    void searchAsync(board, options);
    expect(fake.FakeWorker.made).toHaveLength(1);
    expect(w.sent).toHaveLength(2);
  });

  it('the bot still moves: chooseBotMove answers with a legal move', async () => {
    const { chooseBotMove } = await import('./searchClient');
    const legal = legalMovesFor('classic', board);
    const move = chooseBotMove(board, legal, { strength: 'strong' });
    fake.FakeWorker.made[0].fail();
    const chosen = await move;
    expect(chosen).not.toBeNull();
    expect(legal.some((m) => m.from === chosen!.from && m.to === chosen!.to && m.kind === chosen!.kind)).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  // Vitest fails the run on an unhandled rejection, so settling is the check.
  it('a new game clearing the table does not leave a rejection behind', async () => {
    const { clearSearchTable, searchAsync } = await import('./searchClient');
    clearSearchTable();
    fake.FakeWorker.made[0].fail();
    await flush();
    await flush();
    expect(fake.FakeWorker.made[0].terminated).toBe(true);
    expect((await searchAsync(board, options)).bestMove).not.toBeNull();
    expect(fake.FakeWorker.made).toHaveLength(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
