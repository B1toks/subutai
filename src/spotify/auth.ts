/**
 * SCAFFOLD (M.15) — Spotify "connected account" mode (NOT wired up yet).
 *
 * Today the app uses the keyless Spotify *embed* + audio capture: no
 * login, works everywhere, but the beat grid is *estimated* from the
 * sound. Logging the user into their own Spotify unlocks two things the
 * estimate can't match:
 *   1. Audio Analysis API — Spotify returns the track's exact `beats`,
 *      `bars`, `tatums` and `tempo`. The beat grid becomes sample-exact
 *      with zero detection error (perfect Beat Mode).
 *   2. Web Playback SDK — control playback (play/pause/seek/next) from
 *      inside the app instead of the read-only embed.
 *
 * Auth flow: Authorization Code with PKCE (client-side, NO secret — safe
 * to ship in a SPA). Steps are stubbed below; see the difficulty notes.
 *
 * Difficulty: MEDIUM. The PKCE dance itself is ~a day. The real cost is
 * operational: registering a Spotify app, a redirect URI per environment,
 * token refresh/storage, and Spotify's "development mode" 25-user allow-
 * list until you pass their quota-extension review (this gates a public
 * launch). Playback control also requires a Premium account.
 */

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

/** Scopes for read current track + analysis + playback control. */
export const SPOTIFY_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'streaming',
];

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export interface SpotifyAuthConfig {
  clientId: string;
  redirectUri: string;
}

/** TODO: crypto-random verifier + S256 challenge (PKCE). */
async function makePkcePair(): Promise<{ verifier: string; challenge: string }> {
  throw new Error('SCAFFOLD: implement PKCE verifier/challenge (crypto.subtle SHA-256 + base64url)');
}

/** Step 1 — send the user to Spotify's consent screen. */
export async function beginSpotifyLogin(config: SpotifyAuthConfig): Promise<void> {
  const { challenge } = await makePkcePair();
  // TODO: persist verifier (sessionStorage) for the callback exchange.
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES.join(' '),
  });
  // TODO: window.location.assign(`${AUTHORIZE_URL}?${params}`)
  void AUTHORIZE_URL;
  void params;
}

/** Step 2 — exchange the ?code= on the redirect for tokens (PKCE: no secret). */
export async function exchangeSpotifyCode(
  _code: string,
  _config: SpotifyAuthConfig,
): Promise<SpotifyTokens> {
  // TODO: POST TOKEN_URL with grant_type=authorization_code + code_verifier.
  void TOKEN_URL;
  throw new Error('SCAFFOLD: implement Spotify token exchange');
}

/** Pull the exact beat grid for the playing track (the whole point). */
export async function fetchAudioAnalysis(_trackId: string, _accessToken: string): Promise<unknown> {
  // GET https://api.spotify.com/v1/audio-analysis/{id} → { beats, bars, tatums, ... }
  throw new Error('SCAFFOLD: implement Spotify Audio Analysis fetch → feed beatEngine.setGrid()');
}
