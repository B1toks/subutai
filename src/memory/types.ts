import type { Move, TopologyState } from '../engine';

export interface SavedGame {
  readonly id: string;
  readonly createdAt: string;
  readonly config960: string;
  readonly status: 'incomplete' | 'complete';
  readonly result?: 'win' | 'loss' | 'draw';
  readonly termination?: 'checkmate' | 'stalemate' | 'resignation';
  readonly moveCount: number;
  readonly moves: readonly { move: Move; topology?: TopologyState }[];
  readonly movesInA: number;
  readonly movesInB: number;
  readonly scoreHistory: number[];
  readonly notation: string;
  /**
   * If this game was created as a replay / copy of another game,
   * this points back to the original game's id.
   */
  readonly sourceGameId?: string;
}

export interface GameStorage {
  loadGames(): Promise<SavedGame[]>;
  saveGame(game: SavedGame): Promise<void>;
  saveOrUpdateGame?(game: SavedGame): Promise<void>;
  deleteGame?(id: string): Promise<void>;
}
