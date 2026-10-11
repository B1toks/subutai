import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/* The app version from package.json, shown in Help and on the error
 * screen so a bug report says which build it came from. */
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

/* V1 launch hardening — Content-Security-Policy.
 *
 * The app is a static SPA. GitHub Pages cannot send HTTP headers, so the
 * policy ships as a <meta http-equiv> tag injected at BUILD time only, and
 * the Vercel build (subutai.honchar.dev) keeps that same tag. A meta policy
 * cannot carry frame-ancestors, so vercel.json sends that one directive as
 * a header. Dev stays policy-free: Vite's HMR client, inline error overlay
 * and ws://localhost transport would all trip it.
 *
 * Every origin below maps to a real integration:
 *   script   Spotify IFrame API (+ its CDN), Deezer JSONP BPM lookup,
 *            'wasm-unsafe-eval' for the essentia.js WASM beat tracker.
 *   connect  Firebase Auth (identitytoolkit / securetoken) and Firestore
 *            (firestore.googleapis.com), all under *.googleapis.com;
 *            Twitch IRC websocket, 7TV + ivr.fi emote lookups, Spotify
 *            oEmbed, Google Fonts. The app does not use the Realtime
 *            Database, so *.firebaseio.com is not allowed.
 *   frame    the Spotify embed player; Firebase auth helper iframe.
 *   img      7TV emote CDN; blob:/data: for generated canvases.
 *   media    blob: for the local-file music mode.
 * Inline <style> attributes are used throughout React, hence
 * style-src 'unsafe-inline' (style-only, scripts stay strict).
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  // The Spotify IFrame API bootstrap (open.spotify.com) chain-loads its real
  // bundle from embed-cdn.spotifycdn.com (wildcard covers CDN renames), and
  // that bundle evaluates code strings at runtime — verified in the
  // production preview: without 'unsafe-eval' the player never initialises.
  // The policy still forbids inline scripts and any origin not listed here,
  // which is where the real XSS protection lives.
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' https://open.spotify.com https://*.spotifycdn.com https://api.deezer.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://cdn.7tv.app",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "child-src 'self' blob: https://open.spotify.com",
  "frame-src https://open.spotify.com https://subutai-chess.firebaseapp.com",
  "connect-src 'self' https://*.googleapis.com https://open.spotify.com https://*.spotifycdn.com https://api.deezer.com https://7tv.io https://api.ivr.fi wss://irc-ws.chat.twitch.tv https://fonts.googleapis.com https://fonts.gstatic.com",
  'upgrade-insecure-requests',
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'subutai-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  };
}

/* Public base path. Unset, it is /subutai/ — GitHub Pages and the QA specs
 * rely on that. The subutai.honchar.dev build sets VITE_BASE=/ to serve the
 * app from the domain root. Vite keeps a base without its trailing slash
 * as-is, so the service worker would register at "/subutaisw.js"; and a
 * leading "//" is a protocol-relative URL to another host. A bad value
 * fails the build instead of shipping a site that half works. */
const base = process.env.VITE_BASE || '/subutai/';
if (!/^\/(?!\/)(.*\/)?$/.test(base)) {
  throw new Error(`VITE_BASE must start and end with "/", got "${base}"`);
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base,
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
