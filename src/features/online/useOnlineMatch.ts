import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import { useMultiplayerSync } from './useMultiplayerSync';
import type { MatchDoc, MatchOutcome } from '../../firebase/matches';
import { matchesRepo } from '../../infra/firestore/matches';
import { localData, LOCAL_KEYS } from '../../infra/localData';

interface UseOnlineMatchArgs {
  user: User | null;
  setView: Dispatch<SetStateAction<'game' | 'review' | 'leaderboard' | 'friend-lobby'>>;
  setOpponentMode: Dispatch<SetStateAction<'ai' | 'friend' | 'local'>>;
  setMobilePanel: Dispatch<SetStateAction<'none' | 'menu' | 'setup'>>;
  startNewGame: () => void;
}

/**
 * The online match on the board, and its state: the match (activeMatch),
 * its live sync with the match doc, how it ended here (mpEndOutcome, the
 * result dialog), the markers of what this tab has written for it (the
 * outcome, the /games record), whether this tab resigned it, the match
 * code kept in localStorage while it is live, and the one reseat into
 * that match after a reload. App calls it before the board state, since
 * nearly everything after reads isMultiplayer. The match's end
 * (useOnlineMatchEnd), the lobby, the result dialog and Resign take the
 * whole object.
 */
export function useOnlineMatch({
  user,
  setView,
  setOpponentMode,
  setMobilePanel,
  startNewGame,
}: UseOnlineMatchArgs) {
  // Q.B.2: active PvP match handshake. When non-null, the rest of App
  // sources its board / log / turn state from useMultiplayerSync below
  // instead of the local engine.
  const [activeMatch, setActiveMatch] = useState<MatchDoc | null>(null);
  // Match-completion modal state (separate from the AI GameSummary which
  // is points-driven and doesn't fit the PvP shape).
  const [mpEndOutcome, setMpEndOutcome] = useState<MatchOutcome | null>(null);
  // R13b — reconnect after a refresh. The active match code is read ONCE
  // at mount (the persistence effect below clears the key whenever
  // activeMatch is null, so reading it lazily later would lose the race).
  const mpResumeCodeRef = useRef<string | null>(
    (() => {
      try {
        return localData.get(LOCAL_KEYS.mpActive);
      } catch {
        return null;
      }
    })(),
  );
  const mpSavedGameIdRef = useRef<string | null>(null);
  const mpWroteOutcomeRef = useRef<string | null>(null);
  // QA-04 — the match code this player resigned themselves (the Resign
  // button, not a flag fall), so their own end text can say so. A state,
  // not a ref: the result dialog reads it while rendering.
  const [mpSelfResigned, setMpSelfResigned] = useState<string | null>(null);
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
    void matchesRepo.rejoin(code, user.uid)
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
  return {
    mpSync,
    isMultiplayer,
    activeMatch,
    setActiveMatch,
    mpEndOutcome,
    setMpEndOutcome,
    mpResumeCodeRef,
    mpSavedGameIdRef,
    mpWroteOutcomeRef,
    mpSelfResigned,
    setMpSelfResigned,
  };
}
