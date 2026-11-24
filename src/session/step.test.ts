import { describe, expect, it } from 'vitest';
import { createStartingPosition } from '../engine';
import { applyMove } from '../engine/moves';
import { appendMove, computeSAN } from '../recording/log';
import { replayFromNotation } from '../memory/replayImport';
import { legalMovesFor } from './rules';
import { createSession, statusOf, step } from './step';
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

describe('settle (the bot asks whether its move ended the game)', () => {
  // White to move; after Ng1-e2 Black mates with Nd4-f3.
  const LINE = '[Chess960 "RNBQKBNR"]\n[Seed "7"]\n\n1. Nb1→a3  f7→f5\n2. g2→g4  Nb8→c6\n3. Na3→b1  a7→a6\n4. e2→e3  Nc6→d4';
  /** Black has just mated, with the end of the game left to a settle. */
  function mated() {
    const { final } = replayFromNotation(LINE);
    const human = legalMovesFor('classic', final).find((m) => m.from === 'g1' && m.to === 'e2')!;
    const s0 = { ...createSession({ initial: applyMove(final, human), seed: 7, now: NOW }), phase: { tag: 'playing' } } as SessionState;
    const mate = s0.legal.find((m) => m.from === 'd4' && m.to === 'f3')!;
    return step(s0, { type: 'move', move: mate, actor: 'bot', now: NOW, settle: false }).state;
  }

  it('ends the game the move was played in', () => {
    const s = mated();
    expect(statusOf(s)).toBe('active');
    const out = step(s, { type: 'settle', board: s.board, lastWasRotation: false, logId: s.log.id, plies: 1 });
    expect(statusOf(out.state)).toBe('checkmate');
  });

  it('is dropped once another game is on the board, or its log no longer has that move', () => {
    const s = mated();
    const other = { ...s, log: { ...s.log, id: 'another-game' } };
    const asked = { type: 'settle', board: s.board, lastWasRotation: false, logId: s.log.id, plies: 1 } as const;
    expect(statusOf(step(other, asked).state)).toBe('active');
    expect(statusOf(step(s, { ...asked, plies: 2 }).state)).toBe('active');
  });

  it('still applies after a later move of the same game (a draw made by the bot move is not lost)', () => {
    const s = mated();
    // The log has grown past the bot's move (the human moved meanwhile).
    const later = { ...s, log: { ...s.log, moves: [...s.log.moves, s.log.moves[0]] } };
    const asked = { type: 'settle', board: s.board, lastWasRotation: false, logId: s.log.id, plies: 1 } as const;
    expect(statusOf(step(later, asked).state)).toBe('checkmate');
  });
});

describe('the clocks of a game put aside (P4: Watch, then Stop)', () => {
  it('a game put back with its clocks keeps them; any other game starts from zero', () => {
    const s0 = fresh();
    const move = s0.legal.find((m) => m.kind === 'normal')!;
    let s = step(s0, { type: 'move', move, actor: 'human', now: NOW }).state;
    s = step(s, { type: 'clockTick', dt: 290_000 }).state;
    const own = { board: s.board, initial: s.initial, log: s.log, clock: s.clock };
    expect(s.clock.black).toBe(290_000);
    // Watch: a leaderboard game, from its first position.
    const watched = step(s, { type: 'load', game: { board: s0.board, log: { ...s0.log, id: 'watched', moves: [] } } }).state;
    expect(watched.clock).toEqual({ white: 0, black: 0 });
    // Stop: the own game, with the time it had used.
    const back = step(watched, { type: 'load', game: own }).state;
    expect(back.clock).toEqual({ white: 0, black: 290_000 });
  });
});
