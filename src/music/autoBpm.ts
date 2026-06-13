/**
 * SP-3 — automatic BPM lookup, zero keys, zero OAuth.
 *
 * Pipeline:
 *   1. Spotify oEmbed (public, CORS-friendly): track URL → title
 *      ("Song" + author iframe title "Song by Artist").
 *   2. Deezer public API: search the title, read `bpm` off the top
 *      results. Deezer blocks plain CORS fetch but supports JSONP
 *      (&output=jsonp&callback=...) — a script tag does the job.
 *
 * Every failure degrades to null → the dock falls back to tap-tempo.
 * Results are cached per URL (and the dock persists the BPM anyway).
 */

interface OEmbedResponse {
  title?: string;
  /** "Spotify Embed: <title>" iframe_url page title etc. */
  author_name?: string;
}

interface DeezerTrack {
  id?: number;
  bpm?: number;
  title?: string;
  artist?: { name?: string };
}

interface DeezerSearch {
  data?: DeezerTrack[];
}

export interface AutoBpmResult {
  bpm: number;
  /** "Song — Artist" used for the lookup, for the UI. */
  label: string;
}

/** oEmbed gives the track title; author_name is the artist. */
async function fetchTrackLabel(spotifyUrl: string): Promise<{ title: string; artist: string } | null> {
  try {
    const res = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as OEmbedResponse;
    if (!data.title) return null;
    return { title: data.title, artist: data.author_name ?? '' };
  } catch {
    return null;
  }
}

let jsonpCounter = 0;

/** JSONP request — Deezer's public API has no CORS headers, but
 *  supports ?output=jsonp. Times out after 8s. */
function jsonp<T>(url: string): Promise<T | null> {
  return new Promise((resolve) => {
    const cbName = `__deezerCb${Date.now()}_${jsonpCounter++}`;
    const w = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    const timeout = setTimeout(() => cleanup(null), 8000);

    function cleanup(result: T | null) {
      clearTimeout(timeout);
      delete w[cbName];
      script.remove();
      resolve(result);
    }

    w[cbName] = (data: T) => cleanup(data);
    script.onerror = () => cleanup(null);
    script.src = `${url}&output=jsonp&callback=${cbName}`;
    document.body.appendChild(script);
  });
}

const cache = new Map<string, Promise<AutoBpmResult | null>>();

export function lookupBpm(spotifyUrl: string): Promise<AutoBpmResult | null> {
  let p = cache.get(spotifyUrl);
  if (!p) {
    p = (async (): Promise<AutoBpmResult | null> => {
      const label = await fetchTrackLabel(spotifyUrl);
      if (!label) return null;
      const q = `${label.title} ${label.artist}`.trim();
      const search = await jsonp<DeezerSearch>(
        `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`,
      );
      const tracks = search?.data ?? [];
      if (tracks.length === 0) return null;
      // Deezer's /search omits BPM (always null there); the real value
      // lives on /track/{id}. Probe the top few matches until one has a
      // sane BPM (some tracks genuinely have none).
      for (const candidate of tracks.slice(0, 3)) {
        if (!candidate.id) continue;
        const detail = await jsonp<DeezerTrack>(
          `https://api.deezer.com/track/${candidate.id}?`,
        );
        const bpm = detail?.bpm;
        if (bpm && bpm >= 40 && bpm <= 220) {
          return { bpm: Math.round(bpm * 10) / 10, label: q };
        }
      }
      return null;
    })();
    cache.set(spotifyUrl, p);
  }
  return p;
}
