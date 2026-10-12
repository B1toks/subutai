/**
 * The session's only source of chance: a mulberry32 stream whose whole
 * state is one 32-bit number kept in SessionState.rng.
 *
 * step() is pure, so it cannot call Math.random: a roulette spin draws
 * from the state's stream and hands the advanced state back. The same
 * seed always spins the same bags, which is what makes a game replayable
 * in a test.
 */

/** The stream state a game seeded with `seed` starts from. */
export function rngFromSeed(seed: number): number {
  // Fold the seed (a Date.now() value, wider than 32 bits) into 32 bits.
  return (Math.floor(seed) ^ Math.floor(seed / 0x100000000)) | 0;
}

/** One draw in [0, 1) and the state after it. */
export function rngNext(state: number): [value: number, next: number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/**
 * A `() => number` over the stream, for helpers that take a random source
 * (spinRoulette). `state()` reads where the stream stands after the draws.
 */
export function rngCursor(start: number): { random: () => number; state: () => number } {
  let s = start;
  return {
    random: () => {
      const [value, next] = rngNext(s);
      s = next;
      return value;
    },
    state: () => s,
  };
}
