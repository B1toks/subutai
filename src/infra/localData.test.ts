import { afterEach, describe, expect, it } from 'vitest';
import { LOCAL_KEYS, localData, musicTutorialKey, setLocalDataBackend } from './localData';
import { memoryStorage } from './fakes/memoryStorage';

describe('localData', () => {
  afterEach(() => setLocalDataBackend(null));

  it('keeps every key exactly as players\' browsers hold it', () => {
    expect(LOCAL_KEYS).toEqual({
      games: 'subutai-games',
      liveSession: 'subutai_live_session',
      botLevel: 'subutai_bot_level',
      helpTools: 'subutai_help_tools',
      rotateHintSeen: 'subutai_rotate_hint_seen',
      mpActive: 'subutai_mp_active',
      uiScale: 'subutai_ui_scale',
      welcomeSeen: 'subutai_welcome_seen',
      tutorialDone: 'subutai_tutorial_done',
      theme: 'subutai_theme',
      effects3d: 'subutai_3d',
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
      twitchChannel: 'subutai_twitch_channel',
      twitchDocked: 'subutai_twitch_docked',
      twitchPos: 'subutai_twitch_pos',
    });
    expect(musicTutorialKey('dock')).toBe('subutai_music_tut_dock');
  });

  it('reads, writes and removes through the store underneath', () => {
    const store = memoryStorage({ [LOCAL_KEYS.theme]: 'wood' });
    setLocalDataBackend(store);
    expect(localData.get(LOCAL_KEYS.theme)).toBe('wood');
    localData.set(LOCAL_KEYS.uiScale, '1.1');
    localData.remove(LOCAL_KEYS.theme);
    expect(store.dump()).toEqual({ subutai_ui_scale: '1.1' });
    expect(localData.get('nothing')).toBeNull();
  });

  it('a store that refuses throws to the caller, as localStorage did', () => {
    setLocalDataBackend({
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(() => localData.get(LOCAL_KEYS.theme)).toThrow('SecurityError');
  });
});
