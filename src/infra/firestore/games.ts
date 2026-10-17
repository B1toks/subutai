import { fetchSavedGame, getPersonalBest, saveCompletedGame } from '../../firebase/games';
import { saveMultiplayerGameToGames } from '../../firebase/multiplayerGames';
import { saveTrainingGame } from '../../firebase/trainingGames';
import { logGameStart } from '../../firebase/gameStarts';
import type { GamesRepo } from '../repos';

/** GamesRepo on Firestore: each call is the src/firebase function. */
export const gamesRepo: GamesRepo = {
  saveCompleted: saveCompletedGame,
  personalBest: getPersonalBest,
  fetchSaved: fetchSavedGame,
  saveMultiplayer: saveMultiplayerGameToGames,
  saveTraining: saveTrainingGame,
  logStart: logGameStart,
};
