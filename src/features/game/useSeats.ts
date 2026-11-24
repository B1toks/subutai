import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { MoveAnalysis } from '../../analysis/classify';
import type { SquareId, TopologyState } from '../../engine';
import { applyMove } from '../../engine/moves';
import type { BotStrength } from '../../ai/agents';
import { classifyAsync } from '../../analysis/classifyClient';
import { scaleBudgetMs } from '../../utils/deviceTier';
import { streaming } from '../../integrations';
import type { VoteMode } from '../../integrations/twitch/moveVoting';
import { rotateIsLegal } from '../../memory/replayImport';
import { createChatPlayer, withGuess } from '../../session/players/chat';
import { bumpEvalForMove } from './position';
import { session, turns } from '../../session/session';
import { humanPlayers } from '../../session/players/human';
import { remotePlayers } from '../../session/players/remote';
import type { Color } from '../../engine';
import { createAutoPlayer, createBotPlayer } from '../../session/players/bot';
import type { Player, Seats } from '../../session/players/types';
import type { WatchingGame } from '../review/watching';

const autoSeats = (moved: () => void): Seats => ({
  white: createAutoPlayer({ color: 'white', dispatch: session.dispatch, moved }),
  black: createAutoPlayer({ color: 'black', dispatch: session.dispatch, moved }),
});

interface UseSeatsArgs {
  isMultiplayer: boolean;
  /** My colour in the online match on the board. */
  onlineColor: Color | null;
  watchingGame: WatchingGame | null;
  isAutoMode: boolean;
  autoStopped: boolean;
  isLocalMode: boolean;
  /** Twitch: chat plays white ('chatvsbot') or guesses its moves ('guess'). */
  twitchVoteMode: VoteMode;
  botLevelRef: RefObject<BotStrength>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setSearchEvalFromWhite: Dispatch<SetStateAction<number | null>>;
  setSearchMateInPlies: Dispatch<SetStateAction<number | null>>;
  setPreviewTopology: Dispatch<SetStateAction<TopologyState | null>>;
  commitAnalysis: (moveIdx: number, analysis: MoveAnalysis, moveTo: SquareId | undefined, logId: string) => void;
  autoLastMoveAtRef: RefObject<number>;
}

/**
 * Who plays each side of the session's game (src/session/players): in a
 * solo game the player here has white and the bot black; in hot-seat both
 * sides are here; a self-play run seats its bot on both. Twitch, in a solo
 * game: chat plays white with the player here ('chatvsbot'), or guesses
 * the player's moves ('guess'). In an online
 * match the opponent's side is the remote player's, and mine nobody's
 * here: both sides' moves arrive in the match document. Nobody is seated
 * while a replay is watched, or once a self-play run is stopped.
 */
export function useSeats({
  isMultiplayer,
  onlineColor,
  watchingGame,
  isAutoMode,
  autoStopped,
  isLocalMode,
  twitchVoteMode,
  botLevelRef,
  setSelected,
  setSearchEvalFromWhite,
  setSearchMateInPlies,
  setPreviewTopology,
  commitAnalysis,
  autoLastMoveAtRef,
}: UseSeatsArgs) {
  // The bots keep one identity for the page: a new one would lose the turn
  // it is thinking about. What they call reads the latest render's.
  const commitRef = useRef(commitAnalysis);
  useEffect(() => {
    commitRef.current = commitAnalysis;
  }, [commitAnalysis]);

  // Built once, on first use in the effect below.
  const playersRef = useRef<{ bot: Player; auto: Seats; chat: Player; guess: Player } | null>(null);

  useEffect(() => {
    playersRef.current ??= {
      bot: createBotPlayer({
        color: 'black',
        dispatch: session.dispatch,
        strength: () => botLevelRef.current,
        // Twitch Predict / chat vote; without the integrations, the bot's own move.
        vote: (board, legal, chosen) => streaming()?.moveVoting.gate(board, legal, chosen) ?? Promise.resolve(chosen),
        async analyse(before, move, after, index, logId) {
          // B3 — material-delta bump instead of static-fallback flicker.
          setSearchEvalFromWhite((prev) => bumpEvalForMove(prev, before, move));
          setSearchMateInPlies(null);
          // Worker-backed classify: ~1 s of background work for depth 7.
          const analysis = await classifyAsync(before, move, after, {
            budgetMs: scaleBudgetMs(1000),
            maxDepth: 7,
            allowSelfCheck: false,
          });
          commitRef.current(index, analysis, move.to, logId);
        },
        moved: () => setSelected(null),
      }),
      auto: autoSeats(() => {
        setSelected(null);
        autoLastMoveAtRef.current = Date.now();
      }),
      // T6 — "chat vs bot": chat plays the human (white) side by majority,
      // through the same classic path a click takes.
      chat: createChatPlayer({
        color: 'white',
        elect: (board, legal) =>
          streaming()?.moveVoting.gateHumanMove(board, legal, rotateIsLegal(board)) ?? Promise.resolve(null),
        cancel: () => streaming()?.moveVoting.cancelRound(),
        played(action, events, before, index) {
          if (action.type === 'rotate') {
            if (events.length === 0) return;
            setSelected(null);
            setPreviewTopology(null);
            return;
          }
          // A move the session refused (no events) sets nothing off.
          if (action.type !== 'move' || events.length === 0) return;
          const move = action.move;
          const afterMove = applyMove(before, move);
          const logId = session.getState().log.id;
          setSearchEvalFromWhite((prev) => bumpEvalForMove(prev, before, move));
          setSearchMateInPlies(null);
          void classifyAsync(before, move, afterMove, {
            budgetMs: scaleBudgetMs(1000),
            maxDepth: 7,
            allowSelfCheck: false,
          }).then(
            (analysis) => {
              commitRef.current(index, analysis, move.to, logId);
            },
            () => {}, // the classifier failed: the move goes without a verdict
          );
          setSelected(null);
        },
      }),
      // R2 — "guess the streamer": chat guesses the player's move.
      guess: withGuess(humanPlayers.white, {
        open: (board, legal) => streaming()?.moveVoting.openGuessRound(board, legal, rotateIsLegal(board)),
        cancel: () => streaming()?.moveVoting.cancelRound(),
      }),
    };
    const { bot, auto, chat, guess } = playersRef.current;
    if (isMultiplayer) {
      const theirs = onlineColor === 'white' ? 'black' : 'white';
      turns.seat({ white: null, black: null, [theirs]: remotePlayers[theirs] });
    } else if (watchingGame) turns.seat(null);
    else if (isAutoMode) turns.seat(autoStopped ? null : auto);
    else if (isLocalMode) turns.seat({ white: humanPlayers.white, black: humanPlayers.black });
    else {
      const white =
        twitchVoteMode === 'chatvsbot' ? chat : twitchVoteMode === 'guess' ? guess : humanPlayers.white;
      turns.seat({ white, black: bot });
    }
  }, [
    isMultiplayer,
    onlineColor,
    watchingGame,
    isAutoMode,
    autoStopped,
    isLocalMode,
    twitchVoteMode,
    botLevelRef,
    setSelected,
    setSearchEvalFromWhite,
    setSearchMateInPlies,
    setPreviewTopology,
    autoLastMoveAtRef,
  ]);
}
