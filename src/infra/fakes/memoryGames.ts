import type { GamesRepo } from '../repos';

type SaveArgs = Parameters<GamesRepo['saveCompleted']>[0];

/**
 * Unit tests only: a GamesRepo that keeps what it is asked to save in
 * memory. Nothing in the app imports this file, so it never reaches the
 * build. `hold()` makes the next save wait until `release()` (to see what
 * runs while a save is in flight); `failNext(err)` makes it throw.
 */
export function memoryGames(opts: { best?: number | null } = {}) {
  const saved: SaveArgs[] = [];
  const calls: string[] = [];
  let best = opts.best ?? null;
  let gate: { release: () => void; promise: Promise<void> } | null = null;
  let failure: unknown = null;

  const repo: GamesRepo = {
    async saveCompleted(args) {
      calls.push(`save ${args.log.id}`);
      if (gate) await gate.promise;
      if (failure !== null) {
        const err = failure;
        failure = null;
        throw err;
      }
      saved.push(args);
      const isNewBest = best === null || args.points.total > best;
      if (isNewBest) best = args.points.total;
      calls.push(`saved ${args.log.id}`);
      return { gameId: `g${saved.length}`, isNewBest, newRank: isNewBest ? 1 : 2 };
    },
    async personalBest() {
      calls.push('best');
      return best;
    },
    async fetchSaved() {
      return null;
    },
    async saveMultiplayer() {
      calls.push('saveMultiplayer');
    },
    async saveTraining() {
      calls.push('saveTraining');
      return `t${calls.length}`;
    },
    logStart() {
      calls.push('logStart');
    },
  };

  return {
    repo,
    saved,
    calls,
    hold() {
      let release = () => {};
      const promise = new Promise<void>((r) => {
        release = r;
      });
      gate = { release, promise };
    },
    release() {
      const g = gate;
      gate = null;
      g?.release();
    },
    failNext(err: unknown) {
      failure = err;
    },
  };
}
