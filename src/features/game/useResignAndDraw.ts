import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { GameOutcome } from '../../analysis/points';
import type { MultiplayerSyncHandle } from '../../components/MultiplayerGameView';
import type { useToast } from '../../components/Toast';
import type { BoardState, Color } from '../../engine';
import type { GameLog } from '../../recording/log';
import { session } from '../../session/session';
import { drawTableOf } from '../../session/step';
import type { SessionState } from '../../session/types';
import { HUMAN_COLOR, type GameStatus } from '../../shared/game';
import { canAnswerDraw, canOfferDraw, type DrawTable } from '../../utils/drawOffer';
import type { WatchingGame } from '../review/watching';

interface UseResignAndDrawArgs {
  isMultiplayer: boolean;
  mpSync: MultiplayerSyncHandle | null;
  isLocalMode: boolean;
  watchingGame: WatchingGame | null;
  /** QA-11 — solo only: the bot's move is in flight (App). */
  botThinking: boolean;
  gameStatus: GameStatus;
  /** The session as App rendered it (its draw table), and the game on the board. */
  sess: SessionState;
  state: BoardState;
  log: GameLog;
  /** Resign asked for, by this side, waiting for its confirm (App state). */
  confirmingResign: Color | null;
  setConfirmingResign: Dispatch<SetStateAction<Color | null>>;
  setGameOutcome: Dispatch<SetStateAction<GameOutcome | null>>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  /** The end of a solo game (App): its points, the summary, the save. */
  finishGame: (outcome: GameOutcome) => Promise<void>;
  toast: ReturnType<typeof useToast>;
  beatSnapPendingRef: RefObject<boolean>;
  completedLogIdRef: RefObject<string | null>;
  /** The match this tab resigned (the end-of-match dialog's wording). */
  /** Marks the match this tab resigned (useOnlineMatch's state). */
  setMpSelfResigned: Dispatch<SetStateAction<string | null>>;
}

/**
 * Resigning (QA-11: the seat whose Resign was pressed; solo, hot-seat or
 * online, after a confirm) and the hot-seat draw offers (each seat offers
 * and answers in its own row). Plain handlers, no React hooks inside: what
 * they read is passed in from App's render, as their closures read it, so
 * the call's position changes no effect order.
 */
export function useResignAndDraw({
  isMultiplayer,
  mpSync,
  isLocalMode,
  watchingGame,
  botThinking,
  gameStatus,
  sess,
  state,
  log,
  confirmingResign,
  setConfirmingResign,
  setGameOutcome,
  setSelected,
  finishGame,
  toast,
  beatSnapPendingRef,
  completedLogIdRef,
  setMpSelfResigned,
}: UseResignAndDrawArgs) {
  /** QA-11 — `side` is the seat whose Resign was pressed (hot-seat has
   *  one per player). Solo it is always the human; online the match knows. */
  function requestResign(side?: Color) {
    if (watchingGame) return;
    if (isMultiplayer) {
      if (!mpSync || mpSync.matchState.status !== 'active') return;
      setConfirmingResign(mpSync.myColor);
      return;
    }
    if (gameStatus !== 'active') return;
    if (log.moves.length === 0) return;
    // Solo, the bot's move is in flight: resigning now would race it (the
    // move still landed afterwards). The button is disabled meanwhile.
    if (botThinking) return;
    setConfirmingResign(isLocalMode ? side ?? state.sideToMove : HUMAN_COLOR);
  }

  function confirmResign() {
    const side = confirmingResign;
    setConfirmingResign(null);
    // PvP resign: route through the match doc so the opponent sees the
    // status flip; their listener will mirror the outcome. Local engine
    // state stays untouched (gameStatus etc.).
    if (isMultiplayer) {
      if (!mpSync) return;
      // Remembered only if this resignation is what ended the match: a
      // failed write, or a flag fall that landed first, is not one.
      const code = mpSync.matchState.code;
      setMpSelfResigned(code);
      void mpSync.resign().then((wrote) => {
        if (!wrote) setMpSelfResigned((cur) => (cur === code ? null : cur));
      });
      return;
    }
    if (!side || gameStatus !== 'active' || botThinking) return;
    // Stamped before the status flips, so the completion effect skips it.
    completedLogIdRef.current = log.id;
    session.dispatch({ type: 'resign', side });
    // R13/BUG-5 — hot-seat resign: either seat may press it, so a solo
    // "human-resign" record would blame the wrong player half the time.
    // Just end the game; the banner is the ending, nothing is saved.
    if (isLocalMode) return;
    setGameOutcome('human-resign');
    void finishGame('human-resign');
  }

  /** Hot-seat: the draw offers of the game on the board. */
  function localDrawTable(): DrawTable<Color> {
    return drawTableOf(sess);
  }

  /** Hot-seat: `side` offers a draw; the other seat sees it on its side. */
  function offerLocalDraw(side: Color) {
    if (!isLocalMode || gameStatus !== 'active') return;
    const table = localDrawTable();
    if (!canOfferDraw(table, side, log.moves.length)) return;
    // The move landing on the beat would retire the offer at once and
    // leave `side` waiting for its own next move.
    if (beatSnapPendingRef.current) {
      toast.show('A move is landing on the beat. Offer the draw once it has.', 'info', 2400);
      return;
    }
    session.dispatch({ type: 'offerDraw', side });
  }

  /** Hot-seat: `side` answers the offer standing against it. */
  function answerLocalDraw(side: Color, accept: boolean) {
    if (!isLocalMode || gameStatus !== 'active') return;
    const table = localDrawTable();
    if (!canAnswerDraw(table.offer, side, log.moves.length)) return;
    // A move already on its way to the beat (music sync) lands first, and
    // a move retires the offer: there is nothing left to answer.
    if (beatSnapPendingRef.current) {
      toast.show('A move is landing on the beat. It takes the offer off the table.', 'info', 2400);
      return;
    }
    if (!accept) {
      session.dispatch({ type: 'answerDraw', side, accept: false });
      toast.show(`${side === 'white' ? 'White' : 'Black'} declined the draw.`, 'info', 2400);
      return;
    }
    // Stamped before the status flips, like a resignation (nothing saves).
    completedLogIdRef.current = log.id;
    setSelected(null);
    session.dispatch({ type: 'answerDraw', side, accept: true });
  }

  return { requestResign, confirmResign, localDrawTable, offerLocalDraw, answerLocalDraw };
}
