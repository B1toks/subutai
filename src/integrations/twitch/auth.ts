/**
 * SCAFFOLD (M.15) — Twitch "connected streamer" mode (NOT wired up yet).
 *
 * Today the Twitch module reads chat ANONYMOUSLY (justinfan, no token)
 * and runs voting/predictions LOCALLY on screen. Logging the streamer in
 * with their own Twitch token unlocks the native platform features:
 *   1. Channel Points Predictions — create a REAL Twitch prediction
 *      ("which move?") via Helix, so viewers bet channel points and the
 *      result settles natively. (Needs scope channel:manage:predictions.)
 *   2. EventSub — subscribe to prediction begin/lock/end, follows, subs,
 *      etc. over WebSocket instead of scraping chat.
 *
 * Auth flow: OAuth Authorization Code (Twitch does NOT support PKCE; the
 * code→token exchange needs the client SECRET, so it MUST run on a small
 * server/edge function — it cannot be a pure SPA). Implicit grant works
 * client-side but only yields short-lived tokens with no refresh.
 *
 * Difficulty: MEDIUM–HIGH (higher than Spotify), mostly because of that
 * server requirement:
 *   - You need a backend endpoint (or serverless fn) to hold the secret
 *     and do the token exchange + refresh. That's new infra to deploy.
 *   - Creating predictions is a privileged broadcaster action — only the
 *     channel owner can authorize it; good error handling required.
 *   - EventSub WebSocket has its own subscription/keepalive lifecycle.
 *   - Twitch app review applies before a public (non-allow-listed) launch.
 */

const AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';

/** Broadcaster scopes for native predictions + EventSub. */
export const TWITCH_SCOPES = [
  'channel:manage:predictions',
  'channel:read:predictions',
];

export interface TwitchTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export interface TwitchAuthConfig {
  clientId: string;
  redirectUri: string;
}

/** Step 1 — send the broadcaster to Twitch's consent screen. */
export function beginTwitchLogin(config: TwitchAuthConfig): void {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code', // exchanged server-side (secret)
    scope: TWITCH_SCOPES.join(' '),
  });
  // TODO: window.location.assign(`${AUTHORIZE_URL}?${params}`)
  void AUTHORIZE_URL;
  void params;
}

/** Step 2 — exchange ?code= for tokens. MUST be a server call (secret). */
export async function exchangeTwitchCode(_code: string): Promise<TwitchTokens> {
  // TODO: POST to YOUR backend, which calls id.twitch.tv/oauth2/token with
  // client_secret and returns the tokens. Never put the secret in the SPA.
  throw new Error('SCAFFOLD: implement Twitch token exchange via backend (client secret)');
}

/** Create a native Channel Points prediction for the current move. */
export async function createPrediction(
  _broadcasterId: string,
  _title: string,
  _outcomes: string[],
  _accessToken: string,
): Promise<unknown> {
  // POST https://api.twitch.tv/helix/predictions (Client-Id + Bearer token)
  throw new Error('SCAFFOLD: implement Helix createPrediction');
}
