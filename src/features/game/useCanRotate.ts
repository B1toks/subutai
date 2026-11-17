import { useMemo } from 'react';
import { toggleTopology } from '../../engine/auxetic';
import { findKing, isSquareAttacked } from '../../engine/moves';
import type { WatchingGame } from '../review/watching';
import { useSession } from '../../session/useSession';
import { modeOf, boardOf, allowedPieceTypesOf, rouletteActionsLeftOf } from './boardView';

interface UseCanRotateArgs {
  isMultiplayer: boolean;
  watchingGame: WatchingGame | null;
  currentPlayer: 'human' | 'ai';
}

/**
 * Whether the player may rotate the board now: their turn, not right after
 * a rotation, and in classic only if it leaves their king safe; in roulette
 * it costs an action of a live spin. computeHint in App reads it on click.
 */
export function useCanRotate({
  isMultiplayer,
  watchingGame,
  currentPlayer,
}: UseCanRotateArgs) {
  const gameMode = useSession(modeOf(isMultiplayer));
  const state = useSession(boardOf(isMultiplayer));
  const allowedPieceTypes = useSession(allowedPieceTypesOf(isMultiplayer));
  const rouletteActionsLeft = useSession(rouletteActionsLeftOf(isMultiplayer));
  const canRotate = useMemo(() => {
    // V1 — a replay is a recording, not a game: nothing on the board may be
    // acted on while watching (the rotate button used to stay live and the
    // roulette Spin button leaked in from the mode the viewer left).
    if (watchingGame) return false;
    if (currentPlayer !== 'human') return false;
    if (state.lastMoveWasRotation) return false; // back-to-back guard

    if (gameMode === 'roulette') {
      // Rotation costs 1 action point — needs an active spin AND >= 1 action.
      // King-safety check is intentionally bypassed (kill-the-king rules).
      return allowedPieceTypes !== null && rouletteActionsLeft >= 1;
    }

    // Classic: standard king-safety self-check.
    const toggled = toggleTopology(state);
    const king = findKing(toggled, state.sideToMove);
    if (!king) return false;
    const opp = state.sideToMove === 'white' ? 'black' : 'white';
    return !isSquareAttacked(toggled, king, opp as 'white' | 'black', toggled.topologyState);
  }, [currentPlayer, state, gameMode, allowedPieceTypes, rouletteActionsLeft, watchingGame]);
  return { canRotate };
}
