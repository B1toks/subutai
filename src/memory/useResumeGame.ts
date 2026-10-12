import {
  useRef,
  useCallback,
  useEffect,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { SavedGame } from './types';
import {
  createPositionFromBackRankKey,
  type BoardState,
  type TopologyState,
} from '../engine';
import { createGameLog, computeSAN, appendMove, type GameLog } from '../recording/log';
import { applyRotationMove } from '../engine/auxetic';
import { applyMove } from '../engine/moves';
import { readLiveSession, clearLiveSession } from './liveSession';
import { localStorageAdapter } from './storage';
import type { BotStrength } from '../ai/agents';
import { session } from '../session/session';

interface UseResumeGameArgs {
  isAutoMode: boolean;
  sharedGameId: string | null;
  importedLogIdRef: RefObject<string | null>;
  resumedLogIdRef: RefObject<string | null>;
  setOpponentMode: Dispatch<SetStateAction<'ai' | 'friend' | 'local'>>;
  mpResumeCodeRef: RefObject<string | null>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setPreviewTopology: Dispatch<SetStateAction<TopologyState | null>>;
  beginBusy: (label: string) => void;
  setBotLevel: (next: BotStrength) => void;
  setFormationLocked: Dispatch<SetStateAction<boolean>>;
  setLockedFormationKey: Dispatch<SetStateAction<string | null>>;
  aiTimerRef: RefObject<number | null>;
  savedForLogIdRef: RefObject<string | null>;
  liveSavedGameIdRef: RefObject<string>;
  setSearchEvalFromWhite: Dispatch<SetStateAction<number | null>>;
  setSearchMateInPlies: Dispatch<SetStateAction<number | null>>;
  classifyImportedLog: (loadedLog: GameLog) => void;
  resetGameEndState: () => void;
}

/**
 * Puts a saved game back on the board: from the Memory panel
 * (onMemoryGameActivate, never ranked) or, once on load, the solo game a
 * reload or another tab left in progress (from the live-session pointer).
 * App calls it after useOnlineMatch, whose reseat clears the online resume
 * code that this one checks first.
 */
export function useResumeGame({
  isAutoMode,
  sharedGameId,
  importedLogIdRef,
  resumedLogIdRef,
  setOpponentMode,
  mpResumeCodeRef,
  setSelected,
  setPreviewTopology,
  beginBusy,
  setBotLevel,
  setFormationLocked,
  setLockedFormationKey,
  aiTimerRef,
  savedForLogIdRef,
  liveSavedGameIdRef,
  setSearchEvalFromWhite,
  setSearchMateInPlies,
  classifyImportedLog,
  resetGameEndState,
}: UseResumeGameArgs) {
  // Stable callback for <MemoryPanel onGameActivate>. The wrapped function
  // closes over a ref that always points at the latest `resumeGame`, so the
  // prop reference itself never changes and React.memo on MemoryPanel can
  // skip the 300-card subtree on every App re-render.
  const resumeGameRef = useRef<(game: SavedGame, opts?: { keepRank?: boolean }) => void>(() => {});
  const onMemoryGameActivate = useCallback((g: SavedGame) => {
    if (g.status === 'incomplete') resumeGameRef.current(g);
  }, []);

  /**
   * `keepRank` is for the one resume that is the same game carried across a
   * reload or into a new tab: a solo game against the bot, at the level it
   * was started at, that was not itself resumed or imported (the live
   * session pointer records all three). Everything else — the Memory panel
   * above all — is never ranked (N-1).
   */
  function resumeGame(game: SavedGame, opts?: { keepRank?: boolean }) {
    const initial = createPositionFromBackRankKey(game.config960);
    let current: BoardState = initial;
    let nextLog: GameLog = createGameLog(`resume-${Date.now()}`, initial, Date.now());

    for (const entry of game.moves) {
      const mv = entry.move;
      // V1 — SAN is computed from the position BEFORE the move, exactly as
      // a live move records it. Without it a resumed game's move list lost
      // its piece letters ("Na8→b6" came back as "a8→b6").
      const san = computeSAN(current, mv);
      if (mv.kind === 'topologyToggle') {
        current = applyRotationMove(current);
        nextLog = appendMove(nextLog, mv, san, entry.topology);
        continue;
      }
      if (!mv.from || !mv.to) continue;
      current = applyMove(current, mv);
      nextLog = appendMove(nextLog, mv, san, entry.topology);
    }

    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    session.dispatch({
      type: 'load',
      game: { initial, board: current, log: nextLog, lastMove: null },
      fresh: true,
    });
    setSelected(null);
    setPreviewTopology(null);
    setFormationLocked(true);
    setLockedFormationKey(game.config960);
    savedForLogIdRef.current = null;
    liveSavedGameIdRef.current = game.id;
    setSearchEvalFromWhite(null);
    setSearchMateInPlies(null);
    resetGameEndState();
    importedLogIdRef.current = game.imported ? nextLog.id : null;
    resumedLogIdRef.current = opts?.keepRank ? null : nextLog.id;
    classifyImportedLog(nextLog);
  }
  // Keep the ref pointing at the latest resumeGame closure so the stable
  // onMemoryGameActivate callback always invokes the fresh state-bound copy.
  resumeGameRef.current = resumeGame;

  /**
   * V1 — a new tab opens on the game you are already playing.
   *
   * Online this already worked (R13b re-seats you from subutai_mp_active).
   * Solo, every tab started a fresh board, although the game in progress
   * was sitting in Memory, snapshotted on every move. Now the tab picks it
   * up — only if it was touched in the last day, and only a CLASSIC game
   * WITHOUT a clock:
   *   · roulette carries turn state a move list cannot rebuild (the spun
   *     slots, the actions left), so it waits in Memory instead;
   *   · a timed game would come back with both clocks at zero — in a
   *     ranked game against Strong that is "refresh for more time".
   */
  const liveResumeTriedRef = useRef(false);
  useEffect(() => {
    if (liveResumeTriedRef.current) return;
    liveResumeTriedRef.current = true;
    if (isAutoMode || sharedGameId || mpResumeCodeRef.current) return;
    const session = readLiveSession();
    if (!session) return;
    if (session.gameMode !== 'classic' || session.timed) return;
    if (Date.now() - session.savedAt > 24 * 60 * 60 * 1000) {
      clearLiveSession();
      return;
    }
    void localStorageAdapter.loadGames().then((games) => {
      const game = games.find((g) => g.id === session.gameId && g.status === 'incomplete');
      if (!game || game.moves.length === 0) return;
      beginBusy('Picking up your game');
      setOpponentMode(session.opponentMode);
      if (session.botLevel) setBotLevel(session.botLevel);
      resumeGameRef.current(game, {
        keepRank: session.opponentMode === 'ai' && !!session.botLevel && !session.unranked,
      });
    });
    // Once, on the first render that has everything it needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { onMemoryGameActivate };
}
