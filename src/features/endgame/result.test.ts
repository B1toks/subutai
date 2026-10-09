import { describe, expect, it } from 'vitest';
import type { GameStatus } from '../../shared/game';
import { gameOverText, memoryTermination, soloOutcome, winnerOf } from './result';

const DRAWS: GameStatus[] = ['draw_stalemate', 'draw_material', 'draw_repetition', 'draw_50move', 'draw_agreement'];

describe('winnerOf', () => {
  it('gives a mate to the side that is not to move', () => {
    expect(winnerOf('checkmate', 'black')).toBe('white');
    expect(winnerOf('checkmate', 'white')).toBe('black');
  });
  it('reads the winner out of every other decisive ending', () => {
    expect(winnerOf('king_captured_white_wins', 'black')).toBe('white');
    expect(winnerOf('king_captured_black_wins', 'white')).toBe('black');
    expect(winnerOf('timeout_white', 'white')).toBe('black');
    expect(winnerOf('timeout_black', 'black')).toBe('white');
    expect(winnerOf('resigned_white', 'white')).toBe('black');
    expect(winnerOf('resigned_black', 'white')).toBe('white');
  });
  it('has no winner while the game is on or drawn', () => {
    for (const s of ['active', ...DRAWS] as GameStatus[]) expect(winnerOf(s, 'white')).toBeNull();
  });
});

describe('gameOverText', () => {
  it('says how the game ended and who won', () => {
    expect(gameOverText('checkmate', 'black')).toBe('Checkmate! White wins');
    expect(gameOverText('draw_agreement', 'white')).toBe('Draw by agreement');
    expect(gameOverText('draw_50move', 'white')).toBe('Draw: 50-move rule');
    expect(gameOverText('king_captured_black_wins', 'white')).toBe('King captured! Black wins');
    expect(gameOverText('timeout_white', 'white')).toBe('White ran out of time. Black wins');
    expect(gameOverText('resigned_black', 'black')).toBe('Black resigned. White wins');
  });
  it('says nothing while the game is on', () => {
    expect(gameOverText('active', 'white')).toBeNull();
  });
});

describe('soloOutcome', () => {
  it('scores from the human side: White', () => {
    expect(soloOutcome('checkmate', 'black')).toBe('human-win');
    expect(soloOutcome('checkmate', 'white')).toBe('ai-win');
    expect(soloOutcome('king_captured_white_wins', 'black')).toBe('human-win');
    expect(soloOutcome('king_captured_black_wins', 'white')).toBe('ai-win');
    expect(soloOutcome('timeout_white', 'white')).toBe('ai-win');
    expect(soloOutcome('timeout_black', 'black')).toBe('human-win');
  });
  it('calls every draw a draw', () => {
    for (const s of DRAWS) expect(soloOutcome(s, 'white')).toBe('draw');
  });
});

describe('memoryTermination', () => {
  it('files decisive endings as checkmate, resignations and agreements by name, other draws as stalemate', () => {
    expect(memoryTermination('checkmate')).toBe('checkmate');
    expect(memoryTermination('timeout_black')).toBe('checkmate');
    expect(memoryTermination('king_captured_white_wins')).toBe('checkmate');
    expect(memoryTermination('resigned_white')).toBe('resignation');
    expect(memoryTermination('draw_agreement')).toBe('agreement');
    expect(memoryTermination('draw_repetition')).toBe('stalemate');
  });
});
