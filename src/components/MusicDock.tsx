import { useEffect, useMemo, useState } from 'react';
import { Disc3, Mic, MicOff, Play, Square, X } from 'lucide-react';
import { Icon } from './Icon';
import { useBeatClock } from '../hooks/useBeatClock';
import { micEq, type MicStartResult } from '../audio/micEqualizer';

/* SP — the Spotify dock, post-API-deprecation edition.
 *
 * Spotify killed /audio-analysis for new apps (Nov 2024) and DRM walls
 * off the raw audio, so this build needs NO OAuth, NO client id:
 *   • music: the official Spotify embed (full tracks for users logged
 *     into Spotify in the browser, 30s previews otherwise)
 *   • beats: tap-tempo — 4+ taps lock the BPM grid; remembered per
 *     track URL so a song needs calibrating once
 *   • spectrum: the microphone equalizer hears whatever plays (the
 *     embed through speakers included) and drives the perimeter ring
 *
 * The on-beat board pulse writes a class straight onto the board
 * wrapper — kiosk-style imperative wiring, deliberately cheap.
 */

const CHANNEL_KEY = 'subutai_spotify_url';
const BPM_MAP_KEY = 'subutai_spotify_bpm';
const URL_RE = /open\.spotify\.com\/(?:embed\/)?(track|playlist|album)\/([a-zA-Z0-9]+)/;

function embedSrcFor(url: string): { src: string; height: number } | null {
  const m = url.match(URL_RE);
  if (!m) return null;
  const [, type, id] = m;
  return {
    src: `https://open.spotify.com/embed/${type}/${id}?theme=0`,
    height: type === 'track' ? 80 : 152,
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
      return localStorage.getItem(CHANNEL_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [embedUrl, setEmbedUrl] = useState<string>('');
  const [micOn, setMicOn] = useState(() => micEq.isRunning());
  const [micError, setMicError] = useState<string | null>(null);
  const clock = useBeatClock();

  const embed = useMemo(() => (embedUrl ? embedSrcFor(embedUrl) : null), [embedUrl]);

  // Restore the persisted link (and its calibrated BPM) on first open.
  useEffect(() => {
    if (urlInput && embedSrcFor(urlInput)) setEmbedUrl(urlInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On-beat board pulse — imperative class toggle on the board wrapper.
  useEffect(() => {
    return clock.onBeat(() => {
      const board = document.querySelector('.board-with-coords');
      if (!board) return;
      board.classList.remove('beat-tick');
      // Force a reflow so back-to-back beats restart the animation.
      void (board as HTMLElement).offsetWidth;
      board.classList.add('beat-tick');
    });
  }, [clock]);

  function loadUrl() {
    const parsed = embedSrcFor(urlInput);
    if (!parsed) return;
    try {
      localStorage.setItem(CHANNEL_KEY, urlInput);
    } catch { /* private mode */ }
    setEmbedUrl(urlInput);
    // Re-arm a previously calibrated BPM for this link.
    const saved = readBpmMap()[urlInput];
    if (saved) {
      // Seed the clock as if tapped: simplest is leaving it to the user
      // to hit Start — the saved BPM shows in the badge.
      clock.reset();
    }
  }

  function handleTap() {
    clock.tapBeat();
  }

  function handleStart() {
    clock.start();
    if (clock.bpm > 0 && embedUrl) {
      const map = readBpmMap();
      map[embedUrl] = clock.bpm;
      try {
        localStorage.setItem(BPM_MAP_KEY, JSON.stringify(map));
      } catch { /* private mode */ }
    }
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

  // Stop everything when the dock unmounts? No — keep playing (the
  // music is the point); the header button re-opens controls.
  const savedBpm = embedUrl ? readBpmMap()[embedUrl] : undefined;
  const tapsHint =
    clock.bpm > 0
      ? `${clock.bpm} BPM`
      : savedBpm
        ? `saved: ${savedBpm} BPM — tap to re-sync`
        : 'tap 4+ times to the beat';

  return (
    <aside className="music-dock" aria-label="Music dock">
      <div className="music-dock-header">
        <span className="music-dock-title">
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
            if (e.key === 'Enter') loadUrl();
          }}
        />
        <button
          type="button"
          className="music-dock-load-btn"
          onClick={loadUrl}
          disabled={!embedSrcFor(urlInput)}
        >
          Load
        </button>
      </div>

      {embed && (
        <iframe
          className="music-dock-embed"
          src={embed.src}
          height={embed.height}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          title="Spotify player"
        />
      )}

      <div className="music-dock-beat">
        <button type="button" className="music-dock-tap-btn" onClick={handleTap}>
          TAP
        </button>
        <span className="music-dock-bpm">{tapsHint}</span>
        {clock.isRunning ? (
          <button type="button" className="music-dock-beat-btn" onClick={clock.stop} aria-label="Stop beat sync">
            <Icon icon={Square} size="sm" aria-hidden /> Stop
          </button>
        ) : (
          <button
            type="button"
            className="music-dock-beat-btn"
            onClick={handleStart}
            disabled={clock.bpm <= 0}
            aria-label="Start beat sync"
          >
            <Icon icon={Play} size="sm" aria-hidden /> Sync
          </button>
        )}
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
    </aside>
  );
}
