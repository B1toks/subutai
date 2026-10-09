import { describe, expect, it } from 'vitest';
import { boardSizeFor } from './boardSize';

// The expected sizes are the board widths QA measured in the browser
// (chess-qa retest2-layout "widths").
const size = (width: number, height: number, scale = 1, left = 0, right = 0) =>
  boardSizeFor({ width, height }, scale, left, right);

describe('boardSizeFor', () => {
  it('matches the board QA measured at common sizes', () => {
    expect(size(1366, 900)).toBe(630);
    expect(size(1366, 700)).toBe(490);
    expect(size(721, 900)).toBe(581);
    expect(size(720, 900)).toBe(630);
    expect(size(641, 1100)).toBe(593);
    expect(size(375, 760)).toBe(343);
    expect(size(881, 900)).toBe(489);
  });
  it('steps the sidebar and the cap up on big monitors', () => {
    expect(size(2560, 2000)).toBe(1000);
    expect(size(1800, 2000)).toBe(900);
    expect(size(1800, 2000) - size(1699, 2000)).toBeGreaterThan(0);
  });
  it('reserves room for docked panels only above 720px', () => {
    expect(size(1366, 1400, 1, 200, 100)).toBe(1366 - 392 - 300);
    expect(size(600, 1400, 1, 200, 100)).toBe(size(600, 1400));
  });
  it('lays out in zoom space', () => {
    expect(size(1366, 900, 1.25)).toBe(Math.round(900 / 1.25 * 0.7));
  });
  it('never goes below 240px, even in a zero-size tab', () => {
    expect(size(0, 0)).toBe(240);
  });
});
