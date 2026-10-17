import type { GamesRepo } from '../infra/repos';
import { HUMAN_COLOR, type GameMode } from '../shared/game';
import type { GameOutcome, GamePoints } from '../analysis/points';
import type { GameLog } from '../recording/log';
import type { BotStrength } from '../ai/agents';

/** A finished solo game, as finishGame hands it to the Firestore save. */
export interface FinishedGameSave {
  outcome: GameOutcome;
  points: GamePoints;
  durationMs: number;
  log: GameLog;
  gameMode: GameMode;
  botLevel: BotStrength;
  chess960Id: string;
  seed: number;
}

/** What a save fills in on the summary of its game. */
export interface SaveSummary {
  /** Is this game still the one the summary shows? */
  shows(logId: string): boolean;
  setSaving(saving: boolean): void;
  setPersonalBest(best: number | null): void;
  setSaved(result: { gameId: string; isNewBest: boolean; newRank: number | null }): void;
  setError(message: string): void;
}

/**
 * Saves finished solo games one at a time (QA-06: the rules count a Strong
 * win only for a game saved after the profile's previous save, so two
 * saves racing could refuse the later one's stats), and fills the summary
 * of a game while it is still the one shown. A save never rejects: a
 * failure is a message on that summary.
 */
export function createSaveQueue(games: GamesRepo, summary: SaveSummary) {
  /** The Firestore half of finishGame (also run later, see N-6). */
  async function saveFinishedGame(job: FinishedGameSave, uid: string, name: string) {
    const stillShown = () => summary.shows(job.log.id);
    if (stillShown()) summary.setSaving(true);
    try {
      // Snapshot the pre-write best so the modal can show "old" alongside new.
      const oldBest = await games.personalBest(uid, job.gameMode);
      if (stillShown()) summary.setPersonalBest(oldBest);

      const { gameId, isNewBest, newRank } = await games.saveCompleted({
        uid,
        displayName: name,
        log: job.log,
        outcome: job.outcome,
        points: job.points,
        chess960Id: job.chess960Id,
        seed: job.seed,
        humanColor: HUMAN_COLOR,
        gameMode: job.gameMode,
        durationMs: job.durationMs,
        botLevel: job.botLevel,
      });
      if (stillShown()) {
        summary.setSaved({ gameId, isNewBest, newRank });
        if (isNewBest) summary.setPersonalBest(job.points.total);
      }
    } catch (err) {
      console.error('[finishGame] save failed', err);
      // QA-03 — a refusal by the rules is not a connection problem, and
      // telling the player to check their connection sent them the wrong way.
      const denied = (err as { code?: unknown } | null)?.code === 'permission-denied';
      if (stillShown()) {
        summary.setError(
          denied
            ? 'This game wasn’t counted: the server refused to save it.'
            : 'Could not save this game. Check your connection.',
        );
      }
    } finally {
      if (stillShown()) summary.setSaving(false);
    }
  }

  let chain: Promise<void> = Promise.resolve();
  return {
    /** Saves `job` after every save queued before it has finished. */
    queue(job: FinishedGameSave, uid: string, name: string): Promise<void> {
      const next = chain.then(() => saveFinishedGame(job, uid, name));
      chain = next;
      return next;
    },
  };
}
