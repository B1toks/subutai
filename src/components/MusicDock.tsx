import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Disc3, GripVertical, ListMusic, Mic, MicOff, Play, Plus, SkipForward, Square, Trash2, X,
} from 'lucide-react';
import { Icon } from './Icon';
import { beatEngine } from '../music/beatEngine';
import { lookupBpm, analyzeTrack } from '../music/autoBpm';
import { liveBpm } from '../music/liveBpm';
import { beatMode } from '../music/beatMode';
import {
  loadPlaylists, savePlaylist, deletePlaylist, setTrackBpm, newPlaylistId,
  type SavedPlaylist, type PlaylistTrack,
} from '../music/playlists';
import { micEq, type MicStartResult } from '../audio/micEqualizer';

/* SP-2 — the Spotify dock, IFrame-API edition.
 *
 * Spotify killed /audio-analysis for new apps (Nov 2024) and DRM walls
 * off the raw audio, so this build needs NO OAuth and NO client id:
 *   • music — the official Embed IFrame API. Full tracks when the
 *     browser is logged into Spotify, previews otherwise. The API
 *     streams playback_update {position, isPaused} which we feed to
 *     the beat engine, so the beat grid lives in TRACK time: pause
 *     freezes it, resume/seek keep the phase — tap once per song.
 *   • beats — tap-tempo locks BPM + phase; BPM remembered per link.
 *   • spectrum — the mic equalizer hears whatever plays and drives
 *     the perimeter ring around the board.
 *
 * The dock is draggable by its header (same pattern as TwitchPanel)
 * and portals to <body> — transformed ancestors hijack position:fixed.
 */

const URL_KEY = 'subutai_spotify_url';
const BPM_MAP_KEY = 'subutai_spotify_bpm';
const POS_KEY = 'subutai_music_pos';

/* SP-4 — tempo presets: the "prepared playlists" half of the idea, in
 * its safe form. One tap arms a beat grid at a known tempo — no track,
 * no lookup, works with the mic equalizer, external speakers, or as a
 * bare metronome. Covers the common chess-stream vibes. */
const TEMPO_PRESETS: { label: string; bpm: number }[] = [
  { label: 'Chill', bpm: 70 },
  { label: 'Lo-fi', bpm: 85 },
  { label: 'Groove', bpm: 100 },
  { label: 'House', bpm: 124 },
  { label: 'DnB', bpm: 174 },
];
const URL_RE = /open\.spotify\.com\/(?:embed\/)?(track|playlist|album)\/([a-zA-Z0-9]+)/;

interface SpotifyController {
  addListener: (event: string, cb: (e: { data: { position: number; duration: number; isPaused: boolean } }) => void) => void;
  loadUri: (uri: string) => void;
  destroy: () => void;
}

interface SpotifyIFrameAPI {
  createController: (
    el: HTMLElement,
    options: { uri: string; width?: string | number; height?: string | number },
    cb: (controller: SpotifyController) => void,
  ) => void;
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIFrameAPI) => void;
    __spotifyIframeApi?: SpotifyIFrameAPI;
  }
}

const API_SRC = 'https://open.spotify.com/embed/iframe-api/v1';

/** Load the IFrame API script once; resolves with the API object. */
function loadIframeApi(): Promise<SpotifyIFrameAPI> {
  if (window.__spotifyIframeApi) return Promise.resolve(window.__spotifyIframeApi);
  return new Promise((resolve) => {
    window.onSpotifyIframeApiReady = (api) => {
      window.__spotifyIframeApi = api;
      resolve(api);
    };
    if (!document.querySelector(`script[src="${API_SRC}"]`)) {
      const s = document.createElement('script');
      s.src = API_SRC;
      s.async = true;
      document.body.appendChild(s);
    }
  });
}

function parseSpotifyUrl(url: string): { uri: string; height: number } | null {
  const m = url.match(URL_RE);
  if (!m) return null;
  const [, type, id] = m;
  return { uri: `spotify:${type}:${id}`, height: type === 'track' ? 80 : 152 };
}

function readBpmMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BPM_MAP_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

interface MusicDockProps {
  onClose: () => void;
}

export function MusicDock({ onClose }: MusicDockProps) {
  const [urlInput, setUrlInput] = useState(() => {
    try {
      return localStorage.getItem(URL_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [loadedUrl, setLoadedUrl] = useState('');
  const [playerState, setPlayerState] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [micOn, setMicOn] = useState(() => micEq.isRunning());
  const [micError, setMicError] = useState<string | null>(null);
  // SP-7 — live tempo detected from the mic (any audio in the room).
  const [live, setLive] = useState<{ bpm: number; conf: number } | null>(null);
  // Engine mirrors for the UI (the engine itself lives outside React).
  const [bpm, setBpm] = useState(() => beatEngine.getBpm());
  const [syncRunning, setSyncRunning] = useState(() => beatEngine.isRunning());
  // SP-3 — automatic BPM lookup (oEmbed → Deezer).
  const [autoBpm, setAutoBpm] = useState<'idle' | 'looking' | 'found' | 'none'>('idle');
  // SP-3 — Beat Mode: moves snap to the beat (classic solo only).
  const [beatModeOn, setBeatModeOn] = useState(() => beatMode.isEnabled());
  // SP-5 — pre-analyzed playlists. Auto-expanded when any are saved so
  // they're actually discoverable (SP-6 fix).
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>(() => loadPlaylists());
  const [showPlaylists, setShowPlaylists] = useState(() => loadPlaylists().length > 0);
  /** Which playlist card is expanded to show its track list. */
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  /** Builder visible? Hidden behind "+ New" so saved lists lead. */
  const [showBuilder, setShowBuilder] = useState(() => loadPlaylists().length === 0);
  const [builderText, setBuilderText] = useState('');
  const [builderName, setBuilderName] = useState('');
  const [analyzing, setAnalyzing] = useState<{ done: number; total: number } | null>(null);
  // Active playlist playback: id + current track index.
  const [nowPlaying, setNowPlaying] = useState<{ id: string; idx: number } | null>(null);

  const embedHostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SpotifyController | null>(null);
  // SP-3 — mirrors loadedUrl for the async BPM lookup's stale-result
  // guard (the closure captured at call time would go stale otherwise).
  const loadedUrlRef = useRef('');

  // ── embed controller lifecycle ──
  // Thin wrapper for the URL input box: load + auto-detect BPM.
  async function loadUrl() {
    await loadTrack(urlInput);
  }

  /**
   * Load a track into the embed and arm the beat grid.
   *  - knownBpm provided (playlist playback): adopt it, skip the lookup.
   *  - otherwise: use the saved-per-URL BPM, else the keyless oEmbed →
   *    Deezer auto-detect (a tap later just fixes the phase).
   */
  async function loadTrack(url: string, knownBpm?: number | null) {
    const parsed = parseSpotifyUrl(url);
    if (!parsed || !embedHostRef.current) return;
    try {
      localStorage.setItem(URL_KEY, url);
    } catch { /* private mode */ }
    setUrlInput(url);
    setPlayerState('loading');
    setLoadedUrl(url);
    loadedUrlRef.current = url;
    beatEngine.setBase('track');
    const saved = knownBpm ?? readBpmMap()[url];
    if (saved) {
      beatEngine.adoptBpm(saved);
      setAutoBpm('found');
    } else {
      // SP-3 — no saved BPM: try the keyless oEmbed → Deezer lookup so
      // the player doesn't HAVE to tap. A single tap later just fixes
      // the phase. Falls back silently to tap-tempo on any miss.
      setAutoBpm('looking');
      const target = url;
      void lookupBpm(target).then((result) => {
        // Ignore if the user loaded a different link meanwhile.
        if (loadedUrlRef.current !== target) return;
        if (result) {
          beatEngine.adoptBpm(result.bpm);
          setBpm(result.bpm);
          const map = readBpmMap();
          map[target] = result.bpm;
          try {
            localStorage.setItem(BPM_MAP_KEY, JSON.stringify(map));
          } catch { /* private mode */ }
          setAutoBpm('found');
        } else {
          setAutoBpm('none');
        }
      });
    }
    setBpm(beatEngine.getBpm());

    if (controllerRef.current) {
      controllerRef.current.loadUri(parsed.uri);
      setPlayerState('ready');
      return;
    }
    const api = await loadIframeApi();
    // The API replaces the host node — keep a dedicated child for it.
    const slot = document.createElement('div');
    embedHostRef.current.innerHTML = '';
    embedHostRef.current.appendChild(slot);
    api.createController(
      slot,
      { uri: parsed.uri, width: '100%', height: parsed.height },
      (controller) => {
        controllerRef.current = controller;
        controller.addListener('playback_update', (e) => {
          beatEngine.feedPlayback(e.data.position, e.data.isPaused);
        });
        setPlayerState('ready');
      },
    );
  }

  // Restore the persisted link on first open.
  useEffect(() => {
    if (urlInput && parseSpotifyUrl(urlInput)) void loadUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The controller survives dock close (music keeps playing) — App
  // keeps the dock mounted; only unmount tears the player down.
  useEffect(() => {
    return () => {
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, []);

  // On-beat board pulse — imperative class toggle on the board wrapper.
  useEffect(() => {
    return beatEngine.onBeat(() => {
      const board = document.querySelector('.board-with-coords');
      if (!board) return;
      board.classList.remove('beat-tick');
      void (board as HTMLElement).offsetWidth; // restart the animation
      board.classList.add('beat-tick');
    });
  }, []);

  // SP-7 — surface the live mic tempo estimate.
  useEffect(() => {
    return liveBpm.onBpm((value, conf) => setLive({ bpm: value, conf }));
  }, []);

  // Adopt the live-detected tempo into the grid (wall base — the audio
  // is in the room, not the embed) and start sync.
  function useLiveBpm() {
    if (!live) return;
    beatEngine.setBase('wall');
    beatEngine.adoptBpm(live.bpm);
    setBpm(live.bpm);
    setAutoBpm('found');
    beatEngine.start();
    setSyncRunning(true);
  }

  // ── beat controls ──
  function handleTap() {
    beatEngine.tap();
    setBpm(beatEngine.getBpm());
  }

  function handleSync() {
    if (!beatEngine.start()) return;
    setSyncRunning(true);
    if (beatEngine.getBpm() > 0 && loadedUrl) {
      const map = readBpmMap();
      map[loadedUrl] = beatEngine.getBpm();
      try {
        localStorage.setItem(BPM_MAP_KEY, JSON.stringify(map));
      } catch { /* private mode */ }
    }
  }

  function handleStopSync() {
    beatEngine.stop();
    setSyncRunning(false);
  }

  // SP-4 — one-tap tempo preset: arm the grid at a fixed BPM and start.
  // Track base when a Spotify embed is loaded (so pause still freezes
  // it), wall base otherwise (mic / speakers / metronome).
  function handlePreset(presetBpm: number) {
    beatEngine.setBase(loadedUrl ? 'track' : 'wall');
    beatEngine.adoptBpm(presetBpm);
    setBpm(presetBpm);
    setAutoBpm('idle');
    beatEngine.start();
    setSyncRunning(true);
  }

  // ── SP-5: playlists ──
  // Pre-analyze every pasted URL (title + BPM), drop dead links, save.
  async function analyzeAndSave() {
    const urls = builderText
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter((u) => parseSpotifyUrl(u));
    if (urls.length === 0) return;
    setAnalyzing({ done: 0, total: urls.length });
    const tracks: PlaylistTrack[] = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const parsed = parseSpotifyUrl(url)!;
      const info = await analyzeTrack(url);
      if (info) {
        tracks.push({ url, uri: parsed.uri, title: info.title, bpm: info.bpm });
      }
      setAnalyzing({ done: i + 1, total: urls.length });
    }
    setAnalyzing(null);
    if (tracks.length === 0) return;
    const name = builderName.trim() || `Playlist ${playlists.length + 1}`;
    const pl: SavedPlaylist = { id: newPlaylistId(), name, tracks, createdAt: Date.now() };
    setPlaylists(savePlaylist(pl));
    setBuilderText('');
    setBuilderName('');
    setShowBuilder(false);
    setOpenPlaylistId(pl.id); // reveal the freshly-saved tracks
  }

  function removePlaylist(id: string) {
    setPlaylists(deletePlaylist(id));
    if (nowPlaying?.id === id) setNowPlaying(null);
    if (openPlaylistId === id) setOpenPlaylistId(null);
  }

  // SP-6 — manual BPM override for a track the auto-detect missed (or
  // got wrong). Updates storage + the live grid if that track is playing.
  function editTrackBpm(playlistId: string, idx: number, value: string) {
    const n = parseFloat(value);
    const bpm = Number.isFinite(n) && n >= 40 && n <= 220 ? Math.round(n * 10) / 10 : null;
    setPlaylists(setTrackBpm(playlistId, idx, bpm));
    if (nowPlaying?.id === playlistId && nowPlaying.idx === idx && bpm) {
      beatEngine.adoptBpm(bpm);
      setBpm(bpm);
      if (!beatEngine.isRunning()) {
        beatEngine.start();
        setSyncRunning(true);
      }
    }
  }

  // Play a playlist from a track index — loads the embed with the
  // pre-analyzed BPM (instant grid, no lookup) and starts sync.
  async function playPlaylistTrack(pl: SavedPlaylist, idx: number) {
    const track = pl.tracks[idx];
    if (!track) return;
    setNowPlaying({ id: pl.id, idx });
    await loadTrack(track.url, track.bpm);
    if (track.bpm) {
      beatEngine.start();
      setSyncRunning(true);
    }
  }

  function nextTrack() {
    if (!nowPlaying) return;
    const pl = playlists.find((p) => p.id === nowPlaying.id);
    if (!pl) return;
    const next = (nowPlaying.idx + 1) % pl.tracks.length;
    void playPlaylistTrack(pl, next);
  }

  async function toggleMic() {
    setMicError(null);
    if (micEq.isRunning()) {
      micEq.stop();
      liveBpm.stop();
      setLive(null);
      setMicOn(false);
      return;
    }
    const result: MicStartResult = await micEq.start();
    if (result.ok) {
      setMicOn(true);
      liveBpm.start(); // SP-7 — start listening for the tempo
    } else {
      setMicOn(false);
      setMicError(
        result.reason === 'denied'
          ? 'Microphone access denied — allow it in the browser to visualize.'
          : result.reason === 'no-device'
            ? 'No microphone found.'
            : result.reason === 'insecure'
              ? 'Microphone needs HTTPS (or localhost).'
              : 'Could not start the microphone.',
      );
    }
  }

  // ── drag (desktop) — header is the handle, same recipe as Twitch ──
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      return raw ? (JSON.parse(raw) as { x: number; y: number }) : null;
    } catch {
      return null;
    }
  });
  const panelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    if (window.innerWidth <= 720) return;
    const panel = panelRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch { /* synthetic/stale pointer */ }
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const w = panel.offsetWidth;
      const x = Math.max(0, Math.min(ev.clientX - d.dx, window.innerWidth - w));
      const y = Math.max(0, Math.min(ev.clientY - d.dy, window.innerHeight - 48));
      lastPosRef.current = { x, y };
      setPos({ x, y });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (lastPosRef.current) {
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(lastPosRef.current));
        } catch { /* private mode */ }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  function resetPos() {
    setPos(null);
    try {
      localStorage.removeItem(POS_KEY);
    } catch { /* private mode */ }
  }

  const savedBpm = loadedUrl ? readBpmMap()[loadedUrl] : undefined;
  const tapsHint =
    autoBpm === 'looking'
      ? 'detecting BPM…'
      : bpm > 0
        ? `${bpm} BPM${autoBpm === 'found' ? ' · auto · tap once to align' : ''}`
        : savedBpm
          ? `saved ${savedBpm} BPM — tap to set the phase`
          : autoBpm === 'none'
            ? "couldn't detect — tap 4+ times"
            : 'tap 4+ times to the beat';

  const panelStyle: React.CSSProperties | undefined =
    pos && window.innerWidth > 720
      ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
      : undefined;

  return createPortal(
    <aside className="music-dock" ref={panelRef} style={panelStyle} aria-label="Music dock">
      <div
        className="music-dock-header twitch-drag-handle"
        onPointerDown={onDragStart}
        onDoubleClick={resetPos}
        title="Drag to move · double-click to reset position"
      >
        <span className="music-dock-title">
          <Icon icon={GripVertical} size="sm" aria-hidden />
          <Icon icon={Disc3} size="md" aria-hidden /> Music
        </span>
        <button type="button" className="twitch-close-btn" onClick={onClose} aria-label="Close music dock">
          <Icon icon={X} size="sm" aria-hidden />
        </button>
      </div>

      <div className="music-dock-row">
        <input
          type="text"
          className="music-dock-input"
          placeholder="Spotify track / playlist URL"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void loadUrl();
          }}
        />
        <button
          type="button"
          className="music-dock-load-btn"
          onClick={() => void loadUrl()}
          disabled={!parseSpotifyUrl(urlInput)}
        >
          Load
        </button>
      </div>

      <div
        ref={embedHostRef}
        className="music-dock-embed-host"
        style={{ display: playerState === 'idle' ? 'none' : undefined }}
      />
      {playerState === 'loading' && (
        <div className="twitch-status">Loading player…</div>
      )}

      {/* SP-4 — instant tempo presets ("prepared playlists", safe form). */}
      <div className="music-dock-presets" role="group" aria-label="Tempo presets">
        {TEMPO_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`music-dock-preset${syncRunning && bpm === p.bpm ? ' is-active' : ''}`}
            onClick={() => handlePreset(p.bpm)}
            title={`${p.bpm} BPM`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="music-dock-beat">
        <button type="button" className="music-dock-tap-btn" onClick={handleTap}>
          TAP
        </button>
        <span className="music-dock-bpm">{tapsHint}</span>
        {syncRunning ? (
          <button type="button" className="music-dock-beat-btn" onClick={handleStopSync} aria-label="Stop beat sync">
            <Icon icon={Square} size="sm" aria-hidden /> Stop
          </button>
        ) : (
          <button
            type="button"
            className="music-dock-beat-btn"
            onClick={handleSync}
            disabled={bpm <= 0}
            aria-label="Start beat sync"
          >
            <Icon icon={Play} size="sm" aria-hidden /> Sync
          </button>
        )}
      </div>
      {syncRunning && (
        <div className="music-dock-hint music-dock-hint-row">
          Moves land on the beat → PERFECT streaks. ×10 = Rhythm Master 🏆
        </div>
      )}

      {/* SP-3 — Beat Mode: hold each move until the next beat so the
          piece moves in time. Classic solo only; never alters the move
          itself. */}
      <div className="music-dock-beat">
        <button
          type="button"
          className={`music-dock-beat-btn${beatModeOn ? ' is-active' : ''}`}
          onClick={() => {
            const next = !beatModeOn;
            beatMode.set(next);
            setBeatModeOn(next);
          }}
          aria-pressed={beatModeOn}
        >
          <Icon icon={Disc3} size="sm" aria-hidden />
          {beatModeOn ? 'Beat Mode on' : 'Beat Mode'}
        </button>
        <span className="music-dock-hint">
          {beatModeOn ? 'moves snap to the beat' : 'moves play in rhythm (classic)'}
        </span>
      </div>

      <div className="music-dock-beat">
        <button
          type="button"
          className={`music-dock-beat-btn${micOn ? ' is-active' : ''}`}
          onClick={() => void toggleMic()}
          aria-pressed={micOn}
        >
          <Icon icon={micOn ? Mic : MicOff} size="sm" aria-hidden />
          {micOn ? 'Equalizer on' : 'Equalizer (mic)'}
        </button>
        <span className="music-dock-hint">
          {micOn ? 'listening — bars ring the board' : 'visualizes whatever is playing'}
        </span>
      </div>
      {micError && <div className="twitch-status twitch-status-error">{micError}</div>}

      {/* SP-7 — live tempo detected from whatever's playing in the room. */}
      {micOn && (
        <div className="music-dock-beat music-dock-live">
          {live ? (
            <>
              <span className="music-dock-live-bpm">
                ♫ {live.bpm} BPM
                <span className={`music-dock-live-conf conf-${live.conf > 0.5 ? 'high' : live.conf > 0.3 ? 'mid' : 'low'}`}>
                  {live.conf > 0.5 ? 'strong' : live.conf > 0.3 ? 'fair' : 'weak'}
                </span>
              </span>
              <button type="button" className="music-dock-beat-btn is-active" onClick={useLiveBpm}>
                Use
              </button>
            </>
          ) : (
            <span className="music-dock-hint">detecting tempo from the room… play some music</span>
          )}
        </div>
      )}

      {/* SP-5 — pre-analyzed playlists. Assemble track URLs, analyze BPM
          ahead of time, then play track-by-track with the grid pre-armed. */}
      <div className="music-dock-playlists">
        <button
          type="button"
          className="music-dock-pl-toggle"
          onClick={() => setShowPlaylists((v) => !v)}
          aria-expanded={showPlaylists}
        >
          <Icon icon={ListMusic} size="sm" aria-hidden />
          Playlists{playlists.length > 0 ? ` (${playlists.length})` : ''}
          <span className="music-dock-pl-caret">{showPlaylists ? '▾' : '▸'}</span>
        </button>

        {showPlaylists && (
          <div className="music-dock-pl-body">
            {playlists.length === 0 && !showBuilder && (
              <div className="music-dock-hint music-dock-pl-empty">
                No playlists yet — add tracks and analyze their BPM.
              </div>
            )}

            {/* saved playlists */}
            {playlists.map((pl) => {
              const playing = nowPlaying?.id === pl.id;
              const withBpm = pl.tracks.filter((t) => t.bpm !== null).length;
              const expanded = openPlaylistId === pl.id;
              return (
                <div key={pl.id} className={`music-dock-pl-card${playing ? ' is-playing' : ''}`}>
                  <div className="music-dock-pl-head">
                    <button
                      type="button"
                      className="music-dock-pl-play"
                      onClick={() => void playPlaylistTrack(pl, playing ? nowPlaying!.idx : 0)}
                      title="Play playlist"
                    >
                      <Icon icon={Play} size="sm" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="music-dock-pl-name music-dock-pl-name-btn"
                      onClick={() => setOpenPlaylistId(expanded ? null : pl.id)}
                      aria-expanded={expanded}
                      title="Show tracks"
                    >
                      {pl.name}
                    </button>
                    <span className="music-dock-pl-meta">
                      {pl.tracks.length}♫ · {withBpm} BPM {expanded ? '▾' : '▸'}
                    </span>
                    <button
                      type="button"
                      className="music-dock-pl-del"
                      onClick={() => removePlaylist(pl.id)}
                      aria-label={`Delete ${pl.name}`}
                    >
                      <Icon icon={Trash2} size="sm" aria-hidden />
                    </button>
                  </div>

                  {/* track list — the saved & analyzed tracks live here */}
                  {expanded && (
                    <ol className="music-dock-pl-tracks">
                      {pl.tracks.map((t, i) => {
                        const isCur = playing && nowPlaying!.idx === i;
                        return (
                          <li key={t.url} className={`music-dock-pl-trackrow${isCur ? ' is-current' : ''}`}>
                            <button
                              type="button"
                              className="music-dock-pl-trackplay"
                              onClick={() => void playPlaylistTrack(pl, i)}
                              title="Play this track"
                            >
                              {isCur ? '▶' : i + 1}
                            </button>
                            <span className="music-dock-pl-tracktitle" title={t.title}>{t.title}</span>
                            <span className="music-dock-pl-trackbpm">
                              <input
                                type="number"
                                className="music-dock-bpm-input"
                                value={t.bpm ?? ''}
                                placeholder="BPM"
                                min={40}
                                max={220}
                                step={0.1}
                                onChange={(e) => editTrackBpm(pl.id, i, e.target.value)}
                                title="BPM (editable — fix it if auto-detect missed)"
                              />
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}

                  {playing && (
                    <div className="music-dock-pl-nowplaying">
                      <span className="music-dock-pl-track">
                        ▶ {pl.tracks[nowPlaying!.idx]?.title ?? '—'}
                        {pl.tracks[nowPlaying!.idx]?.bpm
                          ? ` · ${pl.tracks[nowPlaying!.idx]!.bpm} BPM`
                          : ' · set BPM above'}
                      </span>
                      <button type="button" className="music-dock-pl-next" onClick={nextTrack} title="Next track">
                        <Icon icon={SkipForward} size="sm" aria-hidden />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* builder — behind a "+ New" button so saved lists lead */}
            {analyzing ? (
              <div className="music-dock-pl-analyzing">
                Analyzing BPM… {analyzing.done}/{analyzing.total}
              </div>
            ) : showBuilder ? (
              <div className="music-dock-pl-builder">
                <input
                  type="text"
                  className="music-dock-input"
                  placeholder="Playlist name"
                  value={builderName}
                  onChange={(e) => setBuilderName(e.target.value)}
                />
                <textarea
                  className="music-dock-pl-textarea"
                  placeholder="Paste Spotify track URLs, one per line"
                  value={builderText}
                  onChange={(e) => setBuilderText(e.target.value)}
                  rows={3}
                />
                <div className="music-dock-pl-builder-actions">
                  {playlists.length > 0 && (
                    <button
                      type="button"
                      className="music-dock-beat-btn"
                      onClick={() => { setShowBuilder(false); setBuilderText(''); setBuilderName(''); }}
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    className="music-dock-load-btn music-dock-pl-analyze-btn"
                    onClick={() => void analyzeAndSave()}
                    disabled={builderText.trim().length === 0}
                  >
                    <Icon icon={Plus} size="sm" aria-hidden /> Analyze &amp; save
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="music-dock-beat-btn music-dock-pl-newbtn"
                onClick={() => setShowBuilder(true)}
              >
                <Icon icon={Plus} size="sm" aria-hidden /> New playlist
              </button>
            )}
          </div>
        )}
      </div>
    </aside>,
    document.body,
  );
}
