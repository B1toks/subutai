import { useEffect, type RefObject, type Dispatch, type SetStateAction } from 'react';
import {
  ENCOURAGE_ROTATE,
  ENCOURAGE_GENERIC,
  EARLY_GAME_TIP,
  ROTATE_AFTERMATH_TIP,
} from './coachTexts';
import type { WatchingGame } from '../review/watching';
import type { GameStatus, GameMode } from '../../shared/game';
import type { GameLog } from '../../recording/log';
import type { ToastContextValue } from '../../components/Toast';

interface UseCoachNudgesArgs {
  isMultiplayer: boolean;
  watchingGame: WatchingGame | null;
  gameStatus: GameStatus;
  helpToolsEnabled: boolean;
  gameMode: GameMode;
  log: GameLog;
  searchEvalFromWhite: number | null;
  toast: ToastContextValue;
  encourageBadStreakRef: RefObject<number>;
  encourageLastMoveRef: RefObject<number>;
  encourageCheckedMoveRef: RefObject<number>;
  setEncourageRotate: Dispatch<SetStateAction<boolean>>;
  earlyTipLogIdRef: RefObject<string | null>;
  rotateTipLogIdRef: RefObject<string | null>;
  isLocalMode: boolean;
  currentPlayer: 'ai' | 'human';
  canRotate: boolean;
}

/**
 * The coach's toasts in a solo game with the coaching tools on: a nudge
 * when the player has been clearly behind for a while (pulsing Rotate if
 * a rotation is available), and two tips once per game, early on and
 * right after the player's own rotation.
 */
export function useCoachNudges({
  isMultiplayer,
  watchingGame,
  gameStatus,
  helpToolsEnabled,
  gameMode,
  log,
  searchEvalFromWhite,
  toast,
  encourageBadStreakRef,
  encourageLastMoveRef,
  encourageCheckedMoveRef,
  setEncourageRotate,
  earlyTipLogIdRef,
  rotateTipLogIdRef,
  isLocalMode,
  currentPlayer,
  canRotate,
}: UseCoachNudgesArgs) {
  // R5 — nudge the player when they've been clearly behind for a couple of
  // moves, so a hard position reads as "keep fighting" rather than "resign".
  // Checked once per human turn (eval is from white's = the human's side);
  // rate-limited, gated on the coaching-tools switch, solo classic only.
  useEffect(() => {
    if (isMultiplayer || isLocalMode || watchingGame) return;
    if (gameMode !== 'classic' || gameStatus !== 'active') return;
    if (!helpToolsEnabled) return;
    if (currentPlayer !== 'human') return;
    const moveIdx = log.moves.length;
    if (moveIdx === 0) {
      // fresh game — clear the streak/cooldown so nudges don't carry over
      encourageBadStreakRef.current = 0;
      encourageLastMoveRef.current = -99;
      encourageCheckedMoveRef.current = -1;
      return;
    }
    if (moveIdx === encourageCheckedMoveRef.current) return; // one check per turn
    const ev = searchEvalFromWhite;
    if (ev === null) return; // eval still pending — re-runs when it lands
    encourageCheckedMoveRef.current = moveIdx;
    const HARD = -2.5; // pawns: the human is down ~a piece or worse
    if (ev > HARD) {
      encourageBadStreakRef.current = 0;
      return;
    }
    encourageBadStreakRef.current += 1;
    if (encourageBadStreakRef.current < 2) return; // must be sustained
    if (moveIdx - encourageLastMoveRef.current < 6) return; // cooldown
    encourageLastMoveRef.current = moveIdx;
    const useRotate = canRotate && Math.random() < 0.6;
    const pool = useRotate ? ENCOURAGE_ROTATE : ENCOURAGE_GENERIC;
    toast.show(pool[Math.floor(Math.random() * pool.length)], 'info', 5200);
    if (useRotate) {
      setEncourageRotate(true);
      window.setTimeout(() => setEncourageRotate(false), 5200);
    }
  }, [
    searchEvalFromWhite,
    currentPlayer,
    gameStatus,
    gameMode,
    isMultiplayer,
    isLocalMode,
    watchingGame,
    helpToolsEnabled,
    canRotate,
    log.moves.length,
    toast,
    encourageBadStreakRef,
    encourageCheckedMoveRef,
    encourageLastMoveRef,
    setEncourageRotate,
  ]);

  // R15 4-lite (a) — early-danger window. Median first blunder is move 4, so
  // the moment the eval first dips in moves 2-10 gets a single "slow down"
  // beat. Fires BEFORE the -2.5 R5 nudge territory (-1.5..-2.5) so the two
  // never stack on the same turn; once per game.
  useEffect(() => {
    if (isMultiplayer || isLocalMode || watchingGame) return;
    if (gameMode !== 'classic' || gameStatus !== 'active') return;
    if (!helpToolsEnabled) return;
    if (currentPlayer !== 'human') return;
    if (earlyTipLogIdRef.current === log.id) return;
    const plies = log.moves.length;
    if (plies < 3 || plies > 20) return; // full moves ~2-10
    const ev = searchEvalFromWhite;
    if (ev === null || ev > -1.5 || ev <= -2.5) return;
    earlyTipLogIdRef.current = log.id;
    toast.show(EARLY_GAME_TIP, 'info', 5200);
  }, [
    searchEvalFromWhite,
    currentPlayer,
    gameStatus,
    gameMode,
    isMultiplayer,
    isLocalMode,
    watchingGame,
    helpToolsEnabled,
    log,
    toast,
    earlyTipLogIdRef,
  ]);

  // R15 4-lite (b) — rotation aftermath. 25 of 98 first blunders happen right
  // after the player's OWN rotation ("rotated and didn't re-read the board").
  // Classic only: the parity check (even ply = white = human) doesn't hold
  // under roulette's 2-actions-per-turn economy. Once per game.
  useEffect(() => {
    if (isMultiplayer || isLocalMode || watchingGame) return;
    if (gameMode !== 'classic' || gameStatus !== 'active') return;
    if (!helpToolsEnabled) return;
    if (rotateTipLogIdRef.current === log.id) return;
    const idx = log.moves.length - 1;
    if (idx < 0 || idx > 40) return; // the habit matters in the danger window
    const last = log.moves[idx];
    if (last.move.kind !== 'topologyToggle' || idx % 2 !== 0) return;
    rotateTipLogIdRef.current = log.id;
    toast.show(ROTATE_AFTERMATH_TIP, 'info', 5200);
  }, [
    gameStatus,
    gameMode,
    isMultiplayer,
    isLocalMode,
    watchingGame,
    helpToolsEnabled,
    log,
    toast,
    rotateTipLogIdRef,
  ]);
}
