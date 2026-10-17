import { useEffect, type Dispatch, type SetStateAction, type RefObject } from 'react';
import type { User } from 'firebase/auth';
import { useMultiplayerSync } from '../../components/MultiplayerGameView';
import { rejoinMatch, type MatchDoc, type MatchOutcome } from '../../firebase/matches';
import { localData, LOCAL_KEYS } from '../../infra/localData';

interface UseOnlineMatchArgs {
  user: User | null;
  setView: Dispatch<SetStateAction<'game' | 'review' | 'leaderboard' | 'friend-lobby'>>;
  setOpponentMode: Dispatch<SetStateAction<'ai' | 'friend' | 'local'>>;
  activeMatch: MatchDoc | null;
  setActiveMatch: Dispatch<SetStateAction<MatchDoc | null>>;
  setMpEndOutcome: Dispatch<SetStateAction<MatchOutcome | null>>;
  mpEndOutcome: MatchOutcome | null;
  mpResumeCodeRef: RefObject<string | null>;
  mpSavedGameIdRef: RefObject<string | null>;
  mpWroteOutcomeRef: RefObject<string | null>;
  setMobilePanel: Dispatch<SetStateAction<'none' | 'menu' | 'setup'>>;
  startNewGame: () => void;
}

/**
 * The online match on the board: its live sync with the match doc, the
 * match code kept in localStorage while it is live, and the one reseat
 * into that match after a reload. App calls it before the board state,
 * since nearly everything after reads isMultiplayer.
 */
export function useOnlineMatch({
  user,
  setView,
  setOpponentMode,
  activeMatch,
  setActiveMatch,
  setMpEndOutcome,
  mpEndOutcome,
  mpResumeCodeRef,
  mpSavedGameIdRef,
  mpWroteOutcomeRef,
  setMobilePanel,
  startNewGame,
}: UseOnlineMatchArgs) {
  // Q.B.2: PvP sync. Hook is always called (with null match before any
  // game starts) so React's hook-order rules are respected. Returns null
  // when no match — every consumer guards on isMultiplayer below.
  const mpSync = useMultiplayerSync(
    activeMatch,
    user?.uid ?? null,
    () => {
      // Doc was deleted out from under us — drop back to lobby.
      setActiveMatch(null);
      setMpEndOutcome(null);
      mpSavedGameIdRef.current = null;
      mpWroteOutcomeRef.current = null;
      setMobilePanel('none');
      setView('friend-lobby');
    },
  );
  const isMultiplayer = mpSync !== null;

  // R13b — persist the live match code so a refresh can resume it. The
  // key exists only while a match is genuinely live: it clears when the
  // match ends (outcome modal) or when there's no active match at all.
  useEffect(() => {
    try {
      if (activeMatch && !mpEndOutcome) {
        localData.set(LOCAL_KEYS.mpActive, activeMatch.code);
      } else {
        localData.remove(LOCAL_KEYS.mpActive);
      }
    } catch {
      /* private mode */
    }
  }, [activeMatch, mpEndOutcome]);

  // R13b — one-shot resume: once auth lands, try to re-seat into the
  // match recorded before the refresh. rejoinMatch verifies the seat and
  // liveness; on any failure the key is just dropped (the AFK watchdog
  // may have forfeited us long ago — nothing to resume into).
  useEffect(() => {
    const code = mpResumeCodeRef.current;
    if (!code || !user || activeMatch) return;
    mpResumeCodeRef.current = null;
    void rejoinMatch(code, user.uid)
      .then((match) => {
        startNewGame(); // R15-bug — same solo-world reset as onMatchReady
        setActiveMatch(match);
        setOpponentMode('friend');
        setMobilePanel('none'); // fix/v1.1.4 — show the board, as onMatchReady
        setMpEndOutcome(null);
        mpSavedGameIdRef.current = null;
        mpWroteOutcomeRef.current = null;
        setView('game');
      })
      .catch(() => {
        try {
          localData.remove(LOCAL_KEYS.mpActive);
        } catch {
          /* private mode */
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  return { mpSync, isMultiplayer };
}
