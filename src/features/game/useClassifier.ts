import {
  useState,
  useRef,
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from 'react';
import type { MoveAnalysis, MoveClass } from '../../analysis/classify';
import type { SquareId, BoardState } from '../../engine';
import { audio } from '../../audio/AudioController';
import type { GameLog } from '../../recording/log';
import { session } from '../../session/session';
import { applyRotationMove } from '../../engine/auxetic';
import { applyMove } from '../../engine/moves';
import { classifyAsync } from '../../analysis/classifyClient';
import { scaleBudgetMs } from '../../utils/deviceTier';

interface UseClassifierArgs {
  setSearchEvalFromWhite: Dispatch<SetStateAction<number | null>>;
  setSearchMateInPlies: Dispatch<SetStateAction<number | null>>;
  shellRef: RefObject<HTMLDivElement | null>;
  logLengthRef: RefObject<number>;
  logIdRef: RefObject<string>;
  classifyRunRef: RefObject<number>;
  setClassifiedSquare: Dispatch<
    SetStateAction<{ square: SquareId; classification: 'blunder' | 'brilliant' } | null>
  >;
  classifyTimerRef: RefObject<number | null>;
  setSacrificeSquare: Dispatch<SetStateAction<SquareId | null>>;
  sacrificeTimerRef: RefObject<number | null>;
}

/**
 * The move classifier's results on the board: commitAnalysis records a
 * finished classification in the log and plays its visuals (eval push,
 * ?? and !! flashes, sacrifice burst) unless a newer move or game has
 * replaced it; classifyImportedLog classifies a loaded log in the
 * background. commitAnalysis keeps one identity for the whole session,
 * which the bot's scheduler relies on.
 */
export function useClassifier({
  setSearchEvalFromWhite,
  setSearchMateInPlies,
  shellRef,
  logLengthRef,
  logIdRef,
  classifyRunRef,
  setClassifiedSquare,
  classifyTimerRef,
  setSacrificeSquare,
  sacrificeTimerRef,
}: UseClassifierArgs) {
  // Sprint 3.2.1 — distinctive screen-wide effect on blunder / brilliant
  // classifications. The existing generic flash overlay (--flash-opacity
  // on .app-shell::after) is kept; this adds shake + vignette for ??
  // and a gold pulse + floating sparkles for !!.
  const [flashEffect, setFlashEffect] = useState<'blunder' | 'brilliant' | null>(null);
  const flashEffectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push the search-backed eval from an analysis into the bar/gradient state.
  // Used by every classify callsite (live moves, AI, imported-log completion).
  const pushSearchEval = useCallback((analysis: MoveAnalysis) => {
    setSearchEvalFromWhite(analysis.searchScoreFromWhite);
    setSearchMateInPlies(analysis.isMate ? analysis.mateInPlies ?? 0 : null);
  }, [setSearchEvalFromWhite, setSearchMateInPlies]);

  const flagClassifiedSquare = useCallback(
    (square: SquareId, classification: 'blunder' | 'brilliant') => {
      if (classifyTimerRef.current) clearTimeout(classifyTimerRef.current);
      setClassifiedSquare({ square, classification });
      classifyTimerRef.current = setTimeout(() => {
        setClassifiedSquare(null);
        classifyTimerRef.current = null;
      }, 2500);
    },
    [classifyTimerRef, setClassifiedSquare],
  );

  // Triggers a screen flash for a classified move. Sets the colour/peak
  // opacity/transition duration as CSS variables; on the next frame, snaps
  // opacity back to 0 so the registered --flash-opacity transition fades it.
  const triggerFlash = useCallback((cls: MoveClass) => {
    const shell = shellRef.current;
    if (!shell) return;
    let color: string;
    let peak: string;
    let durationMs: number;
    if (cls === 'blunder') {
      color = 'rgb(220, 40, 40)';
      peak = '0.35';
      durationMs = 400;
    } else if (cls === 'brilliant') {
      color = 'rgb(255, 200, 80)';
      peak = '0.45';
      durationMs = 600;
    } else if (cls === 'checkmate') {
      color = 'rgb(255, 255, 255)';
      peak = '0.6';
      durationMs = 800;
    } else {
      return;
    }
    shell.style.setProperty('--flash-color', color);
    shell.style.setProperty('--flash-duration', `${durationMs}ms`);
    shell.style.setProperty('--flash-opacity', peak);
    setTimeout(() => {
      shell.style.setProperty('--flash-opacity', '0');
    }, 50);

    // Sprint 3.2.1 — additional distinctive overlay/effect for ?? / !!.
    // Checkmate flash is handled separately by the gameStatus useEffect
    // (body.checkmate-flash radial whiteout).
    let effectKind: 'blunder' | 'brilliant' | null = null;
    let effectDuration = 0;
    if (cls === 'blunder') {
      effectKind = 'blunder';
      effectDuration = 800;
    } else if (cls === 'brilliant') {
      effectKind = 'brilliant';
      effectDuration = 1500;
    }
    if (effectKind) {
      if (flashEffectTimerRef.current) clearTimeout(flashEffectTimerRef.current);
      setFlashEffect(effectKind);
      flashEffectTimerRef.current = setTimeout(() => {
        setFlashEffect(null);
        flashEffectTimerRef.current = null;
      }, effectDuration);
    }
    // Sprint 3.7 — classifier SFX. Runs *after* the move/capture SFX
    // from the log-watching effect above (analysis lands async on the
    // classifier worker, so a short delay puts the brilliant /
    // blunder voice on top of the move thump rather than racing it).
    if (cls === 'brilliant') audio.play('brilliant');
    else if (cls === 'blunder') audio.play('blunder');
  }, [shellRef]);

  // Sprint 3.2.1 — sparkle positions for the brilliant overlay.
  // Regenerated whenever flashEffect transitions to 'brilliant' so each
  // !! gets fresh randomised positions. Empty list otherwise.
  const sparklePositions = useMemo(() => {
    if (flashEffect !== 'brilliant') return [] as Array<{ x: number; y: number; delay: number; rot: number }>;
    return Array.from({ length: 6 }, () => ({
      // eslint-disable-next-line react-hooks/purity -- each brilliant flash gets fresh sparkle positions on purpose; the memo is keyed on the flash
      x: 15 + Math.random() * 70,
      // eslint-disable-next-line react-hooks/purity -- each brilliant flash gets fresh sparkle positions on purpose; the memo is keyed on the flash
      y: 15 + Math.random() * 70,
      // eslint-disable-next-line react-hooks/purity -- each brilliant flash gets fresh sparkle positions on purpose; the memo is keyed on the flash
      delay: Math.floor(Math.random() * 200),
      // eslint-disable-next-line react-hooks/purity -- each brilliant flash gets fresh sparkle positions on purpose; the memo is keyed on the flash
      rot: Math.floor(Math.random() * 360),
    }));
  }, [flashEffect]);

  // Apply per-move visual side-effects, but only if no newer move has been
  // played since the analysis was queued. With the Worker-backed classifier
  // a response can land seconds after a subsequent move; we don't want a
  // stale flash for an old move firing while the bar should reflect a newer one.
  const applyClassifyVisuals = useCallback(
    (moveIdx: number, analysis: MoveAnalysis, moveTo: SquareId | undefined) => {
      if (logLengthRef.current !== moveIdx + 1) return;
      pushSearchEval(analysis);
      triggerFlash(analysis.classification);
      if (
        moveTo &&
        (analysis.classification === 'blunder' || analysis.classification === 'brilliant')
      ) {
        flagClassifiedSquare(moveTo, analysis.classification);
      }
      // Sprint 2.7 — additive sacrifice highlight; runs alongside the
      // brilliant pulse on the same tile when the analysis flagged the
      // move as a real sacrifice. 2.5s matches the brilliant pulse.
      if (
        moveTo &&
        analysis.classification === 'brilliant' &&
        analysis.isSacrifice
      ) {
        if (sacrificeTimerRef.current) clearTimeout(sacrificeTimerRef.current);
        setSacrificeSquare(moveTo);
        sacrificeTimerRef.current = setTimeout(() => {
          setSacrificeSquare(null);
          sacrificeTimerRef.current = null;
        }, 2500);
      }
    },
    [
      pushSearchEval,
      triggerFlash,
      flagClassifiedSquare,
      logLengthRef,
      sacrificeTimerRef,
      setSacrificeSquare,
    ],
  );

  /** V1 (DEF-6) — record a finished classification and play its visuals.
   *  A superseded result (its batch was cancelled when a Game Review
   *  started) carries placeholder numbers: writing them would snap the
   *  eval bar to 0.00 and log the move as plain "good", so it is dropped. */
  const commitAnalysis = useCallback(
    (moveIdx: number, analysis: MoveAnalysis, moveTo: SquareId | undefined) => {
      if (analysis.superseded) return;
      session.dispatch({ type: 'analysis', index: moveIdx, analysis });
      applyClassifyVisuals(moveIdx, analysis, moveTo);
    },
    [applyClassifyVisuals],
  );

  /**
   * Walks an imported log forward, classifying each move asynchronously.
   * Each step is its own setTimeout(0) so the UI stays responsive between
   * ~300 ms classifies. The captured log id ensures we don't patch a
   * different game if the user starts a new one mid-classify.
   */
  const classifyImportedLog = useCallback(
    (loadedLog: GameLog) => {
      const capturedId = loadedLog.id;
      // The caller has just put this log on the board; the ref would only
      // catch up after the next render, and the loop below checks it first.
      logIdRef.current = capturedId;
      const run = ++classifyRunRef.current;
      // Pre-compute all positions synchronously — cheap (no search) — so the
      // classifier can grab `stateBefore` for each move by index later.
      const states: BoardState[] = [loadedLog.initialState];
      for (const entry of loadedLog.moves) {
        const prev = states[states.length - 1];
        let next: BoardState;
        if (entry.move.kind === 'topologyToggle') {
          next = applyRotationMove(prev);
        } else if (entry.move.from && entry.move.to) {
          next = applyMove(prev, entry.move);
        } else {
          next = prev;
        }
        states.push(next);
      }
      // Only the last move's analysis feeds the bar — otherwise it would
      // pinball through 30 mid-game scores while the loading completes.
      let lastAnalysis: MoveAnalysis | null = null;
      // A catch-up run may classify only some moves; the bar still belongs to
      // the position after the last one.
      let lastRealIndex = -1;
      loadedLog.moves.forEach((entry, i) => {
        if (entry.move.kind !== 'topologyToggle' && entry.move.from && entry.move.to) lastRealIndex = i;
      });
      (async () => {
        for (let i = 0; i < loadedLog.moves.length; i++) {
          const entry = loadedLog.moves[i];
          if (entry.move.kind === 'topologyToggle' || !entry.move.from || !entry.move.to) {
            continue;
          }
          // Already classified (a catch-up run after a Game Review).
          if (entry.analysis && !entry.analysis.superseded) continue;
          // F7 — a request dropped by a newer batch (Game Review starting
          // on the same worker cancels whatever is queued or running) is
          // asked again, not skipped: the move it was for would otherwise
          // never get a classification. The game on the board being
          // replaced ends the loop; a few tries bound a busy worker.
          let a: MoveAnalysis | null = null;
          for (let attempt = 0; attempt < 5; attempt++) {
            if (logIdRef.current !== capturedId || classifyRunRef.current !== run) return;
            const r = await classifyAsync(states[i], entry.move, states[i + 1], {
              budgetMs: scaleBudgetMs(1000),
              maxDepth: 7,
              allowSelfCheck: loadedLog.gameMode === 'roulette',
            });
            if (!r.superseded) {
              a = r;
              break;
            }
          }
          // DEF-6: dropped by a newer batch, five times. The catch-up run
          // when a Game Review closes picks it up again.
          if (!a) continue;
          session.dispatch({ type: 'analysis', index: i, analysis: a, logId: capturedId });
          if (i === lastRealIndex) lastAnalysis = a;
        }
        if (lastAnalysis && classifyRunRef.current === run) pushSearchEval(lastAnalysis);
      })();
    },
    [pushSearchEval, classifyRunRef, logIdRef],
  );
  return { flashEffect, sparklePositions, commitAnalysis, classifyImportedLog };
}
