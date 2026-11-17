import { useMemo, useEffect, useRef } from 'react';
import { findKing, isSquareAttacked } from '../../engine/moves';
import type { Color, SquareId } from '../../engine';
import { audio } from '../../audio/AudioController';
import type { WatchingGame } from '../review/watching';
import { useSession } from '../../session/useSession';
import { gameStatusOf, boardOf } from '../game/boardView';

interface UseAdaptiveMusicArgs {
  isMultiplayer: boolean;
  watchingGame: WatchingGame | null;
  currentEval: number;
  searchMateInPlies: number | null;
  myPerspectiveEval: number;
  sacrificeSquare: SquareId | null;
}

/**
 * The adaptive music: tells the audio controller how tense the position
 * is (eval, check, forced mate) and whose favour it is in, and plays the
 * danger and sacrifice stingers. Everything is a no-op while music is off.
 */
export function useAdaptiveMusic({
  isMultiplayer,
  watchingGame,
  currentEval,
  searchMateInPlies,
  myPerspectiveEval,
  sacrificeSquare,
}: UseAdaptiveMusicArgs) {
  const gameStatus = useSession(gameStatusOf);
  const state = useSession(boardOf(isMultiplayer));
  // ─── M.5: adaptive music ──────────────────────────────────────────
  // The ambient drone "нагнітає" with the position: a 0..1 tension scale
  // derived from the engine eval, forced-mate detection and check state
  // morphs a dissonant layer + heartbeat tremolo inside AmbientPlayer.
  // All calls are no-ops while music is off.
  const kingInDanger = useMemo(() => {
    if (gameStatus !== 'active') return false;
    const king = findKing(state, state.sideToMove);
    if (!king) return false;
    const opp: Color = state.sideToMove === 'white' ? 'black' : 'white';
    return isSquareAttacked(state, king, opp, state.topologyState);
  }, [state, gameStatus]);

  useEffect(() => {
    if (gameStatus !== 'active' || watchingGame) {
      audio.setMusicSituation(0, 0);
      return;
    }
    // |eval| 0 → calm, 700cp → 0.55; check stacks +0.3; forced mate pins
    // the needle. tanh-free linear is fine — AmbientPlayer squares it.
    let t = Math.min(1, Math.abs(currentEval) / 700) * 0.55;
    if (kingInDanger) t += 0.3;
    if (searchMateInPlies !== null) t = 1;
    // M.5.3 — the my-perspective advantage lets the adaptive style pick
    // warm (neutral) / dark (losing) / victory (winning).
    audio.setMusicSituation(Math.min(1, t), myPerspectiveEval);
  }, [currentEval, myPerspectiveEval, searchMateInPlies, kingInDanger, gameStatus, watchingGame]);

  // Danger stinger on the not-in-check → in-check edge only.
  const prevKingDangerRef = useRef(false);
  useEffect(() => {
    if (kingInDanger && !prevKingDangerRef.current && gameStatus === 'active' && !watchingGame) {
      audio.playMusicStinger('danger');
    }
    prevKingDangerRef.current = kingInDanger;
  }, [kingInDanger, gameStatus, watchingGame]);

  // Sacrifice stinger piggybacks on the classifier's sacrifice highlight.
  useEffect(() => {
    if (sacrificeSquare && gameStatus === 'active' && !watchingGame) {
      audio.playMusicStinger('sacrifice');
    }
  }, [sacrificeSquare, gameStatus, watchingGame]);
}
