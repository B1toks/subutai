import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { MoveAnalysis } from '../../analysis/classify';
import type { SquareId } from '../../engine';
import type { BotStrength } from '../../ai/agents';
import { classifyAsync } from '../../analysis/classifyClient';
import { scaleBudgetMs } from '../../utils/deviceTier';
import { moveVoting } from '../../twitch/moveVoting';
import { bumpEvalForMove } from './position';
import { session, turns } from '../../session/session';
import { humanPlayers } from '../../session/players/human';
import { createAutoPlayer, createBotPlayer } from '../../session/players/bot';
import type { Player, Seats } from '../../session/players/types';
import type { WatchingGame } from '../review/watching';

const autoSeats = (moved: () => void): Seats => ({
  white: createAutoPlayer({ color: 'white', dispatch: session.dispatch, moved }),
  black: createAutoPlayer({ color: 'black', dispatch: session.dispatch, moved }),
});

interface UseSeatsArgs {
  isMultiplayer: boolean;
  watchingGame: WatchingGame | null;
  isAutoMode: boolean;
  autoStopped: boolean;
  isLocalMode: boolean;
  botLevelRef: RefObject<BotStrength>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setSearchEvalFromWhite: Dispatch<SetStateAction<number | null>>;
  setSearchMateInPlies: Dispatch<SetStateAction<number | null>>;
  commitAnalysis: (moveIdx: number, analysis: MoveAnalysis, moveTo: SquareId | undefined) => void;
  autoLastMoveAtRef: RefObject<number>;
}

/**
 * Who plays each side of the session's game (src/session/players): in a
 * solo game the player here has white and the bot black; in hot-seat both
 * sides are here; a self-play run seats its bot on both. Nobody is seated
 * while a replay is watched or an online match is on (that game is the
 * match document's), or once a self-play run is stopped.
 */
export function useSeats({
  isMultiplayer,
  watchingGame,
  isAutoMode,
  autoStopped,
  isLocalMode,
  botLevelRef,
  setSelected,
  setSearchEvalFromWhite,
  setSearchMateInPlies,
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
  const playersRef = useRef<{ bot: Player; auto: Seats } | null>(null);

  useEffect(() => {
    playersRef.current ??= {
      bot: createBotPlayer({
        color: 'black',
        dispatch: session.dispatch,
        strength: () => botLevelRef.current,
        vote: (board, legal, chosen) => moveVoting.gate(board, legal, chosen),
        async analyse(before, move, after, index) {
          // B3 — material-delta bump instead of static-fallback flicker.
          setSearchEvalFromWhite((prev) => bumpEvalForMove(prev, before, move));
          setSearchMateInPlies(null);
          // Worker-backed classify: ~1 s of background work for depth 7.
          const analysis = await classifyAsync(before, move, after, {
            budgetMs: scaleBudgetMs(1000),
            maxDepth: 7,
            allowSelfCheck: false,
          });
          commitRef.current(index, analysis, move.to);
        },
        moved: () => setSelected(null),
      }),
      auto: autoSeats(() => {
        setSelected(null);
        autoLastMoveAtRef.current = Date.now();
      }),
    };
    const { bot, auto } = playersRef.current;
    if (isMultiplayer || watchingGame) turns.seat(null);
    else if (isAutoMode) turns.seat(autoStopped ? null : auto);
    else turns.seat({ white: humanPlayers.white, black: isLocalMode ? humanPlayers.black : bot });
  }, [
    isMultiplayer,
    watchingGame,
    isAutoMode,
    autoStopped,
    isLocalMode,
    botLevelRef,
    setSelected,
    setSearchEvalFromWhite,
    setSearchMateInPlies,
    autoLastMoveAtRef,
  ]);
}
