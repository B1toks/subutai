import { useState } from 'react';
import type { BeatClock } from '../hooks/useBeatClock';
import { BeatCalibrator } from './BeatCalibrator';

const STORAGE_KEY = 'subutai_spotify_url';

interface Props {
  clock: BeatClock;
}

function parseSpotifyUrl(url: string): string | null {
  const match = url.match(/spotify\.com\/(playlist|track|album|episode)\/([a-zA-Z0-9]+)/);
  if (!match) return null;
  return `https://open.spotify.com/embed/${match[1]}/${match[2]}?utm_source=subutai`;
}

function readStoredUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(STORAGE_KEY) ?? '';
}

export function MusicPanel({ clock }: Props) {
  const [playlistUrl, setPlaylistUrl] = useState<string>(() => readStoredUrl());
  const [embedSrc, setEmbedSrc] = useState<string | null>(() => {
    const stored = readStoredUrl();
    return stored ? parseSpotifyUrl(stored) : null;
  });
  const [error, setError] = useState<string | null>(null);

  function applyUrl() {
    const trimmed = playlistUrl.trim();
    if (!trimmed) {
      setEmbedSrc(null);
      setError(null);
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const src = parseSpotifyUrl(trimmed);
    if (!src) {
      setError('Not a Spotify playlist / track / album link.');
      return;
    }
    setError(null);
    setEmbedSrc(src);
    window.localStorage.setItem(STORAGE_KEY, trimmed);
  }

  return (
    <section className="sidebar-panel music-panel">
      <h3 className="sidebar-panel-title">
        Beat Sync <span className="beta-tag-small">EXPERIMENTAL</span>
      </h3>
      <div className="music-url-input">
        <input
          type="text"
          placeholder="Paste Spotify playlist / track / album URL"
          value={playlistUrl}
          onChange={(e) => setPlaylistUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyUrl();
          }}
        />
        <button type="button" onClick={applyUrl}>Load</button>
      </div>
      {error && <div className="music-url-error">{error}</div>}
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
      <BeatCalibrator clock={clock} />
    </section>
  );
}
