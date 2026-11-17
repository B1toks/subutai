import { useRef, useState } from 'react';
import type { SquareId, TopologyState } from '../../engine';
import { localData, LOCAL_KEYS } from '../../infra/localData';
import type { AnnotationColor, ArrowAnnotation } from './annotations';

/**
 * The board's own UI state, as App declared it: the selected square, the
 * rotation preview and its lock, the hovered square, the coaching tools
 * (support and threat maps, their master switch, the engine hint), the
 * Beat Mode hold, the right-click annotations, an online promotion being
 * picked, the formation lock and the 960 code editor, and the Load replay
 * dialog. State only, no effects: the two that follow it (the hint reset
 * on a new position, the code editor's focus) stay in App where they
 * stood. App passes the whole object to the hooks and components that
 * read or set several of these.
 */
export function useBoardUi() {
  const [selected, setSelected] = useState<string | null>(null);
  const [previewTopology, setPreviewTopology] = useState<TopologyState | null>(null);
  // Sprint 3.7 (rev 2) — Threat / Support toggles restored after the
  // 3.6 hover-insight experiment didn't stick. Manual toggles read
  // more like deliberate training aids than a hover gimmick.
  const [showThreats, setShowThreats] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  // S2.4 — master switch for the coaching tools (support / threat / hint).
  // Players who want "pure" chess can collapse the whole group; persisted
  // so the choice survives reloads.
  const [helpToolsEnabled, setHelpToolsEnabled] = useState<boolean>(() => {
    try {
      return localData.get(LOCAL_KEYS.helpTools) !== '0';
    } catch {
      return true;
    }
  });
  // S2.4 — engine hint: best move for the current position, shown as a
  // pulsing from→to pair on the board. Cleared whenever the position
  // changes. `rotate: true` means the engine recommends Rotate itself.
  const [hintMove, setHintMove] = useState<
    { from: SquareId; to: SquareId } | { rotate: true } | null
  >(null);
  const [previewLocked, setPreviewLocked] = useState(false);
  const [lockedPreviewTopology, setLockedPreviewTopology] = useState<TopologyState | null>(null);
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null);
  const [formationLocked, setFormationLocked] = useState(false);
  const [lockedFormationKey, setLockedFormationKey] = useState<string | null>(null);
  const [formationInputMode, setFormationInputMode] = useState(false);
  const [formationInputValue, setFormationInputValue] = useState('');
  const [showReplayDialog, setShowReplayDialog] = useState(false);
  const [replayText, setReplayText] = useState('');
  const [replayError, setReplayError] = useState<string | null>(null);
  // Online the picker belongs to the match, not to the solo session.
  const [mpPendingPromotion, setMpPendingPromotion] = useState<{
    from: SquareId;
    to: SquareId;
  } | null>(null);
  const formationInputRef = useRef<HTMLInputElement>(null);
  // SP-3 — true while a Beat-Mode move is queued to land on the next
  // beat; blocks board input so the snap can't be raced.
  const beatSnapPendingRef = useRef(false);
  // M.12 — the queued snap target (from/to + ms to the beat) so the UI
  // can show a ring filling to the beat for a crisp, on-beat landing.
  const [beatSnap, setBeatSnap] = useState<{ from: SquareId; to: SquareId; ms: number } | null>(null);
  // Sprint 3.6 — right-click annotations (chess.com / lichess style).
  // Right-click a square to highlight it (cycles colour by modifier:
  // none=green, shift=red, alt=yellow, ctrl/meta=blue). Right-drag
  // from one square to another draws an arrow in the same colour
  // scheme. Repeat the same gesture with the same colour to clear.
  // All annotations clear automatically when a move is played — they
  // are a per-position scratch pad, not a persistent layer.
  const [squareAnnotations, setSquareAnnotations] = useState<Map<SquareId, AnnotationColor>>(
    () => new Map(),
  );
  const [arrowAnnotations, setArrowAnnotations] = useState<ArrowAnnotation[]>([]);
  const annotationStartRef = useRef<SquareId | null>(null);

  return {
    selected, setSelected,
    previewTopology, setPreviewTopology,
    showThreats, setShowThreats,
    showSupport, setShowSupport,
    helpToolsEnabled, setHelpToolsEnabled,
    hintMove, setHintMove,
    previewLocked, setPreviewLocked,
    lockedPreviewTopology, setLockedPreviewTopology,
    hoveredSquare, setHoveredSquare,
    formationLocked, setFormationLocked,
    lockedFormationKey, setLockedFormationKey,
    formationInputMode, setFormationInputMode,
    formationInputValue, setFormationInputValue,
    showReplayDialog, setShowReplayDialog,
    replayText, setReplayText,
    replayError, setReplayError,
    mpPendingPromotion, setMpPendingPromotion,
    formationInputRef,
    beatSnapPendingRef,
    beatSnap, setBeatSnap,
    squareAnnotations, setSquareAnnotations,
    arrowAnnotations, setArrowAnnotations,
    annotationStartRef,
  };
}

/** The board's own UI state (useBoardUi), as the hooks and components that take it whole see it. */
export type BoardUi = ReturnType<typeof useBoardUi>;
