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

const SPOTIFY_URI_RE = /^spotify:(track|playlist|album):[a-zA-Z0-9]+$/;

/** Defensive shape check: localStorage is user-editable and a malformed
 *  entry used to crash the dock at render time. Anything that doesn't look
 *  like a playlist we wrote is dropped. */
function sanitize(raw: unknown): SavedPlaylist[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedPlaylist[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const pl = p as Partial<SavedPlaylist>;
    if (typeof pl.id !== 'string' || typeof pl.name !== 'string' || !Array.isArray(pl.tracks)) continue;
    const tracks: PlaylistTrack[] = [];
    for (const t of pl.tracks) {
      if (!t || typeof t !== 'object') continue;
      const tr = t as Partial<PlaylistTrack>;
      if (typeof tr.url !== 'string' || typeof tr.uri !== 'string' || !SPOTIFY_URI_RE.test(tr.uri)) continue;
      const bpm = typeof tr.bpm === 'number' && Number.isFinite(tr.bpm) && tr.bpm >= 40 && tr.bpm <= 220 ? tr.bpm : null;
      tracks.push({
        url: tr.url.slice(0, 500),
        uri: tr.uri,
        title: typeof tr.title === 'string' ? tr.title.slice(0, 200) : tr.uri,
        bpm,
      });
    }
    out.push({
      id: pl.id.slice(0, 64),
      name: pl.name.slice(0, 80),
      tracks,
      createdAt: typeof pl.createdAt === 'number' ? pl.createdAt : 0,
    });
  }
  return out;
}

export function loadPlaylists(): SavedPlaylist[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return sanitize(JSON.parse(raw));
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
