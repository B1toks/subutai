# Subutai → Google Play (TWA) release guide

Status snapshot (2026-06-16):
- ✅ **PWA is done and correct.** `public/manifest.webmanifest` (scope
  `/subutai/`, standalone, 192/512/maskable icons), `public/sw.js`
  (network-first nav, cache-first assets), registered in `src/main.tsx`
  (PROD only). Vite base `/subutai/` rewrites every asset path correctly.
- ✅ **Installable today.** On Android Chrome → ⋮ → *Install app* /
  *Add to Home screen*. This already gives an app-like, offline-capable
  experience with **no Play Store needed**.
- ⏳ **Play Store = wrap the PWA as a TWA** (Trusted Web Activity) →
  signed `.aab` via Bubblewrap. Steps below.

Deploy target: **GitHub Pages** at `https://b1toks.github.io/subutai/`.

---

## The hard truth on timing
A brand-new app on a **new** personal Play Console account will **not** be
live tomorrow. The blockers are operational, not technical:
1. **Account identity verification** — ~1–3 days.
2. **New personal accounts must run closed testing with ≥12 testers for
   14 continuous days** before you can apply for production access.
3. First review — hours to a few days.

→ Realistic plan: ship the **PWA install** now (today), run the TWA through
**Internal testing** ASAP to start the clock, production later.

---

## Step 1 — Generate a signing key (once)
```bash
keytool -genkeypair -v -keystore subutai-release.keystore \
  -alias subutai -keyalg RSA -keysize 2048 -validity 10000
```
Keep this keystore + password SAFE (losing it = can't update the app).

Get its SHA-256 fingerprint (needed for assetlinks):
```bash
keytool -list -v -keystore subutai-release.keystore -alias subutai
# copy the "SHA256:" line (AA:BB:CC:…)
```

## Step 2 — Bubblewrap (wrap the PWA)
```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://b1toks.github.io/subutai/manifest.webmanifest
```
Answer the prompts (values from our manifest):
- Host: `b1toks.github.io`
- Start URL: `/subutai/`
- App name: `Subutai`  ·  short: `Subutai`
- Theme/background color: `#0e0a06`
- Icon: `https://b1toks.github.io/subutai/pwa-512.png`
- Signing key: point to `subutai-release.keystore`, alias `subutai`
- Application ID (package): e.g. `io.github.b1toks.subutai`

Build the bundle:
```bash
bubblewrap build      # → app-release-bundle.aab (upload this) + app-release-signed.apk (local test)
```
Requires JDK 17 + Android SDK; Bubblewrap can fetch them on first run.

## Step 3 — Digital Asset Links (removes the browser URL bar)
The TWA only runs full-screen if the site proves it owns the app. Create
`assetlinks.json`:
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "io.github.b1toks.subutai",
    "sha256_cert_fingerprints": ["<SHA256 from Step 1>"]
  }
}]
```
⚠️ **It MUST be served at the DOMAIN ROOT**, not under `/subutai/`:
`https://b1toks.github.io/.well-known/assetlinks.json`

On GitHub Pages that root is a **separate repo** — the user/site pages repo
named **`b1toks.github.io`** (NOT this `subutai` project repo). Put the file
at `.well-known/assetlinks.json` in that repo. (If Google later uses Play
App Signing, add Google's re-signed fingerprint here too — find it in
Play Console → App integrity.)

## Step 4 — Play Console
1. Create app, fill store listing (use `public/og-image.png` + screenshots),
   content rating, **Data safety** form, privacy policy URL.
2. Upload the `.aab` to **Internal testing** first (fastest), then closed
   testing (the 12-tester / 14-day requirement), then production.

---

## Android caveats to test in the TWA
- **Tab audio capture (`getDisplayMedia`) does NOT work** inside an Android
  TWA/WebView the way it does on desktop Chrome. The music equalizer / live
  BPM will need **Mic** or **local file** mode on Android. Verify and, if
  needed, hide the "Tab audio" button when running as an installed app
  (`window.matchMedia('(display-mode: standalone)').matches`).
- Spotify embed playback in a WebView can be flaky — local-file + mic paths
  are the reliable ones on mobile.
- Test offline launch (SW cache) and the back button (TWA closes on back at
  the start URL).

## TL;DR fastest path
Today: announce the **PWA install** (works now). This week: keystore →
Bubblewrap → upload to Internal testing to start the new-account testing
clock. Production once the 14-day / 12-tester window clears.
