import type { getPersonalBest, saveCompletedGame, fetchSavedGame } from '../firebase/games';
import type { saveMultiplayerGameToGames } from '../firebase/multiplayerGames';
import type { saveTrainingGame } from '../firebase/trainingGames';
import type { logGameStart } from '../firebase/gameStarts';
import type { createMatch, joinMatch, rejoinMatch, subscribeMatch } from '../firebase/matches';
import type { findQuickMatch } from '../firebase/quickMatch';
import type { getOnlineCount, startPresenceHeartbeat, stopPresenceHeartbeat } from '../firebase/presence';
import type { changeDisplayName, claimDisplayName, isDisplayNameAvailable } from '../firebase/auth';
import type { fetchLeaderboardPage } from '../firebase/leaderboard';
import type { submitFeedback } from '../firebase/feedback';

/**
 * What the app reads from and writes to Firestore, as interfaces. Each
 * member is one existing function of src/firebase, with its signature: the
 * documents, their fields, the order of the writes, the transactions and
 * batches are that code's and do not change here. The implementations
 * (src/infra/firebase/*) hand each call to that function; unit tests use
 * in-memory ones (src/infra/fakes/*). The rules tests drive src/firebase
 * itself, as before.
 *
 * Grouped as the app loads them: a repository the first screen needs sits
 * in the main chunk, one only a lazy screen uses (the lobby, the
 * leaderboard) is imported only by that screen, so no Firestore code moves
 * into the first load.
 */

/** Finished games: solo saves, the player's best, shared games, online
 *  results, self-play training games, game-start pings. */
export interface GamesRepo {
  saveCompleted: typeof saveCompletedGame;
  personalBest: typeof getPersonalBest;
  fetchSaved: typeof fetchSavedGame;
  saveMultiplayer: typeof saveMultiplayerGameToGames;
  saveTraining: typeof saveTrainingGame;
  logStart: typeof logGameStart;
}

/** The live match on the board: back into it after a reload, its snapshots. */
export interface MatchesRepo {
  rejoin: typeof rejoinMatch;
  subscribe: typeof subscribeMatch;
}

/** The lobby (a lazy screen): making, joining and finding a match. */
export interface LobbyRepo {
  create: typeof createMatch;
  join: typeof joinMatch;
  subscribe: typeof subscribeMatch;
  findQuick: typeof findQuickMatch;
  onlineCount: typeof getOnlineCount;
}

/** Being seen online while a match runs. */
export interface PresenceRepo {
  start: typeof startPresenceHeartbeat;
  stop: typeof stopPresenceHeartbeat;
}

/** The player's display name. */
export interface ProfileRepo {
  claimName: typeof claimDisplayName;
  changeName: typeof changeDisplayName;
  isNameAvailable: typeof isDisplayNameAvailable;
}

/** The leaderboard (a lazy screen). */
export interface LeaderboardRepo {
  page: typeof fetchLeaderboardPage;
}

export interface FeedbackRepo {
  submit: typeof submitFeedback;
}
