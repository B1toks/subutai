import { useEffect } from 'react';
import type { MultiplayerSyncHandle } from '../online/useMultiplayerSync';
import type { WatchingGame } from '../review/watching';
import { useSession } from '../../session/useSession';
import { gameStatusOf, modeOf, isRouletteSpinningOf, allowedPieceTypesOf, firstRouletteSpinDoneOf } from './boardView';

interface UseRouletteAutoSpinArgs {
  isMultiplayer: boolean;
  mpSync: MultiplayerSyncHandle | null;
  watchingGame: WatchingGame | null;
  doSpinRouletteNow: () => void;
  currentPlayer: 'human' | 'ai';
}

/**
 * Roulette spins the player's bag by itself, half a second into their
 * turn, once they have spun by hand once this game: solo through
 * doSpinRouletteNow, online through the match's spinRoulette.
 */
export function useRouletteAutoSpin({
  isMultiplayer,
  mpSync,
  watchingGame,
  doSpinRouletteNow,
  currentPlayer,
}: UseRouletteAutoSpinArgs) {
  const gameStatus = useSession(gameStatusOf);
  const gameMode = useSession(modeOf(isMultiplayer));
  const isRouletteSpinning = useSession(isRouletteSpinningOf(isMultiplayer));
  const allowedPieceTypes = useSession(allowedPieceTypesOf(isMultiplayer));
  const firstRouletteSpinDone = useSession(firstRouletteSpinDoneOf(isMultiplayer));
  // Auto-trigger the human's roulette spin after the first manual click of
  // the game. Conditions mirror the Spin Roulette button's enabled-state:
  // roulette mode, not currently spinning, human's turn, no roll active,
  // game still in progress, watcher not engaged. 500ms delay keeps the
  // turn boundary visible.
  useEffect(() => {
    if (isMultiplayer) return; // MP has its own auto-spin effect below
    if (gameMode !== 'roulette') return;
    if (!firstRouletteSpinDone) return;
    if (gameStatus !== 'active') return;
    if (watchingGame) return;
    if (currentPlayer !== 'human') return;
    if (allowedPieceTypes !== null) return;
    if (isRouletteSpinning) return;
    const t = setTimeout(() => {
      doSpinRouletteNow();
    }, 500);
    return () => clearTimeout(t);
    // doSpinRouletteNow re-allocates each render (captures the latest state
    // via closure) — listing it would re-fire the effect every render and
    // restart the 500ms timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gameMode,
    firstRouletteSpinDone,
    gameStatus,
    watchingGame,
    currentPlayer,
    allowedPieceTypes,
    isRouletteSpinning,
    isMultiplayer,
  ]);

  // Q.D.3: MP roulette auto-spin. Fires only when I need a fresh bag AND
  // I've already done at least one manual spin in this match. Pre-spin
  // means rouletteSlots===null. mid-turn (action 2) ALSO has slots set
  // — so the trigger condition is rouletteSlots===null while my turn is
  // active.
  useEffect(() => {
    if (!isMultiplayer || !mpSync) return;
    if (!mpSync.isRouletteMode) return;
    if (!mpSync.isMyTurn) return;
    if (mpSync.matchState.status !== 'active') return;
    if (mpSync.rouletteSlots !== null) return;
    if (mpSync.mySpinCount === 0) return; // first spin is manual
    const t = setTimeout(() => {
      void mpSync.spinRoulette();
    }, 500);
    return () => clearTimeout(t);
    // spinRoulette identity changes each render; same pattern as solo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isMultiplayer,
    mpSync?.isRouletteMode,
    mpSync?.isMyTurn,
    mpSync?.matchState.status,
    mpSync?.rouletteSlots,
    mpSync?.mySpinCount,
  ]);
}
