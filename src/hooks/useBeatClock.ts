import { useCallback, useEffect, useRef, useState } from 'react';

export interface BeatClock {
  isRunning: boolean;
  bpm: number;
  getNextBeatAt: () => number;
  onBeat: (callback: () => void) => () => void;
  tapBeat: () => void;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

const MAX_TAPS = 8;
const TAPS_FOR_BPM = 4;
const TAP_TIMEOUT_MS = 2500;

export function useBeatClock(): BeatClock {
  const [bpm, setBpm] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  const tapsRef = useRef<number[]>([]);
  const listenersRef = useRef<Set<() => void>>(new Set());
  const rafRef = useRef<number | null>(null);
  const nextBeatRef = useRef<number>(0);
  const intervalRef = useRef<number>(0);

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
        intervalRef.current = avgMs;
        nextBeatRef.current = now + avgMs;
      }
    }
  }, []);

  const start = useCallback(() => {
    if (intervalRef.current <= 0) return;
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    tapsRef.current = [];
    intervalRef.current = 0;
    nextBeatRef.current = 0;
    setBpm(0);
    setIsRunning(false);
  }, []);

  const onBeat = useCallback((cb: () => void): (() => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

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
      while (intervalRef.current > 0 && now >= nextBeatRef.current) {
        listenersRef.current.forEach((cb) => {
          try {
            cb();
          } catch {
            // listener errors must not break the clock
          }
        });
        nextBeatRef.current += intervalRef.current;
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
  }, [isRunning]);

  const getNextBeatAt = useCallback(() => nextBeatRef.current, []);

  return {
    isRunning,
    bpm,
    getNextBeatAt,
    onBeat,
    tapBeat,
    start,
    stop,
    reset,
  };
}

export function scoreMoveAgainstBeat(
  moveTime: number,
  nextBeatAt: number,
  bpm: number,
): 'perfect' | 'good' | 'off' {
  if (bpm <= 0 || nextBeatAt <= 0) return 'off';
  const intervalMs = 60000 / bpm;
  const prevBeat = nextBeatAt - intervalMs;
  const dist = Math.min(
    Math.abs(moveTime - nextBeatAt),
    Math.abs(moveTime - prevBeat),
  );
  if (dist < 80) return 'perfect';
  if (dist < 150) return 'good';
  return 'off';
}
