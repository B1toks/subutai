import {
  useMemo,
  useCallback,
  useState,
  useRef,
  useLayoutEffect,
  useEffect,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { computeBoardLayout, tilePixelCenter } from '../../engine/auxetic';
import type { Color, SquareId, TopologyState } from '../../engine';
import { findKing } from '../../engine/moves';
import { winnerOf } from './result';
import { HUMAN_COLOR } from '../../shared/game';
import type { KingOrigin, EndgameKind, VictoryTheme } from './EndgameScene';
import { translateOutcomeForPlayer } from '../../firebase/multiplayerGames';
import type { MatchOutcome } from '../../firebase/matches';
import type { MultiplayerSyncHandle } from '../online/useMultiplayerSync';
import type { WatchingGame } from '../review/watching';
import { registerFx } from '../../services/fxSeam';
import { useSession } from '../../session/useSession';
import { gameStatusOf, boardOf, logOf } from '../game/boardView';

/**
 * The endgame cinematic is code-split, but it is handed the screen by the
 * checkmate iris on a hard cut: if the chunk is still in flight when the
 * iris ends, the board flashes back into view for a few hundred ms before
 * going black again. So the import is also callable on its own, and the
 * iris kicks it off the moment it starts closing — by the time it hands
 * over, the module is in cache and React's lazy resolves in a microtask.
 */
export const importEndgameScene = () => import('./EndgameScene');

/** The cut on screen, as App keeps it in its endgameCut state. */
type EndgameCut = { kind: EndgameKind; theme: VictoryTheme; king: KingOrigin | null; prelude: number };

interface UseEndgameArgs {
  isAutoMode: boolean;
  mpEndOutcome: MatchOutcome | null;
  isMultiplayer: boolean;
  mpSync: MultiplayerSyncHandle | null;
  watchingGame: WatchingGame | null;
  victoryFreezeTimer: RefObject<number | null>;
  setVictoryFreeze: Dispatch<SetStateAction<boolean>>;
  victoryFreeze: boolean;
  boardSize: number;
  setEndgameCut: Dispatch<SetStateAction<EndgameCut | null>>;
  endgameCut: EndgameCut | null;
  tileBase: number;
  isLocalMode: boolean;
  displayTopology: TopologyState;
  checkSquares: { king: string | null; checkers: Set<string> };
}

/**
 * The end of a game on screen: where the kings stand in pixels, the
 * checkmate iris and shatter, and the cinematic cut (win, loss or draw)
 * with the freeze beat before it; endgameSceneActive tells every game-over
 * dialog to wait. Call order matters: its layout effects start the
 * sequence before the summary can paint. Its dev seam subutaiFX.mate
 * registers on the shared object in src/services/fxSeam.ts.
 */
export function useEndgame({
  isAutoMode,
  mpEndOutcome,
  isMultiplayer,
  mpSync,
  watchingGame,
  victoryFreezeTimer,
  setVictoryFreeze,
  victoryFreeze,
  boardSize,
  setEndgameCut,
  endgameCut,
  tileBase,
  isLocalMode,
  displayTopology,
  checkSquares,
}: UseEndgameArgs) {
  const gameStatus = useSession(gameStatusOf);
  const state = useSession(boardOf(isMultiplayer));
  const log = useSession(logOf(isMultiplayer));
  const layout = useMemo(
    () => computeBoardLayout(displayTopology, boardSize),
    [displayTopology, boardSize],
  );

  const scale = layout.tileSize / tileBase;

  // M.21 — checkmate death cinematic. Instead of the instant white flash
  // cutting straight to the summary modal, the screen irises down around
  // the mated king (everything else fades to black, the king is the last
  // thing visible), holds a beat, then the king shatters. Fires on ANY
  // checkmate — human win or loss, any mode — since it's dramatizing the
  // king's fate, not the player's. The existing win-only VictoryScene and
  // every "game over" modal (summary / MP / local) wait for this to
  // finish via mateSeqActive below rather than cutting it off.
  // Position falls back to "the side-to-move's king" (findKing) when
  // nobody's actually in check, purely so the subutaiFX.mate() dev seam
  // (below) always has a real square to point at — the real gameplay
  // trigger effect still requires a genuine gameStatus === 'checkmate'.
  /** A king's centre in BOARD pixels, for the iris and the shatter. */
  const boardKingPos = useCallback(
    (sq: string | null, color: Color) => {
      if (!sq) return null;
      const tile = tilePixelCenter(sq as SquareId, displayTopology, layout);
      const flip = isMultiplayer && mpSync?.myColor === 'black';
      return {
        sq,
        color,
        cx: flip ? boardSize - tile.cx : tile.cx,
        cy: flip ? boardSize - tile.cy : tile.cy,
      };
    },
    [displayTopology, layout, boardSize, isMultiplayer, mpSync],
  );

  const mateKingPos = useMemo(
    () =>
      boardKingPos(
        checkSquares.king ?? findKing(state, state.sideToMove),
        // Whose king this is — the side to move is the side being mated.
        state.sideToMove,
      ),
    [checkSquares.king, state, boardKingPos],
  );

  /**
   * V1 — where a given side's king is on screen, in VIEWPORT pixels.
   *
   * mateKingPos above is board-relative, which is all the DOM iris needs
   * (it is absolutely positioned inside .board). The endgame cinematic
   * renders to a full-screen canvas, so it needs the same point in the
   * viewport's frame — hence the board rect. .board carries no border or
   * padding, so its rect origin and the board's own coordinate origin are
   * the same point.
   */
  const decisiveWinner: Color | null = useMemo(
    () => winnerOf(gameStatus, state.sideToMove),
    [gameStatus, state.sideToMove],
  );

  /**
   * V1 — WHOSE king the endgame cut is about.
   *
   * The cut used to lift the losing king in every case, which meant a win
   * ended with a crown descending onto the bot's king. It belongs to the
   * player it is played for:
   *
   *   solo         your king — you are white, win or lose
   *   multiplayer  your king only, whichever colour you were given
   *   hot-seat     the winning king, because neither side is "you" and
   *                the only thing worth dramatising is who took it
   *   spectating / bot-vs-bot   nobody: no cut, the old iris + shatter
   *
   * Null means "no cinematic in this mode", which is also what keeps
   * multiplayer and hot-seat from playing one on a draw.
   */
  const cutSubjectColor: Color | null = useMemo(() => {
    if (watchingGame || isAutoMode) return null;
    if (isMultiplayer) return mpSync?.myColor ?? null;
    if (isLocalMode) return decisiveWinner;
    return HUMAN_COLOR;
  }, [watchingGame, isAutoMode, isMultiplayer, isLocalMode, mpSync?.myColor, decisiveWinner]);

  const kingOriginFor = useCallback(
    (color: Color): KingOrigin | null => {
      const sq = findKing(state, color);
      if (!sq) return null;
      const rect = document.querySelector('.board')?.getBoundingClientRect();
      if (!rect) return null;
      const tile = tilePixelCenter(sq as SquareId, displayTopology, layout);
      const flip = isMultiplayer && mpSync?.myColor === 'black';
      return {
        x: rect.left + (flip ? boardSize - tile.cx : tile.cx),
        y: rect.top + (flip ? boardSize - tile.cy : tile.cy),
        size: layout.tileSize,
        color,
      };
    },
    [state, displayTopology, layout, boardSize, isMultiplayer, mpSync],
  );

  /**
   * V1 — start an endgame cut.
   *
   * `fromIris` means the checkmate iris has already blacked the room out
   * and handed over, so the scene skips its own lead-in and lifts the king
   * immediately. Everything else (a flag fall, a resignation, a captured
   * king) gets the R17b freeze beat first — a moment of dimmed stillness —
   * and then a short dark prelude inside the scene.
   *
   * Reduced motion opts out entirely: the player goes straight to the
   * summary, the same way the iris and the shatter already hide themselves.
   */
  const launchEndgame = useCallback(
    (
      kind: EndgameKind,
      /** `king` is the SUBJECT of the cut, not the loser: the king the
       *  scene lifts and the one the iris closed on. See cutSubjectColor. */
      opts?: { king?: Color; fromIris?: boolean; theme?: VictoryTheme },
    ) => {
      if (typeof window === 'undefined') return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      void importEndgameScene(); // no-op if the iris already warmed it
      const subject: Color = opts?.king ?? cutSubjectColor ?? HUMAN_COLOR;
      const king = kingOriginFor(subject);
      // The colour roll is the win's only variable; the loss ignores it.
      const theme: VictoryTheme = opts?.theme ?? (Math.random() < 0.5 ? 'red' : 'blue');
      if (victoryFreezeTimer.current) clearTimeout(victoryFreezeTimer.current);
      if (opts?.fromIris) {
        setEndgameCut({ kind, theme, king, prelude: 0 });
        return;
      }
      setVictoryFreeze(true);
      // eslint-disable-next-line react-hooks/immutability -- victoryFreezeTimer is a useRef object (named without "Ref"), written as it was in App
      victoryFreezeTimer.current = setTimeout(() => {
        setVictoryFreeze(false);
        setEndgameCut({ kind, theme, king, prelude: 300 });
      }, 650);
    },
    [kingOriginFor, cutSubjectColor, setVictoryFreeze, victoryFreezeTimer, setEndgameCut],
  );

  /**
   * V1 — the king the iris actually closes on.
   *
   * When a cut follows, it has to be the cut's subject: narrowing the
   * screen down onto one king and then lifting a different one out of the
   * dark reads as two clips spliced together, which is exactly what this
   * whole sequence was built to stop. With no cut (spectating,
   * bot-vs-bot) it stays on the mated king, because then the shatter is
   * the ending and the mated king is what the shatter is about.
   */
  const irisKingPos = useMemo(() => {
    if (!cutSubjectColor || !mateKingPos) return mateKingPos;
    if (cutSubjectColor === mateKingPos.color) return mateKingPos;
    return boardKingPos(findKing(state, cutSubjectColor), cutSubjectColor) ?? mateKingPos;
  }, [cutSubjectColor, mateKingPos, state, boardKingPos]);

  const MATE_IRIS_MS = 900;
  const MATE_HOLD_MS = 320;
  const MATE_SHATTER_MS = 720;
  const [mateSeq, setMateSeq] = useState<'idle' | 'iris' | 'shatter'>('idle');
  const mateSeqStartedRef = useRef<string | null>(null);
  // One endgame cut per game, whichever effect gets there first.
  const endgameFiredForLogRef = useRef<string | null>(null);
  // N-2 — this effect and the no-iris one below are layout effects on
  // purpose. The render that first carries the finished gameStatus also
  // carries the summary (and Local's "Game over" card); a passive effect
  // only starts the sequence after the browser has painted that render, so
  // the summary showed for a frame or several on a heavy page and was then
  // covered by the cut. A layout effect starts it, and re-renders with
  // endgameSceneActive true, before anything is painted.
  useLayoutEffect(() => {
    if (gameStatus !== 'checkmate' || !mateKingPos) {
      setMateSeq('idle');
      mateSeqStartedRef.current = null;
      return;
    }
    // One playthrough per game — a re-render while mid-sequence (eval
    // ticking in, etc.) must not restart it.
    if (mateSeqStartedRef.current === log.id) return;
    mateSeqStartedRef.current = log.id;
    setMateSeq('iris');
    // V1 — the iris no longer ends in a shatter when a cut will follow: it
    // hands its king over to the cinematic, which picks the same piece up
    // as pixels on the same square and carries it to the middle of the
    // screen. The shatter remains the ending wherever there is no cut —
    // spectating and bot-vs-bot, and any draw — so those keep exactly the
    // ending they had.
    if (cutSubjectColor && endgameFiredForLogRef.current !== log.id) {
      endgameFiredForLogRef.current = log.id;
      // Warm the chunk during the 1.2s the iris takes to close, so the
      // hand-off is a cut and not a gap.
      void importEndgameScene();
      const subject = cutSubjectColor;
      const won = decisiveWinner === subject;
      const handOff = setTimeout(() => {
        setMateSeq('idle');
        launchEndgame(won ? 'victory' : 'defeat', { king: subject, fromIris: true });
      }, MATE_IRIS_MS + MATE_HOLD_MS);
      return () => clearTimeout(handOff);
    }
    const t1 = setTimeout(() => setMateSeq('shatter'), MATE_IRIS_MS + MATE_HOLD_MS);
    const t2 = setTimeout(
      () => setMateSeq('idle'),
      MATE_IRIS_MS + MATE_HOLD_MS + MATE_SHATTER_MS,
    );
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [
    gameStatus,
    mateKingPos,
    log.id,
    cutSubjectColor,
    decisiveWinner,
    launchEndgame,
  ]);
  const mateSeqActive = mateSeq !== 'idle';
  // V1 — "a full-screen endgame sequence owns the screen right now": the
  // iris, or the cinematic it hands over to. Every game-over modal waits
  // on this, so a summary can never pop up underneath the cut. That
  // includes the freeze beat before a cut with no iris (flag fall,
  // resignation, captured king): without it the summary flashed up for
  // those 650 ms and was then covered by the cut.
  const endgameSceneActive = mateSeqActive || endgameCut !== null || victoryFreeze;

  // Dev seams for the endings. Playing a real line out to a checkmate just
  // to look at 7 seconds of animation is hopeless, so every ending can be
  // fired by hand. subutaiFX.mate registers on the shared subutaiFX object
  // (src/services/fxSeam.ts) next to useConsoleSeams' check/strobe/dust.
  //
  //   subutaiVictory()            the win cut (king lift → crown → VICTORY)
  //   subutaiVictory('blue')      …in the blue palette instead of a coin flip
  //   subutaiDefeat()             the loss cut (king lift → topple → DEFEAT)
  //   subutaiDraw()               the draw cut (two hands meet and shake)
  //   subutaiEndgame('victory' | 'defeat', { full: true, theme: 'blue' })
  //                               same, but `full` plays the checkmate iris
  //                               first and hands over exactly as a real
  //                               game does — this is the whole thing
  //   subutaiFX.mate()            just the iris + shatter, no cinematic
  //
  // The cut points at whichever king mateKingPos resolves to, so it works
  // from any position, including one with no checkmate on the board.
  useEffect(() => {
    if (typeof window === 'undefined' || !mateKingPos) return;
    const w = window as unknown as {
      subutaiVictory?: (t?: VictoryTheme) => void;
      __triggerVictory?: (t?: VictoryTheme) => void;
      subutaiDefeat?: () => void;
      subutaiDraw?: () => void;
      subutaiEndgame?: (
        kind?: EndgameKind,
        opts?: { full?: boolean; theme?: VictoryTheme },
      ) => void;
    };
    const run = (kind: EndgameKind, full: boolean, theme?: VictoryTheme) => {
      void importEndgameScene();
      const subject: Color = cutSubjectColor ?? HUMAN_COLOR;
      const go = () => launchEndgame(kind, { king: subject, fromIris: true, theme });
      if (!full) {
        go();
        return;
      }
      setMateSeq('iris');
      setTimeout(() => {
        setMateSeq('idle');
        go();
      }, MATE_IRIS_MS + MATE_HOLD_MS);
    };
    w.subutaiEndgame = (kind = 'victory', opts) =>
      run(kind, opts?.full ?? false, opts?.theme);
    w.subutaiVictory = (t) => run('victory', false, t);
    w.__triggerVictory = w.subutaiVictory; // legacy alias used in dev tooling
    w.subutaiDefeat = () => run('defeat', false);
    w.subutaiDraw = () => run('draw', false);
    registerFx('mate', () => {
      setMateSeq('iris');
      setTimeout(() => setMateSeq('shatter'), MATE_IRIS_MS + MATE_HOLD_MS);
      setTimeout(() => setMateSeq('idle'), MATE_IRIS_MS + MATE_HOLD_MS + MATE_SHATTER_MS);
    });
  }, [mateKingPos, launchEndgame, cutSubjectColor]);

  // V1 — the endgame cut for games that do NOT end in checkmate: a flag
  // fall, a resignation, a captured king. Checkmates are handed over by the
  // iris effect above instead, so they are skipped here.
  //
  // R6 used to gate the cinematic on a come-from-behind win (worst eval
  // ≤ -2 pawns) and play nothing at all on a loss, which meant most games
  // just blinked into a modal. Both results get their own cut now; a draw
  // still gets none, because there is nothing to dramatise.
  useLayoutEffect(() => {
    if (watchingGame || isAutoMode) return; // spectating gets no cut
    if (gameStatus === 'active') {
      // N-5 — online, a resignation, a flag fall and an inactivity forfeit
      // end the MATCH, not the local board: gameStatus stays 'active' (see
      // confirmResign) and the effect used to stop right here, so the
      // match ended with no scene at all. The match doc is what says it is
      // over; the cut is about my own king, as everywhere online.
      if (
        isMultiplayer &&
        mpSync &&
        cutSubjectColor &&
        (mpEndOutcome === 'host-resign' || mpEndOutcome === 'guest-resign') &&
        endgameFiredForLogRef.current !== log.id
      ) {
        const view = translateOutcomeForPlayer(
          mpEndOutcome,
          { uid: mpSync.myUid, displayName: '', color: mpSync.myColor },
          mpSync.matchState.host.uid,
        );
        endgameFiredForLogRef.current = log.id;
        launchEndgame(view === 'human-win' ? 'victory' : 'defeat', { king: cutSubjectColor });
      }
      // A draw by agreement ends the match with the board still open,
      // like a resignation; it gets the handshake, as a drawn board does.
      if (
        isMultiplayer &&
        mpSync &&
        mpEndOutcome === 'draw' &&
        mpSync.matchState.endReason === 'agreement' &&
        endgameFiredForLogRef.current !== log.id
      ) {
        endgameFiredForLogRef.current = log.id;
        launchEndgame('draw');
      }
      return;
    }
    if (gameStatus === 'checkmate') return; // the iris hands that one over
    if (mateSeqActive) return;
    if (endgameFiredForLogRef.current === log.id) return;

    // A draw belongs to neither player, so it has no subject king and no
    // winner to ask about — it gets its own storyboard: two hands meeting
    // in the middle. It plays in every mode a human is actually sitting
    // in, including hot-seat, where cutSubjectColor is deliberately null.
    if (gameStatus.startsWith('draw')) {
      endgameFiredForLogRef.current = log.id;
      launchEndgame('draw');
      return;
    }

    if (!cutSubjectColor || !decisiveWinner) return;
    endgameFiredForLogRef.current = log.id;
    launchEndgame(decisiveWinner === cutSubjectColor ? 'victory' : 'defeat', {
      king: cutSubjectColor,
    });
  }, [
    watchingGame,
    isAutoMode,
    isMultiplayer,
    mpSync,
    mpEndOutcome,
    cutSubjectColor,
    decisiveWinner,
    gameStatus,
    mateSeqActive,
    log.id,
    launchEndgame,
  ]);
  return { layout, scale, mateKingPos, irisKingPos, mateSeq, mateSeqActive, endgameSceneActive };
}
