import { useMemo, useRef, useEffect, type Dispatch, type SetStateAction } from 'react';
import { checkMarks, threatCounts, supportPairsFor } from './boardMarks';
import { audio } from '../../audio/AudioController';
import type { SquareId, Color, TopologyState } from '../../engine';
import { getAttackerSquares } from '../../engine/moves';
import type { WatchingGame } from '../review/watching';
import { useSession } from '../../session/useSession';
import { boardOf, legalMovesOf } from './boardView';

interface UseBoardMarksArgs {
  isMultiplayer: boolean;
  watchingGame: WatchingGame | null;
  selected: string | null;
  previewTopology: TopologyState | null;
  showThreats: boolean;
  showSupport: boolean;
  previewLocked: boolean;
  lockedPreviewTopology: TopologyState | null;
  hoveredSquare: string | null;
  registerFx: () => number;
  setCheckVignette: Dispatch<SetStateAction<boolean>>;
}

/**
 * What the board marks for the selected piece and the position: move
 * targets and en-passant targets, the king in check (with the red
 * vignette when a real check lands), the topology on show (committed,
 * previewed or locked), and the coaching overlays for threats and
 * support. Also plays the pick-up sound when a piece is selected.
 */
export function useBoardMarks({
  isMultiplayer,
  watchingGame,
  selected,
  previewTopology,
  showThreats,
  showSupport,
  previewLocked,
  lockedPreviewTopology,
  hoveredSquare,
  registerFx,
  setCheckVignette,
}: UseBoardMarksArgs) {
  const state = useSession(boardOf(isMultiplayer));
  const legalMoves = useSession(legalMovesOf(isMultiplayer));
  const highlightedTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    const targets = new Set<string>();
    for (const move of legalMoves) {
      if (move.from !== selected) continue;
      if (move.to) targets.add(move.to);
      // Chess960: clicking the own rook also triggers castling, so the rook
      // square is a valid interaction target for a selected king.
      if (move.kind === 'castle' && move.castleRookFrom) {
        targets.add(move.castleRookFrom);
      }
    }
    return targets;
  }, [legalMoves, selected]);


  // Stage T1: en-passant target squares get a distinct pulse so the player
  // notices the rare opportunity. Disjoint from the regular green dots.
  const enPassantTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    const ep = new Set<string>();
    for (const move of legalMoves) {
      if (move.from !== selected) continue;
      if (move.kind === 'enPassant' && move.to) ep.add(move.to);
    }
    return ep;
  }, [legalMoves, selected]);

  const checkSquares = useMemo(() => checkMarks(state, previewTopology), [previewTopology, state]);

  // R17b — pulse the red vignette when a REAL check lands: only on the
  // null→checked transition, and never for the rotation-preview's
  // hypothetical checks (checkSquares computes those too).
  const prevCheckKingRef = useRef<string | null>(null);
  useEffect(() => {
    const king = previewTopology ? null : checkSquares.king;
    const was = prevCheckKingRef.current;
    prevCheckKingRef.current = king;
    if (!king || was) return;
    registerFx();
    setCheckVignette(true);
    const t = setTimeout(() => setCheckVignette(false), 900);
    return () => clearTimeout(t);
  }, [checkSquares.king, previewTopology, registerFx, setCheckVignette]);

  // Motion scaffold — soft tactile sound the instant a piece is picked up.
  // Central effect (not scattered at every setSelected call site) so it
  // fires exactly once per null -> square transition, same shape as the
  // check-vignette effect above. Skipped while replaying/watching a game —
  // the viewer isn't the one touching pieces.
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const was = prevSelectedRef.current;
    prevSelectedRef.current = selected;
    if (!selected || was || watchingGame) return;
    audio.play('pieceTouch');
  }, [selected, watchingGame]);

  const displayTopology =
    previewLocked && lockedPreviewTopology
      ? lockedPreviewTopology
      : (previewTopology ?? state.topologyState);

  const threatenedSquares = useMemo(() => {
    if (!showThreats) return new Map<string, number>();
    return threatCounts(state, displayTopology);
  }, [showThreats, state, displayTopology]);

  const supportPairs = useMemo((): [SquareId, SquareId][] => {
    if (!showSupport) return [];
    return supportPairsFor(state, displayTopology);
  }, [showSupport, state, displayTopology]);

  const threateningPieceSquares = useMemo(() => {
    if (!showThreats || !hoveredSquare || !threatenedSquares.has(hoveredSquare)) return new Set<string>();
    const opp: Color = state.sideToMove === 'white' ? 'black' : 'white';
    const attackers = getAttackerSquares(state, hoveredSquare as SquareId, opp, displayTopology);
    return new Set(attackers);
  }, [showThreats, hoveredSquare, threatenedSquares, state, displayTopology]);

  const hoverSupporters = useMemo((): SquareId[] => {
    if (!showSupport || !selected || !hoveredSquare) return [];
    return getAttackerSquares(state, hoveredSquare as SquareId, 'white', displayTopology);
  }, [showSupport, selected, hoveredSquare, state, displayTopology]);
  return {
    highlightedTargets,
    enPassantTargets,
    checkSquares,
    displayTopology,
    threatenedSquares,
    supportPairs,
    threateningPieceSquares,
    hoverSupporters,
  };
}
