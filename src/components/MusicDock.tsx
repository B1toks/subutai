import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronUp, Disc3, FileMusic, Flame, GripVertical, ListMusic, Mic, MicOff,
  Minus, MonitorSpeaker, PanelLeft, Play, Plus, SkipForward, Square, Trash2,
  Waves, X,
} from 'lucide-react';
import { Icon } from './Icon';
import { beatEngine } from '../music/beatEngine';
import { lookupBpm, analyzeTrack } from '../music/autoBpm';
import { analyzeAudioBuffer } from '../music/fileBpm';
import { liveBpm } from '../music/liveBpm';
import { beatMode } from '../music/beatMode';
import { eqSettings, EQ_SENS_MIN, EQ_SENS_MAX } from '../music/eqSettings';
import { vizMode } from '../music/vizMode';
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
  pause?: () => void;
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

function parseSpotifyUrl(
  url: string,
): { uri: string; height: number; type: 'track' | 'playlist' | 'album' } | null {
  const m = url.match(URL_RE);
  if (!m) return null;
  const [, type, id] = m;
  return {
    uri: `spotify:${type}:${id}`,
    height: type === 'track' ? 80 : 152,
    type: type as 'track' | 'playlist' | 'album',
  };
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
  // M.15 — equalizer "temperature": how hard the perimeter wave reacts.
  const [eqSens, setEqSens] = useState(() => eqSettings.getSensitivity());
  // M.15 — full-screen sound-grid background toggle.
  const [bgGrid, setBgGrid] = useState(() => vizMode.isBgGrid());
  const [captureSource, setCaptureSource] = useState<'mic' | 'display' | 'file' | null>(() => micEq.getSource());
  const [micError, setMicError] = useState<string | null>(null);
  // SP-7 — live tempo detected from the audio (mic room sound or the
  // captured tab/system audio).
  const [live, setLive] = useState<{ bpm: number; conf: number } | null>(null);
  // M.10 — collapse the dock to a compact bar (keeps audio + the beat
  // grid running, board keeps moving) instead of closing it outright.
  const [minimized, setMinimized] = useState(false);
  // M.13 — dock to the LEFT edge as a full-height column (Spotify left,
  // Twitch chat right). Persisted so the stream layout sticks.
  const [dockedLeft, setDockedLeft] = useState(() => {
    try { return localStorage.getItem('subutai_music_docked') === '1'; } catch { return false; }
  });
  // M.10 — manual tempo controls (TAP + presets) folded away by default.
  const [showManual, setShowManual] = useState(false);
  // SP-9 — local audio file mode (our audio = the idea works perfectly).
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileAnalyzing, setFileAnalyzing] = useState(false);
  const [filePlaying, setFilePlaying] = useState(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const fileUrlRef = useRef<string | null>(null);
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
    // M.11 — if live capture (tab/mic) is running, IT owns the beat grid
    // (wall base, always advancing). Loading a Spotify embed must NOT
    // reset that grid or fight its tempo — only swap the player. This is
    // the race that left the board frozen on a stale track BPM.
    const liveOwns = micEq.getSource() === 'mic' || micEq.getSource() === 'display';
    if (!liveOwns) beatEngine.setBase('track');
    const saved = knownBpm ?? readBpmMap()[url];
    if (liveOwns) {
      // Live grid stays in charge; just remember the BPM for later.
      if (saved) setBpm(saved);
      setAutoBpm(saved ? 'found' : 'idle');
    } else if (saved) {
      beatEngine.setGrid(saved, 0);
      setAutoBpm('found');
    } else if (parsed.type !== 'track') {
      // SP-8 — playlist/album: oEmbed returns the COLLECTION name, not a
      // track, so a per-track BPM lookup is meaningless. The honest path
      // is live detection (Tab audio) or TAP. Leave the grid uncalibrated.
      beatEngine.reset();
      setAutoBpm('none');
    } else {
      // SP-3 — no saved BPM: keyless oEmbed → Deezer lookup.
      setAutoBpm('looking');
      const target = url;
      void lookupBpm(target).then((result) => {
        if (loadedUrlRef.current !== target) return;
        // M.11 — a live capture may have taken over during the lookup;
        // don't clobber it. Cache the BPM but leave the engine alone.
        const liveNow = micEq.getSource() === 'mic' || micEq.getSource() === 'display';
        if (result) {
          const map = readBpmMap();
          map[target] = result.bpm;
          try {
            localStorage.setItem(BPM_MAP_KEY, JSON.stringify(map));
          } catch { /* private mode */ }
          setBpm(result.bpm);
          setAutoBpm('found');
          if (!liveNow) {
            beatEngine.setGrid(result.bpm, 0);
            // The grid starts when the embed actually plays (see the
            // playback_update listener) — that's when the board should
            // pulse. No frozen "synced but still" state.
          }
        } else {
          setAutoBpm('none');
        }
      });
    }
    // (track-base grids start on the embed's playback_update, below)
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
          // M.11 — live capture owns the grid; ignore embed playback then.
          const liveNow = micEq.getSource() === 'mic' || micEq.getSource() === 'display';
          if (liveNow) return;
          beatEngine.feedPlayback(e.data.position, e.data.isPaused);
          // Start the grid the moment the track actually plays, so the
          // board pulses in lock-step with real playback (and naturally
          // pauses when the track is paused — frozen track clock = no
          // beats). Fixes "synced but the board doesn't move".
          if (!e.data.isPaused && beatEngine.getBpm() > 0 && !beatEngine.isRunning()) {
            beatEngine.start();
            setSyncRunning(true);
          }
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
      // SP-9 — release the local file element + object URL.
      audioElRef.current?.pause();
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    };
  }, []);

  // M.10 — the on-beat board pulse now lives in App (survives dock
  // close/minimise), so it's gone from here.

  // SP-7 / M.10 — surface the live tempo AND auto-apply it to the grid
  // so the board locks to the rhythm with no extra click. We adopt when
  // the grid isn't running yet, or when the estimate drifts > 2 BPM,
  // provided the detector is at least "fair" confidence.
  useEffect(() => {
    return liveBpm.onBpm((value, conf) => {
      setLive({ bpm: value, conf });
      // M.15 — the board's on-beat pulse only fires while the grid runs.
      // The old single 0.3 gate meant a track the detector found hard
      // ("weak") never started the grid, so the pulse silently did
      // nothing. Now: get the grid MOVING on a weaker first lock (0.2),
      // but only RE-ADOPT a drifting tempo on a firmer reading (0.35) so
      // noise can't keep yanking the BPM around once we're locked.
      const FIRST_LOCK_CONF = 0.2;
      const REASSESS_CONF = 0.35;
      if (!beatEngine.isRunning()) {
        if (conf < FIRST_LOCK_CONF) return;
        beatEngine.setBase('wall');
        beatEngine.adoptBpm(value);
        setBpm(value);
        setAutoBpm('found');
        beatEngine.start();
        setSyncRunning(true);
      } else if (conf >= REASSESS_CONF && Math.abs(value - beatEngine.getBpm()) > 2) {
        beatEngine.setBase('wall');
        beatEngine.adoptBpm(value);
        setBpm(value);
        setAutoBpm('found');
      }
    });
  }, []);

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

  function stopCapture() {
    // SP-9 — if a local file was the source, pause it too (its graph is
    // about to be torn down with the AudioContext).
    if (micEq.getSource() === 'file') audioElRef.current?.pause();
    micEq.stop();
    liveBpm.stop();
    setLive(null);
    setMicOn(false);
    setCaptureSource(null);
  }

  // ── SP-9: local audio file ──
  // Our audio = full control. Decode → accurate offline BPM + phase →
  // sample-locked grid driven by the element's own clock. The same
  // element feeds the equalizer (real spectrum) and plays audibly.
  async function onPickFile(file: File) {
    // Pause any Spotify embed so two sources don't overlap.
    controllerRef.current?.pause?.();
    // Fresh element per file — sidesteps the once-per-element limit on
    // createMediaElementSource.
    audioElRef.current?.pause();
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);

    const el = new Audio();
    el.src = URL.createObjectURL(file);
    fileUrlRef.current = el.src;
    audioElRef.current = el;
    el.addEventListener('play', () => setFilePlaying(true));
    el.addEventListener('pause', () => setFilePlaying(false));
    const feed = () => beatEngine.feedPlayback(el.currentTime * 1000, el.paused);
    el.addEventListener('play', feed);
    el.addEventListener('pause', feed);
    el.addEventListener('seeked', feed);
    el.addEventListener('timeupdate', feed);

    setFileName(file.name);
    setLoadedUrl('');
    setAutoBpm('idle');

    // Route the element through the equalizer graph (audible + analysed).
    const wired = micEq.startFromElement(el);
    if (wired.ok) {
      setMicOn(true);
      setCaptureSource('file');
      void wired.ctx.resume();
    }

    // Offline analysis on a throwaway decode context.
    setFileAnalyzing(true);
    beatEngine.setBase('track');
    try {
      const bytes = await file.arrayBuffer();
      const decodeCtx = new AudioContext();
      const audioBuf = await decodeCtx.decodeAudioData(bytes);
      void decodeCtx.close();
      const result = await analyzeAudioBuffer(audioBuf);
      if (result) {
        beatEngine.setGrid(result.bpm, result.offsetMs);
        setBpm(result.bpm);
        setAutoBpm('found');
      } else {
        setAutoBpm('none');
      }
    } catch {
      setAutoBpm('none');
    }
    setFileAnalyzing(false);

    try {
      await el.play();
    } catch { /* autoplay blocked — user hits play */ }
    if (beatEngine.getBpm() > 0) {
      beatEngine.start();
      setSyncRunning(true);
    }
  }

  function toggleFilePlay() {
    const el = audioElRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  async function startCapture(source: 'mic' | 'display') {
    setMicError(null);
    if (micEq.isRunning()) {
      const wasSource = micEq.getSource();
      stopCapture();
      // Toggling the same source off; a different source starts fresh.
      if (wasSource === source) return;
    }
    const result: MicStartResult =
      source === 'display' ? await micEq.startDisplay() : await micEq.start();
    if (result.ok) {
      setMicOn(true);
      setCaptureSource(source);
      liveBpm.start(); // SP-7 — start listening for the tempo
    } else {
      setMicOn(false);
      const messages: Record<string, string> = {
        denied:
          source === 'display'
            ? 'Screen-share was cancelled — pick a tab/window and tick "Share audio".'
            : 'Microphone access denied — allow it in the browser.',
        'no-device': 'No microphone found.',
        'no-audio-track': 'No audio was shared — tick "Share tab audio" in the picker.',
        insecure: 'Audio capture needs HTTPS (or localhost).',
        unsupported: 'Tab-audio capture is not supported in this browser.',
        unknown: 'Could not start audio capture.',
      };
      setMicError(messages[result.reason] ?? messages.unknown);
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
      // M.14 — clamp the TOP so the whole panel stays on-screen (was a
      // flat innerHeight-48: a low drag left most of the panel below the
      // fold, and on expand-from-minimised it grew off the bottom).
      const maxY = Math.max(0, window.innerHeight - panel.offsetHeight);
      const x = Math.max(0, Math.min(ev.clientX - d.dx, window.innerWidth - w));
      const y = Math.max(0, Math.min(ev.clientY - d.dy, maxY));
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

  // M.14 — when the panel expands (e.g. restored from the minimised
  // bottom-left bar), its full height may run past the bottom of the
  // viewport from a low saved `pos`. Measure the real height after layout
  // and lift it back into view so the user never has to drag it up.
  useLayoutEffect(() => {
    if (minimized || (dockedLeft && window.innerWidth > 720) || !pos) return;
    const panel = panelRef.current;
    if (!panel) return;
    const maxY = Math.max(12, window.innerHeight - panel.offsetHeight - 12);
    if (pos.y > maxY) {
      setPos((p) => (p ? { ...p, y: maxY } : p));
    }
  }, [minimized, dockedLeft, pos]);

  const savedBpm = loadedUrl ? readBpmMap()[loadedUrl] : undefined;
  // SP-8 — a playlist/album can't be per-track-analyzed; steer to live/tap.
  const loadedIsCollection = loadedUrl ? parseSpotifyUrl(loadedUrl)?.type !== 'track' : false;
  const tapsHint =
    autoBpm === 'looking'
      ? 'detecting BPM…'
      : bpm > 0
        ? `${bpm} BPM${autoBpm === 'found' ? ' · auto · tap once to align' : ''}`
        : savedBpm
          ? `saved ${savedBpm} BPM — tap to set the phase`
          : loadedIsCollection
            ? 'playlist — use Tab audio for live tempo, or tap'
            : autoBpm === 'none'
              ? "couldn't detect — tap 4+ times"
              : 'tap 4+ times to the beat';

  // M.12/13 — docked-left takes a fixed side column (CSS class); minimised
  // pins bottom-left; otherwise free-floating at the dragged position.
  const panelStyle: React.CSSProperties | undefined =
    dockedLeft && !minimized
      ? undefined
      : minimized
        ? { left: 12, bottom: 12, top: 'auto', right: 'auto' }
        : pos && window.innerWidth > 720
          ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
          : undefined;

  function toggleDock() {
    setDockedLeft((v) => {
      const next = !v;
      try { localStorage.setItem('subutai_music_docked', next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  }

  // M.10 — compact status for the minimised bar.
  const statusLine = fileName
    ? `${fileName}${bpm > 0 ? ` · ${bpm} BPM` : ''}`
    : captureSource === 'display'
      ? `Tab audio${bpm > 0 ? ` · ${bpm} BPM` : ' · listening'}`
      : captureSource === 'mic'
        ? `Mic${bpm > 0 ? ` · ${bpm} BPM` : ' · listening'}`
        : bpm > 0
          ? `${bpm} BPM`
          : 'no source';

  return createPortal(
    <aside
      className={`music-dock${minimized ? ' is-minimized' : ''}${dockedLeft && !minimized ? ' is-docked-left' : ''}`}
      ref={panelRef}
      style={panelStyle}
      aria-label="Music dock"
    >
      <div
        className="music-dock-header twitch-drag-handle"
        onPointerDown={onDragStart}
        onDoubleClick={resetPos}
        title="Drag to move · double-click to reset position"
      >
        <span className="music-dock-title">
          <Icon icon={GripVertical} size="sm" aria-hidden />
          <Icon icon={Disc3} size="md" aria-hidden /> Music
          {syncRunning && <span className="music-dock-livedot" title="beat grid running" />}
        </span>
        <span className="music-dock-header-actions">
          {!minimized && (
            <button
              type="button"
              className={`twitch-close-btn${dockedLeft ? ' is-on' : ''}`}
              onClick={toggleDock}
              aria-label={dockedLeft ? 'Float music dock' : 'Dock to left edge'}
              title={dockedLeft ? 'Float (free position)' : 'Dock to the left side'}
            >
              <Icon icon={PanelLeft} size="sm" aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="twitch-close-btn"
            onClick={() => setMinimized((v) => !v)}
            aria-label={minimized ? 'Expand music dock' : 'Minimize music dock'}
            title={minimized ? 'Expand' : 'Minimize (keeps playing)'}
          >
            <Icon icon={minimized ? ChevronUp : Minus} size="sm" aria-hidden />
          </button>
          <button type="button" className="twitch-close-btn" onClick={onClose} aria-label="Close music dock">
            <Icon icon={X} size="sm" aria-hidden />
          </button>
        </span>
      </div>

      {minimized ? (
        <div className="music-dock-mini">
          <button
            type="button"
            className="music-dock-pl-trackplay"
            onClick={() => {
              if (audioElRef.current) toggleFilePlay();
              else if (syncRunning) handleStopSync();
              else handleSync();
            }}
            title={syncRunning ? 'Stop' : 'Start'}
          >
            {(audioElRef.current ? filePlaying : syncRunning) ? '❚❚' : '▶'}
          </button>
          <span className="music-dock-mini-status" title={statusLine}>{statusLine}</span>
        </div>
      ) : (
      <>
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

      {/* SP-9 — local audio file: the path where the idea just works
          (accurate offline BPM, exact sync, real spectrum, no DRM). */}
      <label className="music-dock-file">
        <input
          type="file"
          accept="audio/*"
          className="music-dock-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPickFile(f);
            e.currentTarget.value = '';
          }}
        />
        <span className="music-dock-file-btn">
          <Icon icon={FileMusic} size="sm" aria-hidden /> Load audio file
        </span>
      </label>
      {fileName && (
        <div className="music-dock-file-now">
          <button
            type="button"
            className="music-dock-pl-trackplay"
            onClick={toggleFilePlay}
            title={filePlaying ? 'Pause' : 'Play'}
          >
            {filePlaying ? '❚❚' : '▶'}
          </button>
          <span className="music-dock-file-name" title={fileName}>{fileName}</span>
          <span className="music-dock-file-status">
            {fileAnalyzing ? 'analyzing…' : bpm > 0 ? `${bpm} BPM · locked` : 'no beat'}
          </span>
        </div>
      )}

      <div
        ref={embedHostRef}
        className="music-dock-embed-host"
        style={{ display: playerState === 'idle' ? 'none' : undefined }}
      />
      {playerState === 'loading' && (
        <div className="twitch-status">Loading player…</div>
      )}

      {/* M.10 — primary beat-sync line. BPM auto-starts the grid; this
          is the single on/off the user usually touches. */}
      <div className="music-dock-syncline">
        <span className="music-dock-bpm">{tapsHint}</span>
        {syncRunning ? (
          <button type="button" className="music-dock-beat-btn is-active" onClick={handleStopSync} aria-label="Stop beat sync">
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

      {/* M.10 — manual tempo (TAP + presets) folded away; most users
          never need it now that detection auto-syncs. */}
      <button
        type="button"
        className="music-dock-manual-toggle"
        onClick={() => setShowManual((v) => !v)}
        aria-expanded={showManual}
      >
        Manual tempo <span className="music-dock-pl-caret">{showManual ? '▾' : '▸'}</span>
      </button>
      {showManual && (
        <div className="music-dock-manual">
          <div className="music-dock-beat">
            <button type="button" className="music-dock-tap-btn" onClick={handleTap}>
              TAP
            </button>
            <span className="music-dock-hint">tap 4× to set tempo, or pick a preset</span>
          </div>
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

      {/* SP-8 — two capture sources. "Tab audio" grabs the digital
          stream (Spotify embed, any tab) — works on headphones, no
          speakers, no mic degradation. "Mic" listens to the room. */}
      <div className="music-dock-source-row">
        <button
          type="button"
          className={`music-dock-beat-btn${captureSource === 'display' ? ' is-active' : ''}`}
          onClick={() => void startCapture('display')}
          aria-pressed={captureSource === 'display'}
        >
          <Icon icon={MonitorSpeaker} size="sm" aria-hidden />
          {captureSource === 'display' ? 'Tab audio on' : 'Tab audio'}
        </button>
        <button
          type="button"
          className={`music-dock-beat-btn${captureSource === 'mic' ? ' is-active' : ''}`}
          onClick={() => void startCapture('mic')}
          aria-pressed={captureSource === 'mic'}
        >
          <Icon icon={captureSource === 'mic' ? Mic : MicOff} size="sm" aria-hidden />
          {captureSource === 'mic' ? 'Mic on' : 'Mic'}
        </button>
      </div>
      <div className="music-dock-hint music-dock-hint-row">
        {captureSource === 'display'
          ? 'capturing tab/system audio — equalizer + live tempo'
          : captureSource === 'mic'
            ? 'listening to the room — equalizer + live tempo'
            : 'Tab audio = internal sound (headphones ok) · Mic = room sound'}
      </div>
      {micError && <div className="twitch-status twitch-status-error">{micError}</div>}

      {/* SP-7 / M.10 — live tempo readout (mic/tab only; file mode has
          exact offline BPM). Auto-applied to the board — no button. The
          chip is the detector's confidence (how clear the beat is). */}
      {micOn && captureSource !== 'file' && (
        <div className="music-dock-beat music-dock-live">
          {live ? (
            <span className="music-dock-live-bpm">
              ♫ {live.bpm} BPM · synced
              <span
                className={`music-dock-live-conf conf-${live.conf > 0.5 ? 'high' : live.conf > 0.3 ? 'mid' : 'low'}`}
                title="How clearly the beat is detected — higher means a steadier lock"
              >
                {live.conf > 0.5 ? 'strong' : live.conf > 0.3 ? 'fair' : 'weak'}
              </span>
            </span>
          ) : (
            <span className="music-dock-hint">detecting tempo… play some music</span>
          )}
        </div>
      )}

      {/* M.15 — equalizer "temperature": calm idle wave → hard tracks
          slam the perimeter to full reach. Persisted via eqSettings. */}
      {micOn && (
        <div className="music-dock-eq-sens">
          <label className="music-dock-eq-sens-label" htmlFor="eq-sens">
            <Icon icon={Flame} size="sm" aria-hidden />
            EQ sensitivity
            <span className="music-dock-eq-sens-val">{eqSens.toFixed(1)}×</span>
          </label>
          <input
            id="eq-sens"
            type="range"
            className="music-dock-eq-sens-range"
            min={EQ_SENS_MIN}
            max={EQ_SENS_MAX}
            step={0.1}
            value={eqSens}
            onChange={(e) => {
              const v = Number.parseFloat(e.target.value);
              eqSettings.setSensitivity(v);
              setEqSens(v);
            }}
            aria-label="Equalizer sensitivity"
          />
          <button
            type="button"
            className={`music-dock-grid-btn${bgGrid ? ' is-active' : ''}`}
            onClick={() => {
              const next = !bgGrid;
              vizMode.setBgGrid(next);
              setBgGrid(next);
            }}
            aria-pressed={bgGrid}
            title="Full-screen sound grid behind the app"
          >
            <Icon icon={Waves} size="sm" aria-hidden />
            {bgGrid ? 'Sound grid on' : 'Sound grid'}
          </button>
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
      </>
      )}
    </aside>,
    document.body,
  );
}
