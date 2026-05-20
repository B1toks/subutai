import { useEffect, useState } from 'react';
import { Music, ExternalLink, Mic, Radio } from 'lucide-react';
import type { BeatClock } from '../hooks/useBeatClock';
import { Icon } from './Icon';
import { BeatCalibrator } from './BeatCalibrator';
import {
  getSpotifyToken,
  isSpotifyConfigured,
  logoutSpotify,
  startSpotifyAuth,
} from '../spotify/auth';
import {
  describeAnalysisError,
  fetchAudioAnalysis,
  parseTrackId,
  type AudioAnalysis,
} from '../spotify/analysis';
import { useToast } from './Toast';
import {
  clearSpotifyAnalysis,
  feedSpotifyAnalysis,
  getVizSource,
  onSourceChange,
  setVizSource,
  type VizSource,
} from '../audio/visualizerSource';

const URL_STORAGE_KEY = 'subutai_spotify_url';

interface Props {
  clock: BeatClock;
}

function parseEmbedUrl(url: string): string | null {
  const match = url.match(
    /spotify\.com\/(playlist|track|album|episode)\/([a-zA-Z0-9]+)/,
  );
  if (!match) return null;
  return `https://open.spotify.com/embed/${match[1]}/${match[2]}?utm_source=subutai`;
}

function readStoredUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(URL_STORAGE_KEY) ?? '';
}

export function MusicPanel({ clock }: Props) {
  const toast = useToast();

  const [trackUrl, setTrackUrl] = useState<string>(() => readStoredUrl());
  const [embedSrc, setEmbedSrc] = useState<string | null>(() => {
    const stored = readStoredUrl();
    return stored ? parseEmbedUrl(stored) : null;
  });
  const [urlError, setUrlError] = useState<string | null>(null);

  // Sprint M.1 — Spotify session state. `hasToken` is re-read on a
  // window event so the Connect-button flow can flip without a manual
  // remount (the OAuth callback in App.tsx dispatches it).
  const [hasToken, setHasToken] = useState<boolean>(() => !!getSpotifyToken());
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  useEffect(() => {
    function refreshToken() {
      setHasToken(!!getSpotifyToken());
    }
    window.addEventListener('subutai:spotify-auth-changed', refreshToken);
    return () =>
      window.removeEventListener('subutai:spotify-auth-changed', refreshToken);
  }, []);

  // Sprint M.3 — visualizer source toggle. Mirrors the orchestrator's
  // state so this component re-renders when another caller (or the
  // orchestrator's own rollback on permission denial) changes it.
  const [vizSource, setVizSourceState] = useState<VizSource>(() => getVizSource());
  useEffect(() => onSourceChange(setVizSourceState), []);

  async function selectVizSource(next: VizSource) {
    const result = await setVizSource(next);
    if (!('ok' in result) || result.ok) return;
    // Mic start failed — translate the reason to a user-facing toast.
    const msg =
      result.reason === 'denied'
        ? 'Microphone access denied.'
        : result.reason === 'no-device'
          ? 'No microphone found.'
          : result.reason === 'insecure'
            ? 'Microphone needs HTTPS or localhost.'
            : result.message || 'Could not start microphone.';
    toast.show(msg, 'error');
  }

  function applyUrl() {
    const trimmed = trackUrl.trim();
    if (!trimmed) {
      setEmbedSrc(null);
      setUrlError(null);
      window.localStorage.removeItem(URL_STORAGE_KEY);
      return;
    }
    const src = parseEmbedUrl(trimmed);
    if (!src) {
      setUrlError('Not a Spotify playlist / track / album link.');
      return;
    }
    setUrlError(null);
    setEmbedSrc(src);
    window.localStorage.setItem(URL_STORAGE_KEY, trimmed);
  }

  async function loadAnalysis() {
    const trackId = parseTrackId(trackUrl);
    if (!trackId) {
      toast.show('Paste a Spotify TRACK URL to fetch beats.', 'error');
      return;
    }
    setAnalysisLoading(true);
    const result = await fetchAudioAnalysis(trackId);
    setAnalysisLoading(false);
    if (!result.ok) {
      if (result.error.kind === 'unauthorized') {
        setHasToken(false);
      }
      toast.show(describeAnalysisError(result.error), 'error');
      return;
    }
    setAnalysis(result.data);
    toast.show(
      `Loaded: ${result.data.tempo.toFixed(0)} BPM · ${result.data.beats.length} beats`,
      'success',
    );
  }

  function startAnalysisSync() {
    if (!analysis) return;
    clock.startWithAnalysis(analysis, 0);
    // Same timeline → equalizer follows the beat clock. If the user
    // hasn't picked 'spotify' as visualizer source the orchestrator
    // stashes this until they do.
    feedSpotifyAnalysis(analysis, 0);
  }

  function stopAnalysisSync() {
    clock.stop();
    clearSpotifyAnalysis();
  }

  function disconnect() {
    logoutSpotify();
    setHasToken(false);
    setAnalysis(null);
    clearSpotifyAnalysis();
    toast.show('Spotify disconnected.', 'info');
  }

  async function connect() {
    if (!isSpotifyConfigured()) {
      toast.show(
        'Set VITE_SPOTIFY_CLIENT_ID — see .env.example.',
        'error',
      );
      return;
    }
    try {
      await startSpotifyAuth();
    } catch (e) {
      toast.show(
        e instanceof Error ? e.message : 'Failed to start Spotify auth.',
        'error',
      );
    }
  }

  const showConfigWarning = !isSpotifyConfigured();

  return (
    <section className="sidebar-panel music-panel">
      <h3 className="sidebar-panel-title">
        Beat Sync <span className="beta-tag-small">EXPERIMENTAL</span>
      </h3>

      {showConfigWarning && (
        <div className="music-config-warning">
          Spotify Client ID not configured. Auto-BPM is disabled — only the
          manual TAP fallback works. See <code>.env.example</code>.
        </div>
      )}

      {!hasToken && !showConfigWarning && (
        <div className="spotify-connect-prompt">
          <p>Connect Spotify for auto beat detection.</p>
          <button
            type="button"
            onClick={connect}
            className="spotify-connect-btn"
          >
            <Icon icon={Music} size="sm" aria-hidden />
            Connect Spotify
          </button>
          <p className="music-hint">
            Free account works. We only read playback data.
          </p>
        </div>
      )}

      {hasToken && (
        <div className="spotify-status">
          <span className="status-dot is-connected" aria-hidden />
          Connected
          <button
            type="button"
            className="spotify-disconnect-btn"
            onClick={disconnect}
          >
            Disconnect
          </button>
        </div>
      )}

      <div className="music-url-input">
        <input
          type="text"
          placeholder="Spotify track URL"
          value={trackUrl}
          onChange={(e) => setTrackUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyUrl();
          }}
        />
        <button type="button" onClick={applyUrl}>Load</button>
      </div>
      {urlError && <div className="music-url-error">{urlError}</div>}

      {embedSrc && (
        <iframe
          src={embedSrc}
          width="100%"
          height="152"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          className="spotify-embed"
          title="Spotify player"
        />
      )}

      {hasToken && (
        <div className="analysis-controls">
          <button
            type="button"
            className="analysis-fetch-btn"
            onClick={loadAnalysis}
            disabled={analysisLoading || !parseTrackId(trackUrl)}
          >
            {analysisLoading ? 'Fetching…' : 'Fetch beats'}
          </button>
          {analysis && (
            <div className="analysis-info">
              <strong>{analysis.tempo.toFixed(0)} BPM</strong>
              <span> · {analysis.time_signature}/4</span>
              <span> · {analysis.beats.length} beats</span>
            </div>
          )}
          {analysis && !clock.isRunning && (
            <button
              type="button"
              className="analysis-start-btn"
              onClick={startAnalysisSync}
            >
              ▶ Start sync (when track begins)
            </button>
          )}
          {clock.isRunning && clock.mode === 'analysis' && (
            <button
              type="button"
              className="analysis-stop-btn"
              onClick={stopAnalysisSync}
            >
              Stop sync
            </button>
          )}
        </div>
      )}

      <div className="viz-source-select">
        <span className="viz-source-label">Visualizer</span>
        <div className="viz-source-buttons">
          <button
            type="button"
            className={`viz-source-btn${vizSource === 'off' ? ' is-active' : ''}`}
            onClick={() => void selectVizSource('off')}
          >
            Off
          </button>
          <button
            type="button"
            className={`viz-source-btn${vizSource === 'spotify' ? ' is-active' : ''}`}
            onClick={() => void selectVizSource('spotify')}
            disabled={!hasToken}
            title={
              hasToken
                ? 'Spotify segments (pseudo-EQ, no DRM access)'
                : 'Connect Spotify first'
            }
          >
            <Icon icon={Radio} size="sm" aria-hidden /> Spotify
          </button>
          <button
            type="button"
            className={`viz-source-btn${vizSource === 'mic' ? ' is-active' : ''}`}
            onClick={() => void selectVizSource('mic')}
            title="Real-time FFT from your microphone"
          >
            <Icon icon={Mic} size="sm" aria-hidden /> Mic
          </button>
        </div>
        {vizSource === 'mic' && (
          <p className="music-hint">
            Mic captures any audio nearby — speakers, phone, TV.
          </p>
        )}
      </div>

      <details className="music-fallback">
        <summary>Manual TAP (fallback)</summary>
        <BeatCalibrator clock={clock} />
      </details>

      <details className="music-help">
        <summary>How to get full playback</summary>
        <ol>
          <li>
            Open{' '}
            <a
              href="https://open.spotify.com"
              target="_blank"
              rel="noreferrer"
            >
              open.spotify.com <Icon icon={ExternalLink} size="sm" aria-hidden />
            </a>{' '}
            in another tab.
          </li>
          <li>Log in (free account works).</li>
          <li>
            Return here — the embed below will play full tracks instead of
            30-second previews.
          </li>
        </ol>
      </details>
    </section>
  );
}
