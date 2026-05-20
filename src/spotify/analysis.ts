// Sprint M.1 — Spotify Audio Analysis fetcher.
//
// /v1/audio-analysis/{id} returns a heavy JSON blob with per-beat,
// per-bar, per-section timings. We keep only what the beat scheduler
// needs (tempo + the beats array) so the rest can be garbage-collected.
//
// Note: this endpoint was deprecated for newly-registered apps in late
// 2024 — for those, the API returns 403 regardless of scope. Existing
// dev apps still work. The MusicPanel surfaces the 403 distinctly so
// users know to either reuse an older dev app or fall back to tap-tempo.

import { getSpotifyToken, logoutSpotify } from './auth';

export interface SpotifyBeat {
  start: number;       // seconds from track origin
  duration: number;
  confidence: number;
}

export interface SpotifySegment {
  start: number;
  duration: number;
  loudness_start: number;
  loudness_max: number;
  loudness_max_time: number;
  pitches: number[];   // 12 chroma values, 0..1
  timbre: number[];    // 12 mel-frequency timbre coefficients
}

export interface AudioAnalysis {
  tempo: number;
  time_signature: number;
  beats: SpotifyBeat[];
  sections: Array<{ start: number; tempo: number }>;
  segments: SpotifySegment[];
}

export type AnalysisError =
  | { kind: 'no_token' }
  | { kind: 'unauthorized' }            // 401 — expired / revoked
  | { kind: 'forbidden' }               // 403 — likely the post-2024 deprecation
  | { kind: 'not_found' }
  | { kind: 'rate_limited'; retryAfter?: number }
  | { kind: 'network'; status?: number; message?: string };

export type AnalysisResult =
  | { ok: true; data: AudioAnalysis }
  | { ok: false; error: AnalysisError };

interface RawAnalysis {
  track?: { tempo?: number; time_signature?: number };
  beats?: SpotifyBeat[];
  sections?: Array<{ start: number; tempo: number }>;
  segments?: SpotifySegment[];
}

export async function fetchAudioAnalysis(
  trackId: string,
): Promise<AnalysisResult> {
  const token = getSpotifyToken();
  if (!token) return { ok: false, error: { kind: 'no_token' } };

  let resp: Response;
  try {
    resp = await fetch(`https://api.spotify.com/v1/audio-analysis/${trackId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'network',
        message: e instanceof Error ? e.message : 'fetch failed',
      },
    };
  }

  if (!resp.ok) {
    if (resp.status === 401) {
      logoutSpotify();
      return { ok: false, error: { kind: 'unauthorized' } };
    }
    if (resp.status === 403) {
      return { ok: false, error: { kind: 'forbidden' } };
    }
    if (resp.status === 404) {
      return { ok: false, error: { kind: 'not_found' } };
    }
    if (resp.status === 429) {
      const retryAfter = parseInt(resp.headers.get('Retry-After') ?? '0', 10);
      return {
        ok: false,
        error: {
          kind: 'rate_limited',
          retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
        },
      };
    }
    return {
      ok: false,
      error: { kind: 'network', status: resp.status },
    };
  }

  const raw = (await resp.json()) as RawAnalysis;
  return {
    ok: true,
    data: {
      tempo: raw.track?.tempo ?? 0,
      time_signature: raw.track?.time_signature ?? 4,
      beats: raw.beats ?? [],
      sections: raw.sections ?? [],
      segments: raw.segments ?? [],
    },
  };
}

export function parseTrackId(url: string): string | null {
  const match = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
  return match?.[1] ?? null;
}

export function describeAnalysisError(err: AnalysisError): string {
  switch (err.kind) {
    case 'no_token':
      return 'Connect Spotify first.';
    case 'unauthorized':
      return 'Spotify session expired — reconnect.';
    case 'forbidden':
      return 'Audio-analysis endpoint refused. Newer dev apps lose access; tap-tempo still works.';
    case 'not_found':
      return 'Track not found — paste a Spotify TRACK URL.';
    case 'rate_limited':
      return err.retryAfter
        ? `Rate limited — retry in ${err.retryAfter}s.`
        : 'Rate limited — try again shortly.';
    case 'network':
      return err.status
        ? `Spotify API error (${err.status}).`
        : 'Network error fetching analysis.';
  }
}
