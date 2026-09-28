import { isValidChess960Key } from '../engine';
import type { GameStorage, SavedGame } from './types';

const STORAGE_KEY = 'subutai-games';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isOptionalString(v: unknown): boolean {
  return v === undefined || typeof v === 'string';
}

function isSavedMove(v: unknown): boolean {
  if (!isRecord(v) || !isRecord(v.move)) return false;
  const m = v.move;
  return typeof m.kind === 'string' && isOptionalString(m.from) && isOptionalString(m.to);
}

/**
 * QA-07 — a record is kept only if every field Memory's cards and the
 * resume path read has the shape they expect. One malformed entry (the
 * SavedGame format drifting between versions, a write cut short) used to
 * reach GameCard, throw on `game.moves` and blank the whole app.
 */
function isSavedGame(v: unknown): v is SavedGame {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'string' || typeof v.createdAt !== 'string') return false;
  if (typeof v.notation !== 'string') return false;
  if (typeof v.config960 !== 'string' || !isValidChess960Key(v.config960)) return false;
  if (v.status !== undefined && v.status !== 'incomplete' && v.status !== 'complete') return false;
  if (!isFiniteNumber(v.moveCount) || !isFiniteNumber(v.movesInA) || !isFiniteNumber(v.movesInB)) {
    return false;
  }
  if (!Array.isArray(v.scoreHistory) || !v.scoreHistory.every(isFiniteNumber)) return false;
  return Array.isArray(v.moves) && v.moves.every(isSavedMove);
}

function loadRawGames(): SavedGame[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Broken records are dropped here, so the next save also clears them
    // out of storage.
    return parsed.filter(isSavedGame);
  } catch {
    return [];
  }
}

/** QA-07 — the error screen's "Reset local data": Memory's games only.
 *  Settings, the player's name and anything online are left alone. */
export function clearMemoryStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

function normalizeLoadedGames(games: SavedGame[]): SavedGame[] {
  return games.map((g) => {
    const status = g.status ?? 'complete';
    return {
      ...g,
      status,
    };
  });
}

export const localStorageAdapter: GameStorage = {
  async loadGames(): Promise<SavedGame[]> {
    return normalizeLoadedGames(loadRawGames());
  },

  async saveGame(game: SavedGame): Promise<void> {
    const games = loadRawGames();
    const updated = [...games, game];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },

  async saveOrUpdateGame(game: SavedGame): Promise<void> {
    const games = loadRawGames();
    const idx = games.findIndex((g) => g.id === game.id);
    if (idx === -1) {
      games.push(game);
    } else {
      games[idx] = game;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
  },

  async deleteGame(id: string): Promise<void> {
    const games = loadRawGames();
    const filtered = games.filter((g) => g.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  },
};
