import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ToastProvider } from './components/Toast'

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

// Sprint 4.4 — PWA service worker. Production only: in dev it would
// cache Vite's transformed modules and serve stale code after edits.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch((err) => console.warn('[pwa] sw registration failed', err));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isShowcase ? (
      <Suspense fallback={null}>
        <ShowcaseView />
      </Suspense>
    ) : (
      <ToastProvider>
        <App />
      </ToastProvider>
    )}
  </StrictMode>,
)
