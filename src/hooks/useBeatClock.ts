import { useCallback, useEffect, useRef, useState } from 'react';

// Sprint M.1 — the hook now drives beats from one of two sources:
//   • 'tap'      — manual TAP button (M.0 behaviour, fallback path)
//   • 'analysis' — pre-fetched Spotify audio-analysis array
//
// Both modes share the same listener Set and `isRunning` state so the
// downstream visuals (board pulse, wave overlay, on-beat scoring) don't
// care which source produced the tick.

export interface BeatTick {
  index: number;
  source: 'tap' | 'analysis';
  startSec?: number;       // analysis: beat.start in seconds from track origin
  durationSec?: number;    // analysis: beat.duration
  confidence?: number;     // analysis: 0..1
}

export type BeatListener = (tick: BeatTick) => void;

export interface AnalysisSchedule {
  tempo: number;
  beats: Array<{ start: number; duration: number; confidence: number }>;
}

export type BeatScore = 'perfect' | 'good' | 'off';

export interface BeatClock {
  isRunning: boolean;
  mode: 'idle' | 'tap' | 'analysis';
  bpm: number;
  totalBeats: number;
  currentBeatIndex: number;
  scoreMove: (moveTime: number) => BeatScore;
  onBeat: (cb: BeatListener) => () => void;
  tapBeat: () => void;
  start: () => void;
  startWithAnalysis: (
    analysis: AnalysisSchedule,
    startOffsetSec?: number,
  ) => void;
  stop: () => void;
  reset: () => void;
}

const MAX_TAPS = 8;
const TAPS_FOR_BPM = 4;
const TAP_TIMEOUT_MS = 2500;

const PERFECT_MS = 80;
const GOOD_MS = 150;

export function useBeatClock(): BeatClock {
  const [bpm, setBpm] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [mode, setMode] = useState<'idle' | 'tap' | 'analysis'>('idle');
  const [totalBeats, setTotalBeats] = useState(0);
  const [currentBeatIndex, setCurrentBeatIndex] = useState(-1);

  const tapsRef = useRef<number[]>([]);
  const listenersRef = useRef<Set<BeatListener>>(new Set());
  const rafRef = useRef<number | null>(null);

  // Tap-mode state.
  const tapIntervalRef = useRef<number>(0);
  const tapNextBeatRef = useRef<number>(0);
  const tapTickIndexRef = useRef<number>(-1);

  // Analysis-mode state.
  const beatsRef = useRef<AnalysisSchedule['beats']>([]);
  const nextBeatIdxRef = useRef<number>(0);
  const analysisStartPerfRef = useRef<number>(0);
  const analysisStartOffsetSecRef = useRef<number>(0);

  // Most recent beat fire time (perf clock) — used for scoring symmetry
  // around the nearest beat, regardless of mode.
  const lastBeatPerfRef = useRef<number>(0);

  const fire = useCallback((tick: BeatTick) => {
    lastBeatPerfRef.current = performance.now();
    setCurrentBeatIndex(tick.index);
    listenersRef.current.forEach((cb) => {
      try {
        cb(tick);
      } catch {
        // listener errors must not break the clock
      }
    });
  }, []);

  const tapBeat = useCallback(() => {
    const now = performance.now();
    const last = tapsRef.current[tapsRef.current.length - 1];
    if (last !== undefined && now - last > TAP_TIMEOUT_MS) {
      tapsRef.current = [];
    }
    tapsRef.current.push(now);
    if (tapsRef.current.length > MAX_TAPS) tapsRef.current.shift();

    if (tapsRef.current.length >= TAPS_FOR_BPM) {
      const intervals: number[] = [];
      for (let i = 1; i < tapsRef.current.length; i++) {
        intervals.push(tapsRef.current[i] - tapsRef.current[i - 1]);
      }
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const computed = Math.round(60000 / avgMs);
      if (computed >= 40 && computed <= 220) {
        setBpm(computed);
        tapIntervalRef.current = avgMs;
        tapNextBeatRef.current = now + avgMs;
      }
    }
  }, []);

  const start = useCallback(() => {
    if (tapIntervalRef.current <= 0) return;
    tapTickIndexRef.current = -1;
    setMode('tap');
    setTotalBeats(0);
    setCurrentBeatIndex(-1);
    setIsRunning(true);
  }, []);

  const startWithAnalysis = useCallback(
    (analysis: AnalysisSchedule, startOffsetSec = 0) => {
      if (!analysis.beats || analysis.beats.length === 0) return;
      beatsRef.current = analysis.beats;
      // Skip beats that already passed relative to the offset.
      const firstUpcoming = analysis.beats.findIndex(
        (b) => b.start >= startOffsetSec,
      );
      nextBeatIdxRef.current = firstUpcoming === -1 ? analysis.beats.length : firstUpcoming;
      analysisStartPerfRef.current = performance.now();
      analysisStartOffsetSecRef.current = startOffsetSec;
      setBpm(Math.round(analysis.tempo));
      setMode('analysis');
      setTotalBeats(analysis.beats.length);
      setCurrentBeatIndex(-1);
      setIsRunning(true);
    },
    [],
  );

  const stop = useCallback(() => {
    setIsRunning(false);
    setMode('idle');
  }, []);

  const reset = useCallback(() => {
    tapsRef.current = [];
    tapIntervalRef.current = 0;
    tapNextBeatRef.current = 0;
    beatsRef.current = [];
    nextBeatIdxRef.current = 0;
    lastBeatPerfRef.current = 0;
    setBpm(0);
    setIsRunning(false);
    setMode('idle');
    setTotalBeats(0);
    setCurrentBeatIndex(-1);
  }, []);

  const onBeat = useCallback((cb: BeatListener): (() => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  // rAF dispatch — picks a tick implementation based on `mode`. We avoid
  // setTimeout-per-beat (heavy throttle in background tabs, accumulated
  // drift across hundreds of timers) in favour of one rAF that catches
  // up multiple beats per frame if the tab was paused.
  useEffect(() => {
    if (!isRunning) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const tick = () => {
      const now = performance.now();

      if (mode === 'tap') {
        while (
          tapIntervalRef.current > 0 &&
          now >= tapNextBeatRef.current
        ) {
          tapTickIndexRef.current += 1;
          fire({ index: tapTickIndexRef.current, source: 'tap' });
          tapNextBeatRef.current += tapIntervalRef.current;
        }
      } else if (mode === 'analysis') {
        const elapsedSec =
          (now - analysisStartPerfRef.current) / 1000 +
          analysisStartOffsetSecRef.current;
        const beats = beatsRef.current;
        while (
          nextBeatIdxRef.current < beats.length &&
          beats[nextBeatIdxRef.current].start <= elapsedSec
        ) {
          const idx = nextBeatIdxRef.current;
          const beat = beats[idx];
          fire({
            index: idx,
            source: 'analysis',
            startSec: beat.start,
            durationSec: beat.duration,
            confidence: beat.confidence,
          });
          nextBeatIdxRef.current += 1;
        }
        // Track ran out of beats — auto-stop so listeners can drop UI.
        if (nextBeatIdxRef.current >= beats.length) {
          setIsRunning(false);
          setMode('idle');
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isRunning, mode, fire]);

  const scoreMove = useCallback(
    (moveTime: number): BeatScore => {
      if (!isRunning) return 'off';
      if (mode === 'tap') {
        const intervalMs = tapIntervalRef.current;
        if (intervalMs <= 0) return 'off';
        const next = tapNextBeatRef.current;
        const prev = next - intervalMs;
        const dist = Math.min(
          Math.abs(moveTime - next),
          Math.abs(moveTime - prev),
        );
        if (dist < PERFECT_MS) return 'perfect';
        if (dist < GOOD_MS) return 'good';
        return 'off';
      }
      // Analysis mode: compare to the just-fired beat and the next beat.
      const distToLast = lastBeatPerfRef.current
        ? Math.abs(moveTime - lastBeatPerfRef.current)
        : Infinity;
      const beats = beatsRef.current;
      const nextIdx = nextBeatIdxRef.current;
      let distToNext = Infinity;
      if (nextIdx < beats.length) {
        const elapsedSec =
          (moveTime - analysisStartPerfRef.current) / 1000 +
          analysisStartOffsetSecRef.current;
        distToNext = Math.abs((beats[nextIdx].start - elapsedSec) * 1000);
      }
      const dist = Math.min(distToLast, distToNext);
      if (dist < PERFECT_MS) return 'perfect';
      if (dist < GOOD_MS) return 'good';
      return 'off';
    },
    [isRunning, mode],
  );

  return {
    isRunning,
    mode,
    bpm,
    totalBeats,
    currentBeatIndex,
    scoreMove,
    onBeat,
    tapBeat,
    start,
    startWithAnalysis,
    stop,
    reset,
  };
}

// Kept exported for tests / external use. The hook's own `scoreMove`
// method is preferred for runtime scoring because it has access to the
// internal beat state regardless of mode.
export function scoreMoveAgainstBeat(
  moveTime: number,
  nextBeatAt: number,
  bpm: number,
): BeatScore {
  if (bpm <= 0 || nextBeatAt <= 0) return 'off';
  const intervalMs = 60000 / bpm;
  const prevBeat = nextBeatAt - intervalMs;
  const dist = Math.min(
    Math.abs(moveTime - nextBeatAt),
    Math.abs(moveTime - prevBeat),
  );
  if (dist < PERFECT_MS) return 'perfect';
  if (dist < GOOD_MS) return 'good';
  return 'off';
}
