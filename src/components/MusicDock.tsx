import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Disc3, GripVertical, Mic, MicOff, Play, Square, X } from 'lucide-react';
import { Icon } from './Icon';
import { beatEngine } from '../music/beatEngine';
import { lookupBpm } from '../music/autoBpm';
import { beatMode } from '../music/beatMode';
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
  // Engine mirrors for the UI (the engine itself lives outside React).
  const [bpm, setBpm] = useState(() => beatEngine.getBpm());
  const [syncRunning, setSyncRunning] = useState(() => beatEngine.isRunning());
  // SP-3 — automatic BPM lookup (oEmbed → Deezer).
  const [autoBpm, setAutoBpm] = useState<'idle' | 'looking' | 'found' | 'none'>('idle');
  // SP-3 — Beat Mode: moves snap to the beat (classic solo only).
  const [beatModeOn, setBeatModeOn] = useState(() => beatMode.isEnabled());

  const embedHostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SpotifyController | null>(null);
  // SP-3 — mirrors loadedUrl for the async BPM lookup's stale-result
  // guard (the closure captured at call time would go stale otherwise).
  const loadedUrlRef = useRef('');

  // ── embed controller lifecycle ──
  async function loadUrl() {
    const parsed = parseSpotifyUrl(urlInput);
    if (!parsed || !embedHostRef.current) return;
    try {
      localStorage.setItem(URL_KEY, urlInput);
    } catch { /* private mode */ }
    setPlayerState('loading');
    setLoadedUrl(urlInput);
    loadedUrlRef.current = urlInput;
    beatEngine.setBase('track');
    const saved = readBpmMap()[urlInput];
    if (saved) {
      beatEngine.adoptBpm(saved);
      setAutoBpm('found');
    } else {
      // SP-3 — no saved BPM: try the keyless oEmbed → Deezer lookup so
      // the player doesn't HAVE to tap. A single tap later just fixes
      // the phase. Falls back silently to tap-tempo on any miss.
      setAutoBpm('looking');
      const target = urlInput;
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

  async function toggleMic() {
    setMicError(null);
    if (micEq.isRunning()) {
      micEq.stop();
      setMicOn(false);
      return;
    }
    const result: MicStartResult = await micEq.start();
    if (result.ok) {
      setMicOn(true);
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
    </aside>,
    document.body,
  );
}
