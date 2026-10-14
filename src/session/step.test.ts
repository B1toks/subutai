import { describe, expect, it } from 'vitest';
import { createStartingPosition } from '../engine';
import { applyMove } from '../engine/moves';
import { appendMove, computeSAN } from '../recording/log';
import { createSession, step } from './step';
import type { SessionState } from './types';

const NOW = 1_760_000_000_000;

function fresh(): SessionState {
  return createSession({ initial: createStartingPosition(7), seed: 7, now: NOW });
}

/** The session after one pawn move, as a watched replay frame would show it. */
function oneMoveLater(s: SessionState) {
  const move = s.legal.find((m) => s.board.pieces[m.from!]?.type === 'pawn' && m.kind === 'normal')!;
  const board = applyMove(s.board, move);
  const log = appendMove(s.log, move, computeSAN(s.board, move), s.board.topologyState, undefined, NOW);
  return { move, board, log };
}

describe('load', () => {
  it('a replay frame one move on plays that move out as a replayed event', () => {
    const s = fresh();
    const { move, board, log } = oneMoveLater(s);
    const out = step(s, { type: 'load', game: { board, log }, replayStep: true });
    expect(out.events[0]).toMatchObject({ type: 'move', actor: 'replay', move, index: 0 });
  });

  it('a game put back on the board plays nothing out (resume, Load replay)', () => {
    const s = fresh();
    const { board, log } = oneMoveLater(s);
    const resumed = { ...log, id: 'resume-1' };
    expect(step(s, { type: 'load', game: { board, log: resumed }, fresh: true }).events).toEqual([]);
    // Not even a longer log of the same game, unless it is a replay step.
    expect(step(s, { type: 'load', game: { board, log } }).events).toEqual([]);
  });

  it('a load that does not lengthen the log is silent', () => {
    const s = fresh();
    const out = step(s, { type: 'load', game: { board: s.board, log: s.log } });
    expect(out.events).toEqual([]);
  });
});
