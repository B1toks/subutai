import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { inject } from '@vercel/analytics'
import './index.css'
import App from './App.tsx'
import { ToastProvider } from './components/Toast'
import { BusyOverlay } from './components/BusyOverlay'
import { AppErrorBoundary } from './components/AppErrorBoundary'

// Sprint 4.4 — kiosk view is code-split: regular players never pay for it.
const ShowcaseView = lazy(() =>
  import('./components/ShowcaseView').then((m) => ({ default: m.ShowcaseView })),
)

// Sprint 4.3 — `?showcase=1` switches the entire app to a kiosk/TV view
// that streams AI vs AI auto-play and interrupts with the leaderboard
// whenever a brand-new user joins. Separate from the existing `?auto=1`
// (data-collection mode); showcase is a public consumer of read-only
// Firestore data and never writes anything back.
const isShowcase = new URLSearchParams(window.location.search).get('showcase') === '1';

// The kiosk is the only view set in Inter (the app itself is system-ui),
// so the face is fetched for it alone instead of blocking every first paint.
if (isShowcase) {
  const inter = document.createElement('link');
  inter.rel = 'stylesheet';
  inter.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap';
  document.head.appendChild(inter);
}

// V1 — async font swap. index.html loads the decorative theme faces with
// media="print" so they never block first paint; this flips them live once
// downloaded. Used to be an inline onload= handler, which the production
// Content-Security-Policy (no 'unsafe-inline' for scripts) now forbids.
for (const link of Array.from(
  document.querySelectorAll<HTMLLinkElement>('link[data-async-font]'),
)) {
  const swap = () => {
    link.media = 'all';
  };
  if (link.sheet) swap();
  else link.addEventListener('load', swap, { once: true });
}

// Vercel Web Analytics: cookie-less page-view counts, production only. The
// script is served from this origin (/_vercel/insights), so the CSP needs no
// new host. The kiosk view is not counted.
if (import.meta.env.PROD && !isShowcase) inject();

// Sprint 4.4 — PWA service worker. Production only: in dev it would
// cache Vite's transformed modules and serve stale code after edits.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch((err) => console.warn('[pwa] sw registration failed', err));
  });
}

// HMR can re-execute this entry module; calling createRoot twice on the
// same container is a React error (and spams the console in dev). Stash
// the root on the container and reuse it.
const container = document.getElementById('root')!;
interface RootHost {
  __subutaiRoot?: ReturnType<typeof createRoot>;
}
const host = container as unknown as RootHost;
const root = host.__subutaiRoot ?? (host.__subutaiRoot = createRoot(container));

root.render(
  <StrictMode>
    {isShowcase ? (
      <Suspense fallback={null}>
        <ShowcaseView />
      </Suspense>
    ) : (
      // QA-07 — a render error shows a way out instead of a blank page.
      <AppErrorBoundary>
        <ToastProvider>
          <App />
          {/* V1 — outside App's view tree, so it exists on every screen. */}
          <BusyOverlay />
        </ToastProvider>
      </AppErrorBoundary>
    )}
  </StrictMode>,
)
