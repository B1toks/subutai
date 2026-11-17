import type { Dispatch, SetStateAction } from 'react';
import type { MultiplayerSyncHandle } from '../../components/MultiplayerGameView';
import type { TopologyState } from '../../engine';
import { toggleTopology } from '../../engine/auxetic';
import { findKing, isSquareAttacked } from '../../engine/moves';
import { turns } from '../../session/session';
import type { WatchingGame } from '../review/watching';
import { backRankString } from './position';
import { useSession } from '../../session/useSession';
import { gameStatusOf, modeOf, boardOf, rouletteRevealOf } from './boardView';

interface UseRotateArgs {
  isMultiplayer: boolean;
  mpSync: MultiplayerSyncHandle | null;
  watchingGame: WatchingGame | null;
  /** Whose turn from this seat (App). */
  currentPlayer: 'human' | 'ai';
  setSelected: Dispatch<SetStateAction<string | null>>;
  setPreviewTopology: Dispatch<SetStateAction<TopologyState | null>>;
  /** The formation lock (App state). */
  setFormationLocked: Dispatch<SetStateAction<boolean>>;
  setLockedFormationKey: Dispatch<SetStateAction<string | null>>;
  /** The first-game "Try rotating" bubble (useRotateHint). */
  rotateHintShown: boolean;
  dismissRotateHint: () => void;
  /** R10 — the streamer's rotation settles chat's guess round (useTwitchState). */
  settleGuessRotate: () => void;
}

/**
 * Two buttons of the board's action row: locking the formation (the next
 * game keeps this 960 start) and Rotate (the rotation is the session's:
 * step.ts checks it; online it goes to the match). Plain handlers: the only React hook inside is useSession (the
 * game on the board, read in this render, as App's aliases are), with no
 * effect of its own; the rest of what they read is passed in from App's
 * render, so the call's position changes no effect order.
 */
export function useRotate({
  isMultiplayer,
  mpSync,
  watchingGame,
  currentPlayer,
  setSelected,
  setPreviewTopology,
  setFormationLocked,
  setLockedFormationKey,
  rotateHintShown,
  dismissRotateHint,
  settleGuessRotate,
}: UseRotateArgs) {
  const gameStatus = useSession(gameStatusOf);
  const gameMode = useSession(modeOf(isMultiplayer));
  const state = useSession(boardOf(isMultiplayer));
  const initialState = useSession((s) => s.initial);
  const rouletteReveal = useSession(rouletteRevealOf(isMultiplayer));
  function toggleFormationLock() {
    setFormationLocked((v) => {
      if (!v) setLockedFormationKey(backRankString(initialState));
      else setLockedFormationKey(null);
      return !v;
    });
  }

  function handleRotate() {
    if (watchingGame) return;
    if (currentPlayer !== 'human') return;
    if (state.lastMoveWasRotation) return;
    // Sprint 4.1 — first actual rotation dismisses the hint for good.
    if (!rotateHintShown) dismissRotateHint();

    // Multiplayer: send a topologyToggle move through Firestore — the
    // opponent's listener re-derives the board (rebuildBoardFromMatch
    // skips toggle entries today; T1 unblocks them once Q.B.2 picks them
    // up via the same applyRotationMove path). King-safety check first
    // so we don't push an illegal rotation across the wire.
    if (isMultiplayer && mpSync) {
      if (mpSync.matchState.status !== 'active') return;
      if (!mpSync.isMyTurn) return;
      if (rouletteReveal) return; // the bag is still landing
      const toggledMp = toggleTopology(state);
      const ourKingMp = findKing(toggledMp, state.sideToMove);
      if (!ourKingMp) return;
      const oppMp = state.sideToMove === 'white' ? 'black' : 'white';
      if (
        isSquareAttacked(
          toggledMp,
          ourKingMp,
          oppMp as 'white' | 'black',
          toggledMp.topologyState,
        )
      ) {
        return;
      }
      // Q.D.3: in MP roulette rotate burns an action without consuming a
      // slot — handled by sendRotate. In classic MP rotate is a whole
      // turn — also routes through sendRotate which delegates to sendMove.
      void mpSync.sendRotate();
      setPreviewTopology(null);
      setSelected(null);
      return;
    }

    if (gameStatus !== 'active') return;
    // Classic: the king must stay safe and the rotation is the whole turn.
    // Roulette: it costs one action of the spun bag and spends no slot.
    // The rules are step()'s (src/session/step.ts rotate).
    const events = turns.act({ type: 'rotate', actor: 'human', now: Date.now() });
    if (events.length === 0) return;
    setSelected(null);
    setPreviewTopology(null);
    // R10 — the streamer rotated: settle the chat's guess round.
    if (gameMode !== 'roulette') settleGuessRotate();
  }

  return { toggleFormationLock, handleRotate };
}
