// Logs that reach a position where a move of a given kind is legal: legal
// moves from a Chess960 start, each written as the online hook writes it
// ({ move, san, topology, timestamp }, MultiplayerGameView sendMove). The
// rules tests seed a match with such a log, then the app's own hook plays
// the move, so every kind of entry the client writes goes through the rules.
// Deterministic: the same seeds give the same games on every run.
const { createPositionFromBackRankKey } = await import('../../src/engine/index.ts');
const { applyMove, generateLegalMoves } = await import('../../src/engine/moves.ts');
const { applyRotationMove } = await import('../../src/engine/auxetic.ts');
const { computeSAN } = await import('../../src/recording/log.ts');

/** Rebuilds the board from a log the way rebuildBoardFromMatch does. */
export function boardAfter(key, entries) {
  let state = createPositionFromBackRankKey(key);
  for (const e of entries) {
    state = e.move.kind === 'topologyToggle' ? applyRotationMove(state) : applyMove(state, e.move);
  }
  return state;
}

/**
 * A log after which the side to move has a legal move of `kind` (and, for
 * a promotion, of that piece). `rotateFirst`: the game starts with a
 * rotation, so the move is played in topology B. Timestamps are filled in
 * by stampLog() when the log is seeded.
 */
export function logReaching(kind, { key = 'RNBQKBNR', rotateFirst = false, promotion = null, maxPlies = 400, seeds = 3000 } = {}) {
  for (let seed = 1; seed <= seeds; seed++) {
    let rnd = seed;
    const next = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
    let state = createPositionFromBackRankKey(key);
    const entries = [];
    const play = (move) => {
      entries.push({ move, san: computeSAN(state, move), topology: state.topologyState });
      state = move.kind === 'topologyToggle' ? applyRotationMove(state) : applyMove(state, move);
    };
    if (rotateFirst) play({ kind: 'topologyToggle' });
    for (let ply = entries.length; ply < maxPlies; ply++) {
      const legal = generateLegalMoves(state).filter((m) => m.kind !== 'topologyToggle');
      if (legal.length === 0) break;
      const hit = legal.find((m) => m.kind === kind && (promotion === null || m.promotion === promotion));
      if (hit) return { key, entries, move: hit, sideToMove: state.sideToMove };
      play(legal[Math.floor(next() * legal.length)]);
    }
  }
  throw new Error(`no game reached a legal ${kind}`);
}

/** The entries with timestamps a second apart, ending a minute ago. */
export function stampLog(entries, now = Date.now()) {
  return entries.map((e, i) => ({ ...e, timestamp: now - 60_000 - (entries.length - i) * 1000 }));
}
