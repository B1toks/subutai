// Sprint M.1 — Spotify PKCE OAuth (music-beat-sync branch only).
//
// PKCE flow lets us authenticate end-users from a static frontend without
// exposing a client secret. The Client ID is read from a Vite env var so
// the value lives in .env.local during dev and a CI secret in production;
// see .env.example for setup.
//
// scopes: 'user-read-currently-playing' + 'user-read-playback-state' are
// enough for /v1/audio-analysis and /v1/me/player. We deliberately skip
// 'streaming' (Premium-only) so free accounts can connect.

const CLIENT_ID = (import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '').trim();

const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
].join(' ');

const ACCESS_TOKEN_KEY = 'subutai_spotify_access_token';
const EXPIRES_KEY = 'subutai_spotify_token_expires';
const REFRESH_TOKEN_KEY = 'subutai_spotify_refresh_token';
const VERIFIER_KEY = 'subutai_spotify_verifier';

export function isSpotifyConfigured(): boolean {
  return CLIENT_ID.length > 0;
}

function getRedirectUri(): string {
  // Spotify requires an exact match with the URIs registered in the dev
  // dashboard, so we always send the bare origin + path (no query/hash).
  return window.location.origin + window.location.pathname;
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array.buffer);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

export async function startSpotifyAuth(): Promise<void> {
  if (!isSpotifyConfigured()) {
    throw new Error(
      'VITE_SPOTIFY_CLIENT_ID is not set — see .env.example for setup.',
    );
  }
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem(VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: getRedirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export interface CallbackResult {
  ok: boolean;
  token?: string;
  error?: string;
}

export async function handleSpotifyCallback(): Promise<CallbackResult | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (!code && !error) return null;

  // Always scrub the OAuth params from the URL bar so a refresh doesn't
  // re-trigger the exchange (which would fail — codes are single-use).
  const cleanUrl = url.origin + url.pathname;

  if (error) {
    window.history.replaceState({}, '', cleanUrl);
    return { ok: false, error };
  }

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier || !CLIENT_ID) {
    window.history.replaceState({}, '', cleanUrl);
    return { ok: false, error: 'missing_verifier' };
  }
  sessionStorage.removeItem(VERIFIER_KEY);

  try {
    const tokenResp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: getRedirectUri(),
        client_id: CLIENT_ID,
        code_verifier: verifier,
      }),
    });

    if (!tokenResp.ok) {
      window.history.replaceState({}, '', cleanUrl);
      return { ok: false, error: `token_exchange_${tokenResp.status}` };
    }

    const data = (await tokenResp.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };

    localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
    localStorage.setItem(
      EXPIRES_KEY,
      String(Date.now() + data.expires_in * 1000),
    );
    if (data.refresh_token) {
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
    }
    window.history.replaceState({}, '', cleanUrl);
    return { ok: true, token: data.access_token };
  } catch (e) {
    window.history.replaceState({}, '', cleanUrl);
    return { ok: false, error: e instanceof Error ? e.message : 'network' };
  }
}

export function getSpotifyToken(): string | null {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  const expires = parseInt(
    localStorage.getItem(EXPIRES_KEY) ?? '0',
    10,
  );
  if (!token || Number.isNaN(expires) || Date.now() >= expires) return null;
  return token;
}

export function logoutSpotify(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(EXPIRES_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}
