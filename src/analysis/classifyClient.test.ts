import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPositionFromBackRankKey } from '../engine';
import { applyMove } from '../engine/moves';
import { legalMovesFor } from '../session/rules';

// A stand-in for the classifier worker: it records what it is sent and
// answers or fails only when a test tells it to.
const fake = vi.hoisted(() => {
  class FakeWorker {
    static made: FakeWorker[] = [];
    sent: { id: number }[] = [];
    terminated = false;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    constructor() {
      FakeWorker.made.push(this);
    }
    postMessage(msg: { id: number }) {
      this.sent.push(msg);
    }
    terminate() {
      this.terminated = true;
    }
  }
  return { FakeWorker };
});

vi.mock('./classify.worker.ts?worker', () => ({ default: fake.FakeWorker }));

const before = createPositionFromBackRankKey('RNBQKBNR');
const move = legalMovesFor('classic', before).find((m) => m.from === 'e2' && m.to === 'e4')!;
const after = applyMove(before, move);

beforeEach(() => {
  vi.resetModules();
  fake.FakeWorker.made = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('classifier worker that fails', () => {
  it('refuses every waiting request, ends the worker, and the next request builds a new one', async () => {
    const { classifyAsync } = await import('./classifyClient');
    const a = classifyAsync(before, move, after);
    const b = classifyAsync(before, move, after);
    const first = fake.FakeWorker.made[0];
    expect(first.sent).toHaveLength(2);
    first.onerror?.({ type: 'error' }); // a worker file that 404s
    await expect(a).rejects.toThrow('classifier worker failed');
    await expect(b).rejects.toThrow('classifier worker failed');
    expect(first.terminated).toBe(true);

    const c = classifyAsync(before, move, after);
    expect(fake.FakeWorker.made).toHaveLength(2);
    const second = fake.FakeWorker.made[1];
    const analysis = { classification: 'good', cpl: 3, searchScoreFromWhite: 20 };
    second.onmessage?.({ data: { id: second.sent[0].id, ok: true, analysis } });
    await expect(c).resolves.toEqual(analysis);
  });

  it('an error from a worker it has replaced changes nothing', async () => {
    const { classifyAsync, cancelPendingClassifications } = await import('./classifyClient');
    void classifyAsync(before, move, after);
    const old = fake.FakeWorker.made[0];
    cancelPendingClassifications();
    const fresh = classifyAsync(before, move, after);
    old.onerror?.({ type: 'error', message: 'late' });
    const w = fake.FakeWorker.made[1];
    const analysis = { classification: 'best', cpl: 0, searchScoreFromWhite: 0 };
    w.onmessage?.({ data: { id: w.sent[0].id, ok: true, analysis } });
    await expect(fresh).resolves.toEqual(analysis);
    expect(w.terminated).toBe(false);
  });
});
