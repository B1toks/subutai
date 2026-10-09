import { describe, expect, it } from 'vitest';
import { roomColors } from './roomColors';

describe('roomColors', () => {
  it('keeps the room neutral within about 40 centipawns', () => {
    expect(roomColors(0, 'A', 'wood')).toEqual({ c1: '#2a2520', c2: '#1a1612' });
    expect(roomColors(40, 'A', 'wood')).toEqual({ c1: '#2a2520', c2: '#1a1612' });
    expect(roomColors(-40, 'B', 'fantasy')).toEqual({ c1: '#1a1c2a', c2: '#12131f' });
  });
  it('warms up when winning and goes red when losing in topology A', () => {
    expect(roomColors(400, 'A', 'wood').c1).toMatch(/^hsl\(45,/);
    expect(roomColors(-400, 'A', 'wood').c1).toMatch(/^hsl\(355,/);
  });
  it('goes cool when winning and dark rather than violet when losing in topology B', () => {
    expect(roomColors(400, 'B', 'wood').c1).toMatch(/^hsl\(195,/);
    expect(roomColors(-400, 'B', 'fantasy').c1).toMatch(/^hsl\(350,/);
  });
  it('gives the light board its own cream ramp, whatever the topology', () => {
    expect(roomColors(0, 'B', 'wood-light')).toEqual({ c1: '#f6f1e8', c2: '#ede5d5' });
    expect(roomColors(400, 'A', 'wood-light').c1).toMatch(/^hsl\(42,/);
    expect(roomColors(-400, 'B', 'wood-light').c1).toMatch(/^hsl\(355,/);
  });
  it('keeps Neon in the indigo family, cyan/magenta in A and teal/violet in B', () => {
    expect(roomColors(400, 'A', 'neon').c1).toMatch(/^hsl\(195,/);
    expect(roomColors(400, 'B', 'neon').c1).toMatch(/^hsl\(170,/);
    expect(roomColors(-400, 'A', 'neon').c1).toMatch(/^hsl\(320,/);
    expect(roomColors(-400, 'B', 'neon').c1).toMatch(/^hsl\(275,/);
    expect(roomColors(0, 'B', 'neon')).toEqual({ c1: '#141a33', c2: '#0f1224' });
  });
  it('saturates instead of running away on a crushing lead', () => {
    expect(roomColors(100_000, 'A', 'wood')).toEqual(roomColors(50_000, 'A', 'wood'));
  });
});
