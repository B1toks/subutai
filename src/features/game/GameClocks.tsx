import { ClockFace } from './ClockFace';
import { serverNow } from '../../firebase/serverClock';
import { useSession } from '../../session/useSession';
import type { MpClockState } from '../../utils/mpClock';
import { boardOf } from './boardView';

interface GameClocksProps {
  isMultiplayer: boolean;
  /** The match's clock while one is played here (useGameClocks), else null. */
  mpClock: MpClockState | null;
  /** The colour this seat plays (useEval): its clock is lit as "mine". */
  myColor: 'white' | 'black';
}

/**
 * The tournament clock above the board: two faces, the side to move's
 * running. Solo it shows the session's elapsed time (S2.5: the side to
 * move's clock runs while the game is live, useGameClocks ticks the
 * session, a new log starts both from zero), or the time left under a
 * time control; online each face reads the match clock itself
 * (ClockFace, serverNow). App renders it while a game runs and nothing is
 * being watched. Order does not matter.
 */
export function GameClocks({ isMultiplayer, mpClock, myColor }: GameClocksProps) {
  const state = useSession(boardOf(isMultiplayer));
  const clockMs = useSession((s) => s.clock);
  const soloTcSec = useSession((s) => s.timeControlSec);
  return (
    <div className="tournament-clock" aria-label="Game clocks">
      {(['white', 'black'] as const).map((side) => {
        const soloCountdown = mpClock === null && soloTcSec !== null;
        // V1 — the running half is lit in the theme accent when it is
        // YOUR clock and in the opponent accent when it is not, so the
        // two are never confusable at a glance. Online it follows the
        // colour you were actually dealt; in hot-seat nobody is "you",
        // so the two seats simply get the two colours.
        const mine = side === myColor;
        return (
          <ClockFace
            key={side}
            side={side}
            running={state.sideToMove === side}
            mine={mine}
            countdown={mpClock ? mpClock.countdown : soloCountdown}
            ms={
              soloCountdown
                ? Math.max(0, soloTcSec * 1000 - clockMs[side])
                : clockMs[side]
            }
            mp={mpClock ? { clock: mpClock, now: serverNow } : null}
          />
        );
      })}
    </div>
  );
}
