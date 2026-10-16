import { useRef, useEffect, useMemo, useState } from 'react';
import { mpClockState, mpClockAt, mpClockHeldFor } from '../../utils/mpClock';
import { serverNow } from '../../firebase/serverClock';
import { drawOfferHolds, turnStartedMs } from '../../firebase/matchEnd';
import {
  OPPONENT_OFFLINE_FORFEIT_MS,
  type MultiplayerSyncHandle,
} from '../../components/MultiplayerGameView';
import type { WatchingGame } from '../review/watching';
import type { GameLog } from '../../recording/log';
import type { GameStatus } from '../../shared/game';
import { session } from '../../session/session';

interface UseGameClocksArgs {
  isMultiplayer: boolean;
  mpSync: MultiplayerSyncHandle | null;
  watchingGame: WatchingGame | null;
  /** The solo game's log (not an online match's): its clocks arm on its first move. */
  soloLog: GameLog;
  gameStatus: GameStatus;
}

/**
 * The game clocks. Solo: the session's clock ticks every 500 ms while a
 * game runs, from the first move (step.ts clockTick charges the side to
 * move; a new log or a control picked before the first move zeroes it). Online: mpClock is read from the match doc's
 * move stamps (server time) and changes only with the doc; the faces tick
 * on their own, and the flag check is a timer, retried through
 * mpFlagRetry when the server refuses a claim. Inside, the effect that
 * resets flagFiredRef for a new match must stay before the flag check.
 */
export function useGameClocks({
  isMultiplayer,
  mpSync,
  watchingGame,
  soloLog,
  gameStatus,
}: UseGameClocksArgs) {

  // V1 — the clocks arm on the FIRST MOVE, always.
  //
  // This used to be `soloTcSec === null || moves.length > 0`, so free play
  // (time control "None") started counting the moment the page loaded or a
  // new game was created. Sitting on a fresh board reading the position is
  // not thinking time you spent, and it made the clock look broken the
  // instant a game began. Picking a control before the first move still
  // zeroes whatever already accumulated, so both sides start whole.
  const clockArmed = soloLog.moves.length > 0;
  useEffect(() => {
    if (gameStatus !== 'active' || watchingGame || !clockArmed) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      session.dispatch({ type: 'clockTick', dt });
    }, 500);
    return () => clearInterval(id);
  }, [gameStatus, watchingGame, soloLog.id, clockArmed]);

  // ── B8: multiplayer time control ──────────────────────────────────
  // Both peers derive identical countdown clocks from the shared move
  // timestamps in the match doc — no extra writes, no sync drift
  // beyond local clock skew. White's first move is free (no reliable
  // "game started" epoch in the doc); every later entry charges the
  // time since the previous entry to its mover. Flag-fall self-forfeits
  // through the existing resign path — same trust model as the AFK
  // watchdog.
  const mpTimeControl =
    isMultiplayer && mpSync && mpSync.matchState.gameMode !== 'roulette'
      ? mpSync.matchState.timeControlSec ?? null
      : null;

  // R13/BUG-2 — MP terminality lives in the MATCH doc, not in the local
  // gameStatus (which stays 'active' for the whole PvP game). Gating the
  // tick and the live-charge on gameStatus kept the loser's clock visibly
  // counting past the end of a finished match.
  const mpMatchLive =
    isMultiplayer && mpSync
      ? mpSync.matchState.status === 'active' && !mpSync.matchState.outcome
      : false;

  // The clocks change only with the match doc; the faces (ClockFace) and
  // the flag check below tick on their own. A `mpNow` state ticked every
  // 500 ms used to re-render the whole App twice a second for this, and
  // stepped the digits on an arbitrary phase (200-1400 ms apart).
  const mpMatchState = mpSync?.matchState ?? null;
  const mpClock = useMemo(
    () => (mpMatchState ? mpClockState(mpMatchState, mpTimeControl, mpMatchLive) : null),
    [mpMatchState, mpTimeControl, mpMatchLive],
  );

  const flagFiredRef = useRef(false);
  const flagRetryAtRef = useRef(0);
  // Bumped only when a refused flag claim is to be retried; every other
  // look at the clocks is a timer inside the effect. Waking through App
  // state re-rendered the whole App at the moment a clock ran out, which
  // held the face's 00:00 back by that render (100-300 ms measured).
  const [mpFlagRetry, setMpFlagRetry] = useState(0);
  useEffect(() => {
    flagFiredRef.current = false;
  }, [mpSync?.matchState.code]);
  useEffect(() => {
    if (!mpClock || !mpSync) return;
    // Only a COUNTDOWN can run out. Since untimed matches got an elapsed
    // clock (V1), the clock exists in every match — and an elapsed clock
    // starts at 0, which the lines below read as "your flag fell". Every
    // untimed match resigned itself the instant it started.
    if (!mpClock.countdown) return;
    if (mpSync.matchState.status !== 'active') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (flagFiredRef.current) return;
      // N-10 — server time, like the move stamps and turnStartedAt.
      const now = serverNow();
      const mine = mpClockAt(mpClock, mpSync.myColor, now);
      if (mine <= 0) {
        flagFiredRef.current = true;
        void mpSync.resign('flag');
        return;
      }
      // R13/BUG-3 — the flagging client may be gone (tab closed): if the
      // OPPONENT's clock hits zero, the waiting peer claims the flag win
      // itself. Same transaction-guarded write local mate detection uses,
      // so a simultaneous self-forfeit can't double-settle the match.
      // QA-05 — the rules cannot see the clock, so they take this claim
      // only once the opponent's turn has run 90 s by server time (R-7:
      // from turnStartedAt, which only a move restarts); until
      // then only their own client can end it. Wait for that, and retry
      // when the server still says no (clock skew). A draw offer they made
      // on that turn holds the claim until I answer it (drawOfferHolds).
      const theirs = mpClockAt(mpClock, mpSync.myColor === 'white' ? 'black' : 'white', now);
      let wake: number;
      if (theirs > 0) {
        if (!mpClock.running) return;
        // Until the running clock reaches 0; a new snapshot re-runs this.
        wake =
          mpClockHeldFor(mpClock, mpClock.running, now) + mpClockAt(mpClock, mpClock.running, now);
      } else {
        if (drawOfferHolds(mpSync.matchState)) return;
        const last = turnStartedMs(mpSync.matchState);
        if (typeof last === 'number' && now - last < OPPONENT_OFFLINE_FORFEIT_MS) {
          wake = last + OPPONENT_OFFLINE_FORFEIT_MS - now;
        } else if (now < flagRetryAtRef.current) {
          wake = flagRetryAtRef.current - now;
        } else {
          flagFiredRef.current = true;
          const opponentIsHost = mpSync.matchState.host.uid !== mpSync.myUid;
          void mpSync
            .writeOutcomeIfFirst(opponentIsHost ? 'host-resign' : 'guest-resign', 'flag')
            .then((ok) => {
              if (ok) return;
              flagRetryAtRef.current = serverNow() + 4000;
              flagFiredRef.current = false;
              setMpFlagRetry((n) => n + 1);
            });
          return;
        }
      }
      // A little after the face's own wake (15 ms): the face paints 00:00
      // first, then the flag write re-renders App.
      timer = setTimeout(check, wake + 50);
    };
    check();
    return () => clearTimeout(timer);
  }, [mpClock, mpSync, mpFlagRetry]);
  return { mpMatchLive, mpClock };
}
