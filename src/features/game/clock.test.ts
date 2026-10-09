import { describe, expect, it } from 'vitest';
import { formatClockFace, matchClocks } from './clock';

describe('formatClockFace', () => {
  it('always shows two-digit minutes and seconds', () => {
    expect(formatClockFace(0)).toBe('00:00');
    expect(formatClockFace(59_999)).toBe('00:59');
    expect(formatClockFace(61_000)).toBe('01:01');
  });
  it('grows past 99 minutes instead of wrapping', () => {
    expect(formatClockFace(100 * 60_000)).toBe('100:00');
  });
});

describe('matchClocks', () => {
  // White moved at 1 s and 10 s, Black at 4 s: Black spent 3 s, White 6 s.
  const moves = [{ timestamp: 1_000 }, { timestamp: 4_000 }, { timestamp: 10_000 }];

  it('without a time control counts up what each side spent, and never flags', () => {
    expect(matchClocks(moves, null, 0, false, 0)).toEqual({ white: 6_000, black: 3_000, countdown: false });
  });
  it('charges the time since the last move to the side on turn while the match is live', () => {
    expect(matchClocks(moves, null, 0, true, 15_000)).toEqual({ white: 6_000, black: 8_000, countdown: false });
    expect(matchClocks(moves.slice(0, 2), null, 0, true, 9_000)).toEqual({ white: 5_000, black: 3_000, countdown: false });
  });
  it('counts down from the control and credits each completed move its increment', () => {
    // White made 2 moves, Black 1: 60 s + n x 2 s - spent.
    expect(matchClocks(moves, 60, 2, false, 0)).toEqual({ white: 58_000, black: 59_000, countdown: true });
  });
  it('never shows less than zero', () => {
    expect(matchClocks(moves, 1, 0, true, 999_999).black).toBe(0);
  });
  it('starts both sides on the full control', () => {
    expect(matchClocks([], 180, 2, true, 5_000)).toEqual({ white: 180_000, black: 180_000, countdown: true });
  });
  it('ignores a stamp that runs backwards', () => {
    expect(matchClocks([{ timestamp: 5_000 }, { timestamp: 4_000 }], null, 0, false, 0).black).toBe(0);
  });
});
