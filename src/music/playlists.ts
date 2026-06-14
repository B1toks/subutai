/**
 * SP-5 — saved, pre-analyzed playlists.
 *
 * Spotify won't enumerate a playlist's tracks without OAuth, so a
 * Subutai playlist is a user-assembled list of individual track URLs.
 * The point is the *analysis*: each track's BPM is detected ahead of
 * time (autoBpm: oEmbed → Deezer) and stored, so at play time the beat
 * grid arms instantly — no per-track tapping mid-game.
 *
 * Stored in localStorage; small enough that the whole library lives in
 * one key.
 */

export interface PlaylistTrack {
  /** Original Spotify track URL the user pasted. */
  url: string;
  /** spotify:track:<id> for the embed controller. */
  uri: string;
  title: string;
  /** Pre-analyzed BPM, or null when detection missed (tap at play). */
  bpm: number | null;
}

export interface SavedPlaylist {
  id: string;
  name: string;
  tracks: PlaylistTrack[];
  /** ms epoch; set by callers (engine clocks are unavailable here). */
  createdAt: number;
}

const KEY = 'subutai_playlists';

export function loadPlaylists(): SavedPlaylist[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedPlaylist[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(playlists: SavedPlaylist[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(playlists));
  } catch {
    /* private mode / quota — playlists just won't persist */
  }
}

export function savePlaylist(playlist: SavedPlaylist): SavedPlaylist[] {
  const all = loadPlaylists();
  const idx = all.findIndex((p) => p.id === playlist.id);
  if (idx >= 0) all[idx] = playlist;
  else all.unshift(playlist);
  persist(all);
  return all;
}

export function deletePlaylist(id: string): SavedPlaylist[] {
  const all = loadPlaylists().filter((p) => p.id !== id);
  persist(all);
  return all;
}

/** SP-6 — set (or clear) a track's BPM, e.g. a manual override when
 *  auto-detect missed. Returns the updated library. */
export function setTrackBpm(playlistId: string, trackIdx: number, bpm: number | null): SavedPlaylist[] {
  const all = loadPlaylists();
  const pl = all.find((p) => p.id === playlistId);
  if (pl && pl.tracks[trackIdx]) {
    pl.tracks[trackIdx] = { ...pl.tracks[trackIdx], bpm };
    persist(all);
  }
  return all;
}

/** Unique-ish id without Date.now()/Math.random restrictions concerns —
 *  this runs in component event handlers (not the workflow sandbox), so
 *  Date.now() is fine here. */
export function newPlaylistId(): string {
  return `pl-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
