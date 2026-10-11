import { useEffect, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { moveVoting, type VoteMode } from '../../twitch/moveVoting';
import { rotateIsLegal } from '../../memory/replayImport';
import { computeSAN, appendMove, type GameLog } from '../../recording/log';
import { applyMove } from '../../engine/moves';
import { beatBridge } from '../../music/beatBridge';
import { bumpEvalForMove } from '../game/position';
import { classifyAsync } from '../../analysis/classifyClient';
import { scaleBudgetMs } from '../../utils/deviceTier';
import type { WatchingGame } from '../review/watching';
import type { BoardState, Move, SquareId } from '../../engine';
import type { GameStatus, GameMode } from '../../shared/game';
import type { MoveAnalysis } from '../../analysis/classify';

interface UseChatVsBotArgs {
  isAutoMode: boolean;
  isMultiplayer: boolean;
  watchingGame: WatchingGame | null;
  setState: Dispatch<SetStateAction<BoardState>>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setLegalMoves: Dispatch<SetStateAction<Move[]>>;
  setLog: Dispatch<SetStateAction<GameLog>>;
  gameStatus: GameStatus;
  setLastMove: Dispatch<SetStateAction<{ from?: SquareId; to?: SquareId } | null>>;
  twitchVoteMode: VoteMode;
  gameMode: GameMode;
  getLegalMoves: (s: BoardState) => Move[];
  state: BoardState;
  legalMoves: Move[];
  setSearchEvalFromWhite: Dispatch<SetStateAction<number | null>>;
  setSearchMateInPlies: Dispatch<SetStateAction<number | null>>;
  logLengthRef: RefObject<number>;
  commitAnalysis: (moveIdx: number, analysis: MoveAnalysis, moveTo: SquareId | undefined) => void;
  checkGameOver: (nextState: BoardState, lastMoveWasRotation?: boolean) => void;
  handleRotate: () => void;
  isLocalMode: boolean;
  currentPlayer: 'ai' | 'human';
}

/**
 * Chat vs bot: on the player's turn in a classic solo game, Twitch chat
 * votes a move and the winning move is played through the same path as
 * a click. A move the streamer makes first cancels the round.
 */
export function useChatVsBot({
  isAutoMode,
  isMultiplayer,
  watchingGame,
  setState,
  setSelected,
  setLegalMoves,
  setLog,
  gameStatus,
  setLastMove,
  twitchVoteMode,
  gameMode,
  getLegalMoves,
  state,
  legalMoves,
  setSearchEvalFromWhite,
  setSearchMateInPlies,
  logLengthRef,
  commitAnalysis,
  checkGameOver,
  handleRotate,
  isLocalMode,
  currentPlayer,
}: UseChatVsBotArgs) {
  // T6 — "chat vs bot": chat plays the human (white) side by majority.
  // Mirrors the AI vote gate but on the HUMAN turn: open a free-form
  // round (chat types SAN / coordinates), then commit the elected move
  // through the same classic-mode path a click would take. The cleanup
  // cancels the round whenever the position changes under it — which is
  // exactly what happens when the streamer overrides by moving manually.
  useEffect(() => {
    if (twitchVoteMode !== 'chatvsbot') return;
    if (isMultiplayer || isLocalMode || isAutoMode || watchingGame) return;
    if (gameMode !== 'classic' || gameStatus !== 'active') return;
    if (currentPlayer !== 'human') return;
    let stale = false;
    void moveVoting.gateHumanMove(state, legalMoves, rotateIsLegal(state)).then((move) => {
      if (stale || !move) return;
      // R10 — chat elected to rotate the board as its move. handleRotate
      // re-checks legality itself; the round only offered "rotate" while
      // it was legal, and this effect re-fires on any position change.
      if (move.kind === 'topologyToggle') {
        handleRotate();
        return;
      }
      if (!move.from || !move.to) return;
      const san = computeSAN(state, move);
      const afterMove = applyMove(state, move);
      setLog((prev) => appendMove(prev, move, san, state.topologyState));
      setLastMove({ from: move.from, to: move.to });
      beatBridge.reportMove();
      setSearchEvalFromWhite((prev) => bumpEvalForMove(prev, state, move));
      setSearchMateInPlies(null);
      const moveIdx = logLengthRef.current;
      void classifyAsync(state, move, afterMove, {
        budgetMs: scaleBudgetMs(1000),
        maxDepth: 7,
        allowSelfCheck: false,
      }).then((analysis) => {
        commitAnalysis(moveIdx, analysis, move.to);
      });
      setState(afterMove);
      setLegalMoves(getLegalMoves(afterMove));
      setSelected(null);
      checkGameOver(afterMove);
    });
    return () => {
      stale = true;
      moveVoting.cancelRound();
    };
  // Commit helpers close over this render's state; the effect re-fires on
  // any position change, so the captures stay fresh (same contract as the
  // AI scheduler above).
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
