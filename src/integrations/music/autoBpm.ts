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
      const bpm = await deezerBpm(label.title, label.artist);
      if (bpm === null) return null;
      const q = `${label.title} ${label.artist}`.trim();
      return { bpm, label: q };
    })();
    cache.set(spotifyUrl, p);
  }
  return p;
}

/** SP-6 — strip the noise Spotify titles carry that throws off Deezer
 *  matching: "(feat. …)", "(Radio Edit)", "- Remastered 2011", etc. */
function simplifyTitle(title: string): string {
  return title
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s-\s.*$/u, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Run one Deezer search query and return the first sane BPM, or null. */
async function deezerBpmForQuery(query: string): Promise<number | null> {
  if (!query) return null;
  const search = await jsonp<DeezerSearch>(
    `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`,
  );
  const tracks = search?.data ?? [];
  for (const candidate of tracks.slice(0, 3)) {
    if (!candidate.id) continue;
    const detail = await jsonp<DeezerTrack>(`https://api.deezer.com/track/${candidate.id}?`);
    const bpm = detail?.bpm;
    if (bpm && bpm >= 40 && bpm <= 220) return Math.round(bpm * 10) / 10;
  }
  return null;
}

/** Deezer BPM for a "title artist" query, with a simplified-title
 *  fallback so feat./remaster/edit suffixes don't sink the match. */
async function deezerBpm(title: string, artist: string): Promise<number | null> {
  const full = `${title} ${artist}`.trim();
  const first = await deezerBpmForQuery(full);
  if (first !== null) return first;
  const simple = `${simplifyTitle(title)} ${artist}`.trim();
  if (simple && simple !== full) {
    const second = await deezerBpmForQuery(simple);
    if (second !== null) return second;
  }
  return null;
}

export interface AnalyzedTrack {
  /** A track display title ("Song — Artist" when the artist resolves). */
  title: string;
  /** Detected BPM, or null when neither Deezer nor a sane match found one
   *  (the track still plays — it just needs a tap to set tempo). */
  bpm: number | null;
}

/**
 * SP-5 — pre-analyze one track for a saved playlist: resolve the title
 * via Spotify oEmbed, then the BPM via Deezer. Returns null only when
 * the URL doesn't resolve at all (so callers can drop dead links);
 * a resolved track with no BPM comes back as { title, bpm: null }.
 */
export async function analyzeTrack(spotifyUrl: string): Promise<AnalyzedTrack | null> {
  const label = await fetchTrackLabel(spotifyUrl);
  if (!label) return null;
  const title = label.artist ? `${label.title} — ${label.artist}` : label.title;
  const bpm = await deezerBpm(label.title, label.artist);
  return { title, bpm };
}
