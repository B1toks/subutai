import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ShowcaseView } from './components/ShowcaseView'
import { ToastProvider } from './components/Toast'

// Sprint 4.3 — `?showcase=1` switches the entire app to a kiosk/TV view
// that streams AI vs AI auto-play and interrupts with the leaderboard
// whenever a brand-new user joins. Separate from the existing `?auto=1`
// (data-collection mode); showcase is a public consumer of read-only
// Firestore data and never writes anything back.
const isShowcase = new URLSearchParams(window.location.search).get('showcase') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isShowcase ? (
      <ShowcaseView />
    ) : (
      <ToastProvider>
        <App />
      </ToastProvider>
    )}
  </StrictMode>,
)
