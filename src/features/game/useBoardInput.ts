import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from 'react';
import { classifyAsync } from '../../analysis/classifyClient';
import type { MultiplayerSyncHandle } from '../online/useMultiplayerSync';
import type { BoardState, Move, PieceType, SquareId, TopologyState } from '../../engine';
import { tilePixelCenter, type BoardLayout } from '../../engine/auxetic';
import { applyMove } from '../../engine/moves';
import { streaming } from '../../integrations';
import { computeSAN } from '../../recording/log';
import { turns } from '../../session/session';
import { scaleBudgetMs } from '../../utils/deviceTier';
import type { WatchingGame } from '../review/watching';
import { colorFromMouseEvent } from './annotations';
import { bumpEvalForMove } from './position';
import { isPieceMovableInRoulette } from './roulette';
import type { useClassifier } from './useClassifier';
import { useSession } from '../../session/useSession';
import { gameStatusOf, modeOf, boardOf, legalMovesOf, logOf, allowedPieceTypesOf, usedRouletteSlotsOf, rouletteRevealOf, rouletteActionsLeftOf } from './boardView';
import type { BoardUi } from './useBoardUi';

// M.14 — beat-mode glide length. MUST match the .piece-slide-in CSS
// animation duration so the slide lands exactly on the beat.
const BEAT_SLIDE_MS = 260;

type Square = { from: SquareId; to: SquareId };

interface UseBoardInputArgs {
  /** The board's own UI state (useBoardUi). */
  ui: BoardUi;
  isMultiplayer: boolean;
  mpSync: MultiplayerSyncHandle | null;
  isLocalMode: boolean;
  watchingGame: WatchingGame | null;
  currentPlayer: 'human' | 'ai';
  /** The legal moves of a board under the mode's rules (App). */
  getLegalMoves: (s: BoardState) => Move[];
  pendingPromotion: Square | null;
  /** The tiles' layout (useEndgame) and the topology drawn (useBoardMarks). */
  layout: BoardLayout;
  displayTopology: TopologyState;
  commitAnalysis: ReturnType<typeof useClassifier>['commitAnalysis'];
  /** Twitch: the streamer's move settles chat's guess round (useTwitchState). */
  settleGuessRound: (move: Move, san: string) => void;
  setSearchEvalFromWhite: Dispatch<SetStateAction<number | null>>;
  setSearchMateInPlies: Dispatch<SetStateAction<number | null>>;
}

/**
 * The board's input, as App had it: a click on a tile (select, move, and
 * everything a played move sets off here: the Beat Mode hold, the guess
 * round, the eval bump, the classifier), the promotion picker's two
 * answers, and the right-drag annotations. Plain handlers: the only React hook inside is useSession (the
 * game on the board, read in this render, as App's aliases are), with no
 * effect of its own; the rest of what they read is passed in from App's
 * render, so the call's position changes no effect order.
 */
export function useBoardInput({
  ui,
  isMultiplayer,
  mpSync,
  isLocalMode,
  watchingGame,
  currentPlayer,
  getLegalMoves,
  pendingPromotion,
  layout,
  displayTopology,
  commitAnalysis,
  settleGuessRound,
  setSearchEvalFromWhite,
  setSearchMateInPlies,
}: UseBoardInputArgs) {
  const { selected, setSelected, setMpPendingPromotion, beatSnapPendingRef, setBeatSnap, annotationStartRef, setSquareAnnotations, setArrowAnnotations } = ui;
  const gameStatus = useSession(gameStatusOf);
  const gameMode = useSession(modeOf(isMultiplayer));
  const state = useSession(boardOf(isMultiplayer));
  const legalMoves = useSession(legalMovesOf(isMultiplayer));
  const log = useSession(logOf(isMultiplayer));
  const allowedPieceTypes = useSession(allowedPieceTypesOf(isMultiplayer));
  const usedRouletteSlots = useSession(usedRouletteSlotsOf(isMultiplayer));
  const rouletteReveal = useSession(rouletteRevealOf(isMultiplayer));
  const rouletteActionsLeft = useSession(rouletteActionsLeftOf(isMultiplayer));
  // Sprint 3.6 — right-click annotation handlers. Bound on every tile
   // alongside onClick. Left-click logic is untouched: button !== 2
   // exits these helpers immediately.
  function handleTileContextMenu(e: ReactMouseEvent) {
    e.preventDefault();
  }

  function handleTileMouseDown(e: ReactMouseEvent, sq: SquareId) {
    if (e.button !== 2) return;
    e.preventDefault();
    annotationStartRef.current = sq;
  }

  function handleTileMouseUp(e: ReactMouseEvent, sq: SquareId) {
    if (e.button !== 2) return;
    const start = annotationStartRef.current;
    annotationStartRef.current = null;
    if (!start) return;
    const color = colorFromMouseEvent(e);
    if (start === sq) {
      setSquareAnnotations((prev) => {
        const next = new Map(prev);
        if (next.get(sq) === color) {
          next.delete(sq);
        } else {
          next.set(sq, color);
        }
        return next;
      });
    } else {
      setArrowAnnotations((prev) => {
        const existing = prev.findIndex(
          (a) => a.from === start && a.to === sq && a.color === color,
        );
        if (existing >= 0) {
          return prev.filter((_, i) => i !== existing);
        }
        return [...prev, { from: start, to: sq, color }];
      });
    }
  }

  function onSquareClick(square: string) {
    if (watchingGame) return; // replay mode is read-only.
    // SP-3 Beat Mode — a move is queued to land on the next beat; ignore
    // further board input until it commits so the snap can't be raced.
    if (beatSnapPendingRef.current) return;

    // Multiplayer: bypass the local engine pipeline entirely. Selection +
    // legalMoves are the same shared values; the only difference is the
    // move dispatch sends through Firestore instead of mutating local state.
    if (isMultiplayer) {
      if (!mpSync || !mpSync.isMyTurn) return;
      if (mpSync.matchState.status !== 'active') return;
      const sq = square as SquareId;
      const piece = state.pieces[sq];
      // Q.D.3: MP roulette — board is dead until the on-clock player
      // spins. After spin only piece types whose slot index is still
      // unused can be selected.
      const isMpRoulette = mpSync.isRouletteMode;
      if (isMpRoulette && mpSync.rouletteSlots === null) return;
      if (isMpRoulette && rouletteReveal) return; // the bag is still landing
      const canSelect = (type: PieceType): boolean =>
        !isMpRoulette ||
        isPieceMovableInRoulette(
          type,
          state,
          'roulette',
          mpSync.rouletteSlots,
          mpSync.usedRouletteSlots,
        );
      if (!selected) {
        if (
          piece &&
          piece.color === mpSync.myColor &&
          canSelect(piece.type)
        ) {
          setSelected(square);
        }
        return;
      }
      if (selected === square) {
        setSelected(null);
        return;
      }
      const move = legalMoves.find(
        (m) => m.from === selected && m.to === square,
      );
      if (!move) {
        // Click on another own piece → switch; else clear.
        if (
          piece &&
          piece.color === mpSync.myColor &&
          canSelect(piece.type)
        ) {
          setSelected(square);
        } else {
          setSelected(null);
        }
        return;
      }
      // R13b — classic MP gets the same promotion picker as solo (the
      // auto-queen shortcut made underpromotion impossible in PvP).
      // Roulette keeps auto-queen to preserve the multi-action flow.
      if (
        move.kind === 'promotion' &&
        move.from &&
        move.to &&
        mpSync.matchState.gameMode !== 'roulette'
      ) {
        setMpPendingPromotion({ from: move.from, to: move.to });
        return;
      }
      const resolved: Move =
        move.kind === 'promotion' && !move.promotion
          ? { ...move, promotion: 'queen' }
          : move;
      setSelected(null);
      void mpSync.sendMove(resolved);
      return;
    }

    if (gameStatus !== 'active') return;
    if (currentPlayer !== 'human') return;

    // In roulette mode the board is locked until a roll has happened.
    if (gameMode === 'roulette' && allowedPieceTypes === null) return;

    // In roulette mode, each sub-move needs an action point.
    if (gameMode === 'roulette' && rouletteActionsLeft <= 0) return;

    // Q.D.5: route every piece-type gate through isPieceMovableInRoulette
    // so the in-check override applies uniformly to selection, legal-move
    // computation, and re-selection on miss-click.
    const activeMoves: Move[] =
      gameMode === 'roulette'
        ? getLegalMoves(state).filter((m) => {
            if (!m.from) return false;
            const p = state.pieces[m.from];
            if (!p) return false;
            return isPieceMovableInRoulette(
              p.type,
              state,
              gameMode,
              allowedPieceTypes,
              usedRouletteSlots,
            );
          })
        : legalMoves;
    const canSelectSolo = (type: PieceType): boolean =>
      isPieceMovableInRoulette(
        type,
        state,
        gameMode,
        allowedPieceTypes,
        usedRouletteSlots,
      );

    if (!selected) {
      if (gameMode === 'roulette') {
        const p = state.pieces[square as SquareId];
        if (!p || p.color !== state.sideToMove) return;
        if (!canSelectSolo(p.type)) return;
      }
      setSelected(square);
      return;
    }
    if (selected === square) {
      setSelected(null);
      return;
    }
    let move = activeMoves.find(
      (m) => m.from === selected && m.to === square,
    );
    if (!move) {
      move = activeMoves.find(
        (m) =>
          m.from === selected &&
          m.kind === 'castle' &&
          m.castleRookFrom === square,
      );
    }
    if (!move) {
      if (gameMode === 'roulette') {
        const p = state.pieces[square as SquareId];
        if (!p || p.color !== state.sideToMove) return;
        if (!canSelectSolo(p.type)) return;
      }
      setSelected(square);
      return;
    }
    // Promotion picker (classic only — in roulette we auto-queen to keep the
    // multi-action flow uninterrupted).
    if (move.kind === 'promotion' && move.from && move.to && gameMode !== 'roulette') {
      turns.act({ type: 'requestPromotion', from: move.from, to: move.to });
      return;
    }
    const resolvedMove: Move =
      gameMode === 'roulette' && move.kind === 'promotion' && !move.promotion
        ? { ...move, promotion: 'queen' }
        : move;

    // SP-3 / M.14 Beat Mode — in classic solo play the piece GLIDES into
    // place exactly on the beat. The commit closure captures this render's
    // state/log; nothing mutates them during the <1-beat hold (human's
    // turn), so deferring is safe. Roulette/MP excluded.
    //
    // Earlier the move committed ON the beat and the slide started then,
    // so the piece arrived a slide-length late and felt laggy. Now we
    // figure out whether this move will visually slide (both tiles
    // unrotated in the current topology) and, if so, commit a slide-
    // length EARLY so the glide LANDS on the beat. The ring keeps filling
    // until the beat, popping as the piece touches down.
    if (gameMode === 'classic' && !isMultiplayer) {
      const from = resolvedMove.from!;
      const to = resolvedMove.to!;
      const willSlide =
        from !== to &&
        tilePixelCenter(to, displayTopology, layout).angle === 0 &&
        tilePixelCenter(from, displayTopology, layout).angle === 0;
      const slideMs = willSlide ? BEAT_SLIDE_MS : 0;
      const beat = streaming();
      const plan = beat ? beat.beatMode.snapPlan(slideMs) : null;
      if (beat && plan) {
        const { beatEngine } = beat;
        beatSnapPendingRef.current = true;
        setBeatSnap({ from, to, ms: plan.landMs });
        // R15-bug — the hold used to be ONE fixed setTimeout computed at
        // click time, but since M.26/27 the grid is alive under it: an
        // essentia re-lock (every ~6s) or a PLL nudge moves the beats,
        // and the pre-computed hold landed where the beat USED to be —
        // "Beat Mode лагає". The hold now TRACKS the live grid, waking
        // shortly before each estimated land and re-reading
        // msToNextBeat(); a hard cap (~1.6 beats from click) commits
        // regardless, so a re-anchoring grid can never chase the move
        // away from the player.
        const commitSnap = () => {
          beatSnapPendingRef.current = false;
          setSelected(null);
          commitMove();
          setBeatSnap(null);
        };
        const deadline =
          performance.now() + Math.min(plan.landMs, beatEngine.getIntervalMs() * 1.6);
        const track = () => {
          if (!beatEngine.isRunning()) {
            commitSnap(); // grid stopped mid-hold — play immediately
            return;
          }
          const msLeft = beatEngine.msToNextBeat();
          if (msLeft <= slideMs + 45 || performance.now() >= deadline) {
            // Beat within glide reach (or cap hit): commit so the piece
            // lands on it.
            window.setTimeout(commitSnap, Math.max(0, msLeft - slideMs));
            return;
          }
          window.setTimeout(track, Math.min(60, msLeft - slideMs - 40));
        };
        track();
        return;
      }
    }
    commitMove();
    return;

    // ── commit closure ──────────────────────────────────────────────
    function commitMove() {
    const san = computeSAN(state, resolvedMove);
    // R2 — settle the chat's "guess the streamer" round on the actual move.
    settleGuessRound(resolvedMove, san);
    const afterMove = applyMove(state, resolvedMove);
    // The move itself (the board, the log, the roulette turn, the end of
    // the game) is step()'s: src/session/step.ts.
    turns.act({ type: 'move', move: resolvedMove, actor: 'human', now: Date.now() });
    // Defer classify so the click feels instant — main thread is still
    // single-threaded but the DOM paints first, then the analysis lands
    // ~300 ms later as if the engine is "thinking".
    // Worker-backed classify: keeps the main thread responsive while the
    // ~1 s depth-7 search runs. moveIdx is captured pre-append so the .then
    // can patch by index even if the user / AI has moved on by the time the
    // analysis lands. Visuals are gated to "still the latest move".
    // B3 — bump the previous search-eval by the material delta instead
    // of dropping to the static fallback (the bar was flickering).
    setSearchEvalFromWhite((prev) => bumpEvalForMove(prev, state, resolvedMove));
    setSearchMateInPlies(null);
    const moveIdx = log.moves.length;
    // Sprint 4.1 — local hot-seat skips the classifier worker. The
    // analysis pipeline is tied to leaderboard / review of solo games
    // vs the AI; in local 2P play there's no scoring and both sides
    // are human, so the cost / noise isn't worth it.
    if (!isLocalMode) {
      classifyAsync(state, resolvedMove, afterMove, {
        budgetMs: scaleBudgetMs(1000),
        maxDepth: 7,
        allowSelfCheck: gameMode === 'roulette',
      })
        .then(
          (analysis) => {
            commitAnalysis(moveIdx, analysis, resolvedMove.to);
          },
          () => {}, // the classifier failed: the move goes without a verdict
        );
    }

    setSelected(null);
    } // end commitMove
  }

  function handlePromotion(pieceType: PieceType) {
    if (!pendingPromotion) return;
    const move = legalMoves.find(
      (m) =>
        m.from === pendingPromotion.from &&
        m.to === pendingPromotion.to &&
        m.kind === 'promotion' &&
        m.promotion === pieceType,
    );
    if (!move) return;
    // R13b — MP: the picked piece rides the match doc; the local commit
    // below is solo-only (the MP board re-derives from the shared log).
    if (isMultiplayer && mpSync) {
      setSelected(null);
      setMpPendingPromotion(null);
      void mpSync.sendMove(move);
      return;
    }
    const san = computeSAN(state, move);
    // R2 — promotion commits bypass commitMove; settle the guess round here too.
    settleGuessRound(move, san);
    const next = applyMove(state, move);
    turns.act({ type: 'promote', piece: pieceType, now: Date.now() });
    setSelected(null);
    // B3 — material-delta bump instead of static-fallback flicker.
    setSearchEvalFromWhite((prev) => bumpEvalForMove(prev, state, move));
    setSearchMateInPlies(null);
    const moveIdx = log.moves.length;
    classifyAsync(state, move, next, {
      budgetMs: scaleBudgetMs(1000),
      maxDepth: 7,
      allowSelfCheck: gameMode === 'roulette',
    }).then(
      (analysis) => {
        commitAnalysis(moveIdx, analysis, move.to);
      },
      () => {}, // the classifier failed: the move goes without a verdict
    );
  }

  function cancelPromotion() {
    if (isMultiplayer) setMpPendingPromotion(null);
    else turns.act({ type: 'cancelPromotion' });
  }

  return { handleTileContextMenu, handleTileMouseDown, handleTileMouseUp, onSquareClick, handlePromotion, cancelPromotion };
}
