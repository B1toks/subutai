import { useEffect } from 'react';
import { moveVoting, type VoteMode } from '../../twitch/moveVoting';
import { rotateIsLegal } from '../../memory/replayImport';
import type { WatchingGame } from '../review/watching';
import type { GameStatus, GameMode } from '../../shared/game';
import type { BoardState, Move } from '../../engine';

interface UseGuessTheStreamerArgs {
  isAutoMode: boolean;
  isMultiplayer: boolean;
  watchingGame: WatchingGame | null;
  gameStatus: GameStatus;
  twitchVoteMode: VoteMode;
  gameMode: GameMode;
  state: BoardState;
  legalMoves: Move[];
  isLocalMode: boolean;
  currentPlayer: 'ai' | 'human';
}

/**
 * Guess the streamer: on the player's turn chat guesses the move they will
 * make; the round is resolved by the player's own move, and cancelled if
 * the position changes any other way.
 */
export function useGuessTheStreamer({
  isAutoMode,
  isMultiplayer,
  watchingGame,
  gameStatus,
  twitchVoteMode,
  gameMode,
  state,
  legalMoves,
  isLocalMode,
  currentPlayer,
}: UseGuessTheStreamerArgs) {
  // R2 — "guess the streamer": while it's the human's turn, an open-ended
  // free-form round collects chat's guesses. Nothing awaits it — the
  // resolution happens inside the human commit paths (resolveGuessRound),
  // and the cleanup cancels a still-unrevealed round when the position
  // changes some other way (undo, reset, mode flip). A revealed round is
  // left alone; its banner clears itself.
  useEffect(() => {
    if (twitchVoteMode !== 'guess') return;
    if (isMultiplayer || isLocalMode || isAutoMode || watchingGame) return;
    if (gameMode !== 'classic' || gameStatus !== 'active') return;
    if (currentPlayer !== 'human') return;
    moveVoting.openGuessRound(state, legalMoves, rotateIsLegal(state));
    return () => moveVoting.cancelRound();
  }, [
    twitchVoteMode,
    isMultiplayer,
    isLocalMode,
    isAutoMode,
    watchingGame,
    gameMode,
    gameStatus,
    currentPlayer,
    state,
    legalMoves,
  ]);
}
