import { describe, expect, it } from 'vitest';
import { glyphForPiece } from './pieceGlyph';

describe('glyphForPiece', () => {
  it('draws both colours with the filled glyph', () => {
    expect(glyphForPiece('white', 'queen')).toBe('♛');
    expect(glyphForPiece('black', 'queen')).toBe(glyphForPiece('white', 'queen'));
    expect(glyphForPiece('black', 'knight')).toBe('♞');
  });
  it('asks for the text form of the pawn, never the emoji', () => {
    expect(glyphForPiece('white', 'pawn')).toBe('♟︎');
  });
  it('draws nothing for an unknown piece', () => {
    expect(glyphForPiece('white', 'archbishop')).toBe('');
  });
});
