import { useEffect, type Dispatch, type SetStateAction, type RefObject } from 'react';
import type { User } from 'firebase/auth';
import type { MatchOutcome } from '../../firebase/matches';
import { findKing, isCheckmate, checkDrawConditions } from '../../engine/moves';
import { gamesRepo } from '../../infra/firestore/games';
import type { MultiplayerSyncHandle } from '../../components/MultiplayerGameView';
import type { ToastContextValue } from '../../components/Toast';

interface UseOnlineMatchEndArgs {
  user: User | null;
  mpEndOutcome: MatchOutcome | null;
  setMpEndOutcome: Dispatch<SetStateAction<MatchOutcome | null>>;
  mpSavedGameIdRef: RefObject<string | null>;
  mpWroteOutcomeRef: RefObject<string | null>;
  isMultiplayer: boolean;
  mpSync: MultiplayerSyncHandle | null;
  toast: ToastContextValue;
}

/**
 * The end of an online match: the first player to see a mate, a dead
 * king or a draw on the board writes the outcome, and once the match doc
 * says completed, each player opens the result dialog and saves their own
 * /games record.
 */
export function useOnlineMatchEnd({
  user,
  mpEndOutcome,
  setMpEndOutcome,
  mpSavedGameIdRef,
  mpWroteOutcomeRef,
  isMultiplayer,
  mpSync,
  toast,
}: UseOnlineMatchEndArgs) {
  // ---- Q.B.2 multiplayer: terminal detection + host /games save ----------
  // Runs whenever the live match changes. If the board reached mate/draw,
  // first peer to notice writes the outcome (transaction-guarded). When
  // status flips to completed, the host saves a /games doc once.
  useEffect(() => {
    if (!isMultiplayer || !mpSync) return;
    const match = mpSync.matchState;
    if (match.status !== 'active') return;
    if (match.outcome) return;
    if (mpWroteOutcomeRef.current === match.code) return;
    const board = mpSync.boardState;
    let outcome: MatchOutcome | null = null;
    if (mpSync.isRouletteMode) {
      // Q.D.8: roulette is capture-the-king. Whichever king is missing,
      // the OTHER side wins. No checkmate / stalemate / draw rules apply
      // here — the variant deliberately collapses every termination path
      // to "king on the board → game continues; king gone → game over".
      if (!findKing(board, 'white')) outcome = 'black-win';
      else if (!findKing(board, 'black')) outcome = 'white-win';
    } else {
      if (isCheckmate(board)) {
        outcome = board.sideToMove === 'white' ? 'black-win' : 'white-win';
      } else if (checkDrawConditions(board) !== null) {
        outcome = 'draw';
      }
    }
    if (!outcome) return;
    mpWroteOutcomeRef.current = match.code;
    void mpSync.writeOutcomeIfFirst(outcome);
  }, [isMultiplayer, mpSync, mpWroteOutcomeRef]);

  useEffect(() => {
    if (!isMultiplayer || !mpSync) return;
    const match = mpSync.matchState;
    if (match.status !== 'completed' || !match.outcome) return;
    // Show local completion modal exactly once per terminal transition.
    if (mpEndOutcome !== match.outcome) {
      setMpEndOutcome(match.outcome);
    }
    // R13 host-gone fix: each peer saves their OWN /games record (idempotent
    // via deterministic doc id inside the helper), so the record survives
    // the other player vanishing at game end. Ref-guard just stops in-session
    // re-attempts.
    if (user && mpSavedGameIdRef.current !== match.code) {
      mpSavedGameIdRef.current = match.code;
      void gamesRepo.saveMultiplayer(match, user.uid).catch((err) => {
        console.error('[mp] save to /games failed', err);
        // QA-22 (last point) — a real refusal no longer disappears silently.
        toast.show('This match could not be saved to your games.', 'error', 5000);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiplayer, mpSync?.matchState.status, mpSync?.matchState.outcome]);
}
