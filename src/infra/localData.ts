/**
 * What the app keeps in the browser's localStorage, in one place: every key
 * (LOCAL_KEYS) and the three calls that touch it (localData).
 *
 * The key strings never change: players' saved games and settings, and the
 * QA scripts, read them as they are (`subutai-games` keeps its hyphen).
 * src/firebase/useAuth.ts keeps its own key (subutai_user_cache_v1): the
 * Firestore client code stays as it is on main. The chunk-reload stamp
 * lives in sessionStorage (utils/chunkReload.ts), not here.
 *
 * localData only forwards to localStorage, read at each call: a
 * browser that refuses storage (private mode, blocked site data) throws
 * from here exactly where it threw before, and each caller keeps the
 * try/catch it had. Unit tests put an in-memory store underneath
 * (setLocalDataBackend, src/infra/fakes).
 */
export const LOCAL_KEYS = {
  // Memory (src/memory)
  games: 'subutai-games',
  liveSession: 'subutai_live_session',
  // The game
  botLevel: 'subutai_bot_level',
  helpTools: 'subutai_help_tools',
  rotateHintSeen: 'subutai_rotate_hint_seen',
  mpActive: 'subutai_mp_active',
  // The shell
  uiScale: 'subutai_ui_scale',
  welcomeSeen: 'subutai_welcome_seen',
  tutorialDone: 'subutai_tutorial_done',
  theme: 'subutai_theme',
  effects3d: 'subutai_3d',
  // Sound and music
  audioEnabled: 'subutai_audio_enabled',
  audioVolume: 'subutai_audio_volume',
  musicEnabled: 'subutai_music_enabled',
  musicVolume: 'subutai_music_volume',
  musicStyle: 'subutai_music_style',
  musicDocked: 'subutai_music_docked',
  musicPos: 'subutai_music_pos',
  spotifyUrl: 'subutai_spotify_url',
  spotifyBpm: 'subutai_spotify_bpm',
  playlists: 'subutai_playlists',
  beatMode: 'subutai_beat_mode',
  beatOffset: 'subutai_beat_offset',
  eqSensitivity: 'subutai_eq_sensitivity',
  achievements: 'subutai_achievements',
  bgGrid: 'subutai_bg_grid',
  pulseMode: 'subutai_pulse_mode',
  // Twitch
  twitchChannel: 'subutai_twitch_channel',
  twitchDocked: 'subutai_twitch_docked',
  twitchPos: 'subutai_twitch_pos',
} as const;

/** The music dock's one-time tutorial tip `tip` has been shown. */
export const musicTutorialKey = (tip: string) => `subutai_music_tut_${tip}`;

type Backend = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
let backend: Backend | null = null;
const store = (): Backend => backend ?? globalThis.localStorage;

export const localData = {
  get: (key: string): string | null => store().getItem(key),
  set: (key: string, value: string): void => store().setItem(key, value),
  remove: (key: string): void => store().removeItem(key),
};

/** Unit tests only: run localData against `b` (null: the browser's again). */
export function setLocalDataBackend(b: Backend | null): void {
  backend = b;
}
