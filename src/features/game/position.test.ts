import { describe, expect, it } from 'vitest';
import { createPositionFromBackRankKey, type BoardState, type Move, type Piece, type SquareId } from '../../engine';
import { applyMove, generateLegalMoves } from '../../engine/moves';
import { applyRotationMove } from '../../engine/auxetic';
import { PIECE_VALUE } from '../../ai/evaluate';
import { appendMove, createGameLog } from '../../recording/log';
import { replayFromNotation } from '../../memory/replayImport';
import { backRankString, bumpEvalForMove, evaluateFromWhite, gameEnding, replayBoardAt, samePieces, takenBy } from './position';

const start = createPositionFromBackRankKey('RNBQKBNR');
const piece = (color: Piece['color'], type: Piece['type'], id = `${color}-${type}`): Piece => ({ id, color, type });
const withPieces = (pieces: Partial<Record<SquareId, Piece>>, sideToMove: BoardState['sideToMove'] = 'white'): BoardState =>
  ({ ...start, pieces, sideToMove });

/** The legal move from one square to another in this position. */
function play(state: BoardState, from: SquareId, to: SquareId): BoardState {
  const move = generateLegalMoves(state).find((m) => m.from === from && m.to === to);
  if (!move) throw new Error(`no legal move ${from}-${to}`);
  return applyMove(state, move);
}

describe('backRankString', () => {
  it('reads the 960 key off rank 1', () => {
    expect(backRankString(start)).toBe('RNBQKBNR');
    expect(backRankString(createPositionFromBackRankKey('QRKRNBBN'))).toBe('QRKRNBBN');
  });
  it('marks empty squares and pawns with ?', () => {
    expect(backRankString(withPieces({ a1: piece('white', 'rook'), b1: piece('white', 'pawn') }))).toBe('R???????');
  });
});

describe('samePieces', () => {
  it('compares type and colour per square, not piece ids', () => {
    const a = { e1: piece('white', 'king', 'k1'), e8: piece('black', 'king') };
    expect(samePieces(a, { e1: piece('white', 'king', 'k2'), e8: piece('black', 'king') })).toBe(true);
    expect(samePieces(a, { e1: piece('white', 'king'), e8: piece('white', 'king') })).toBe(false);
    expect(samePieces(a, { e1: piece('white', 'king'), e8: piece('black', 'king'), a2: piece('white', 'pawn') })).toBe(false);
  });
});

describe('bumpEvalForMove', () => {
  const board = withPieces({
    e1: piece('white', 'king'),
    d1: piece('white', 'queen'),
    b7: piece('white', 'pawn'),
    e8: piece('black', 'king'),
    d8: piece('black', 'queen'),
    a2: piece('black', 'pawn'),
  });
  it('keeps no eval and a rotation as they are', () => {
    expect(bumpEvalForMove(null, board, { kind: 'normal', from: 'e1', to: 'f1' })).toBeNull();
    expect(bumpEvalForMove(40, board, { kind: 'topologyToggle' })).toBe(40);
  });
  it('adds a capture from White\'s side of the scale', () => {
    expect(bumpEvalForMove(0, board, { kind: 'capture', from: 'd1', to: 'd8' })).toBe(PIECE_VALUE.queen);
    expect(bumpEvalForMove(0, { ...board, sideToMove: 'black' }, { kind: 'capture', from: 'd8', to: 'd1' })).toBe(-PIECE_VALUE.queen);
  });
  it('credits en passant and promotion to the mover', () => {
    expect(bumpEvalForMove(0, board, { kind: 'enPassant', from: 'b7', to: 'c8' })).toBe(PIECE_VALUE.pawn);
    expect(bumpEvalForMove(0, board, { kind: 'promotion', from: 'b7', to: 'b8', promotion: 'queen' }))
      .toBe(PIECE_VALUE.queen - PIECE_VALUE.pawn);
    expect(bumpEvalForMove(0, { ...board, sideToMove: 'black' }, { kind: 'promotion', from: 'a2', to: 'a1', promotion: 'knight' }))
      .toBe(-(PIECE_VALUE.knight - PIECE_VALUE.pawn));
  });
});

describe('evaluateFromWhite', () => {
  it('is positive when White is a queen up, whoever is to move', () => {
    const up = { e1: piece('white', 'king'), d1: piece('white', 'queen'), e8: piece('black', 'king') };
    expect(evaluateFromWhite(withPieces(up, 'white'))).toBeGreaterThan(0);
    expect(evaluateFromWhite(withPieces(up, 'black'))).toBeGreaterThan(0);
  });
});

describe('replayBoardAt', () => {
  const e4 = generateLegalMoves(start).find((m) => m.from === 'e2' && m.to === 'e4') as Move;
  const afterE4 = applyMove(start, e4);
  let log = createGameLog('t', start, 1);
  log = appendMove(log, e4, 'e4');
  log = appendMove(log, { kind: 'topologyToggle' }, 'A→B');

  it('replays as many moves as asked, rotations included', () => {
    expect(replayBoardAt(log, 0)).toBe(start);
    expect(replayBoardAt(log, 1).pieces).toEqual(afterE4.pieces);
    expect(replayBoardAt(log, 2)).toEqual(applyRotationMove(afterE4));
  });
  it('stops at the end of the log', () => {
    expect(replayBoardAt(log, 99)).toEqual(replayBoardAt(log, 2));
  });
});

describe('gameEnding', () => {
  it('ends roulette only when a king is gone', () => {
    const kings = { e1: piece('white', 'king'), e8: piece('black', 'king') };
    expect(gameEnding('roulette', withPieces(kings))).toBeNull();
    expect(gameEnding('roulette', withPieces({ e1: piece('white', 'king') }))).toBe('king_captured_white_wins');
    expect(gameEnding('roulette', withPieces({ e8: piece('black', 'king') }))).toBe('king_captured_black_wins');
  });
  it('finds a mate in classic', () => {
    // qa/fixtures/endings.json "mate-A": one knight move from mate.
    const lead = replayFromNotation(
      '[Chess960 "QRKRNBBN"]\n[Seed "38"]\n\n1. d2→d4  a7→a5\n2. A→B  Ne8→f6@B\n3. Kc1→c3@B  b7→b6@B\n' +
        '4. f2→f3@B  B→A\n5. Ne1→d3  h7→h6\n6. b2→b3  A→B\n7. Rb1→a4@B  Kc8→b5@B\n8. d4→a5@B  h6→h3@B\n' +
        '9. Qa1→b2@B  B→A\n10. a5→b6  d7→d6\n11. e2→e4  Rb8→b6',
      { now: 0 },
    );
    expect(gameEnding('classic', lead.final)).toBeNull();
    expect(gameEnding('classic', play(lead.final, 'd3', 'e5'))).toBe('checkmate');
  });
  it('calls bare kings a draw in classic', () => {
    expect(gameEnding('classic', withPieces({ e1: piece('white', 'king'), e8: piece('black', 'king') }))).toBe('draw_material');
  });
});

describe('bumpEvalForMove (P7: a Chess960 castle is not a capture)', () => {
  it('a castle whose king lands on its own rook leaves the eval where it was', () => {
    const before = createPositionFromBackRankKey('RNBBQKRN');
    const castle = generateLegalMoves(before).find((m) => m.kind === 'castle')!;
    expect(castle.to).toBe(castle.castleRookFrom);
    expect(bumpEvalForMove(30, before, castle)).toBe(30);
  });
});

describe('takenBy (whose piece is taken is read off the mover, not the side to move)', () => {
  it('a Roulette second action, the board already showing the other side to move, still takes', () => {
    const before = withPieces(
      { e1: piece('white', 'king'), d4: piece('white', 'queen'), d7: piece('black', 'rook'), e8: piece('black', 'king') },
      'black',
    );
    const take: Move = { kind: 'normal', from: 'd4', to: 'd7' };
    expect(takenBy(before, take)?.type).toBe('rook');
  });
});
