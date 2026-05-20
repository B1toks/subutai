// Sprint M.3 — visualizer source orchestrator. Owns the currently-active
// visualizer (off | spotify | mic), forwards its bands stream to React
// subscribers, and coordinates the lifecycle (start/stop) when the
// source switches. Components consume this via two listener APIs:
//
//   • onSourceChange(cb)  — re-render the toggle UI when source flips
//   • onBands(cb)         — receive band updates ~30fps
//
// Centralising state here keeps MusicPanel (toggle UI) and the App
// overlay (rendering) decoupled — neither owns the wiring.

import { micEq, type MicStartResult } from './micEqualizer';
import { spotifyEq } from './spotifyEqualizer';
import type { AudioAnalysis } from '../spotify/analysis';

export type VizSource = 'off' | 'spotify' | 'mic';

const BAND_COUNT = 40;
const STORAGE_KEY = 'subutai_viz_source';

type SourceListener = (source: VizSource) => void;
type BandsListener = (bands: number[]) => void;

const sourceListeners = new Set<SourceListener>();
const bandsListeners = new Set<BandsListener>();

let currentSource: VizSource = readStoredSource();
let lastBands: number[] = new Array(BAND_COUNT).fill(0);
let unsubscribeActive: (() => void) | null = null;
let pendingAnalysis: { analysis: AudioAnalysis; offsetSec: number } | null = null;

function readStoredSource(): VizSource {
  if (typeof window === 'undefined') return 'off';
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'spotify' || v === 'mic' ? v : 'off';
}

function persistSource(s: VizSource) {
  if (typeof window === 'undefined') return;
  if (s === 'off') window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, s);
}

function emitSource() {
  sourceListeners.forEach((cb) => {
    try {
      cb(currentSource);
    } catch {
      /* listener errors must not break orchestration */
    }
  });
}

function emitBands(bands: number[]) {
  lastBands = bands;
  bandsListeners.forEach((cb) => {
    try {
      cb(bands);
    } catch {
      /* listener errors must not break orchestration */
    }
  });
}

function teardownActive() {
  if (unsubscribeActive) {
    unsubscribeActive();
    unsubscribeActive = null;
  }
  spotifyEq.stop();
  micEq.stop();
  emitBands(new Array(BAND_COUNT).fill(0));
}

export function getVizSource(): VizSource {
  return currentSource;
}

export function getLastBands(): number[] {
  return lastBands;
}

export async function setVizSource(
  next: VizSource,
): Promise<MicStartResult | { ok: true }> {
  if (next === currentSource) return { ok: true };

  // Tear down the previous source before bringing the next one up so
  // we never have two rAF loops fighting for the listener set.
  teardownActive();

  currentSource = next;
  persistSource(next);
  emitSource();

  if (next === 'off') {
    return { ok: true };
  }

  if (next === 'spotify') {
    unsubscribeActive = spotifyEq.onUpdate(emitBands);
    // If MusicPanel already fed us analysis (because the user picked
    // a track before flipping the source), wire it now.
    if (pendingAnalysis) {
      spotifyEq.setAnalysis(pendingAnalysis.analysis, pendingAnalysis.offsetSec);
    }
    return { ok: true };
  }

  // next === 'mic'
  const result = await micEq.start();
  if (!result.ok) {
    // Roll back to 'off' so the UI reflects the failure.
    currentSource = 'off';
    persistSource('off');
    emitSource();
    return result;
  }
  unsubscribeActive = micEq.onUpdate(emitBands);
  return { ok: true };
}

export function onSourceChange(cb: SourceListener): () => void {
  sourceListeners.add(cb);
  cb(currentSource);
  return () => {
    sourceListeners.delete(cb);
  };
}

export function onBands(cb: BandsListener): () => void {
  bandsListeners.add(cb);
  cb(lastBands);
  return () => {
    bandsListeners.delete(cb);
  };
}

// MusicPanel calls this when "Start sync" fires so the Spotify
// equalizer follows the same track timeline as the beat scheduler.
// If the user hasn't picked Spotify as the source, we stash the
// analysis so flipping the toggle later picks it up.
export function feedSpotifyAnalysis(
  analysis: AudioAnalysis,
  startOffsetSec = 0,
) {
  pendingAnalysis = { analysis, offsetSec: startOffsetSec };
  if (currentSource === 'spotify') {
    spotifyEq.setAnalysis(analysis, startOffsetSec);
  }
}

export function clearSpotifyAnalysis() {
  pendingAnalysis = null;
  if (currentSource === 'spotify') {
    spotifyEq.stop();
    // Re-subscribe so future setAnalysis calls still emit.
    if (unsubscribeActive) unsubscribeActive();
    unsubscribeActive = spotifyEq.onUpdate(emitBands);
  }
}
