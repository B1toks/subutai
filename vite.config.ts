import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/* V1 launch hardening — Content-Security-Policy.
 *
 * The app is a static SPA on GitHub Pages, which cannot send HTTP headers,
 * so the policy ships as a <meta http-equiv> tag injected at BUILD time
 * only. Dev stays policy-free: Vite's HMR client, inline error overlay and
 * ws://localhost transport would all trip it.
 *
 * Every origin below maps to a real integration:
 *   script   Spotify IFrame API (+ its CDN), Deezer JSONP BPM lookup,
 *            'wasm-unsafe-eval' for the essentia.js WASM beat tracker.
 *   connect  Firebase Auth/Firestore (googleapis), Twitch IRC websocket,
 *            7TV + ivr.fi emote lookups, Spotify oEmbed, Google Fonts.
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
  "script-src 'self' 'wasm-unsafe-eval' https://open.spotify.com https://open.spotifycdn.com https://api.deezer.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://cdn.7tv.app",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "child-src 'self' blob: https://open.spotify.com",
  "frame-src https://open.spotify.com https://subutai-chess.firebaseapp.com",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://open.spotify.com https://api.deezer.com https://7tv.io https://api.ivr.fi wss://irc-ws.chat.twitch.tv https://fonts.googleapis.com https://fonts.gstatic.com",
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

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: '/subutai/',
});
