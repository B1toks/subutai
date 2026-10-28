import type { Store } from '../store';
import type { Action, SessionEvent, SessionState } from '../types';
import type { Player, Seats } from './types';
import { revealOf } from '../step';

type SessionStore = Store<SessionState, Action, SessionEvent>;

export interface Turns {
  /** Who plays each side from now on (null: nobody, e.g. a replay is
   *  being watched). A side whose player changed loses the turn it had. */
  seat(seats: Seats | null): void;
  /** A player at this device acts: runs `action` now if the side to move
   *  is seated here as a human (or as chat, whose seat the streamer shares)
   *  and the game is on; returns what happened (nothing: not theirs to do,
   *  or the session refused it). */
  act(action: Action): readonly SessionEvent[];
  /** The side to move's player, if it is seated here. */
  toMove(): Player | null;
  stop(): void;
}

/** What makes one turn: a new board, phase, bag, mode or game is a new
 *  question for the player; a clock tick or a classifier's verdict is not. */
interface TurnKey {
  readonly board: SessionState['board'];
  readonly phase: SessionState['phase'];
  readonly bag: SessionState['roulette']['bag'];
  readonly mode: SessionState['mode'];
  readonly logId: string;
  readonly player: Player;
}

/** The board whose turn it is: an online match's while the session follows
 *  one (session/online.ts), else the session's own game. */
const boardOf = (s: SessionState) => s.online?.game?.board ?? s.board;

/** An online match is over when its document says so; it never ends the
 *  session's own game. */
const isOver = (s: SessionState) =>
  s.online?.game ? s.online.doc.status !== 'active' || !!s.online.doc.outcome : s.phase.tag === 'ended';

const keyOf = (s: SessionState, player: Player): TurnKey => ({
  board: boardOf(s),
  phase: s.phase,
  bag: s.roulette.bag,
  mode: s.mode,
  logId: s.log.id,
  player,
});

const sameKey = (a: TurnKey, b: TurnKey) =>
  a.board === b.board && a.phase === b.phase && a.bag === b.bag && a.mode === b.mode &&
  a.logId === b.logId && a.player === b.player;

/**
 * The turns of the game in `store`: whenever it is a seated side's turn,
 * its player is asked for an action (Player.onTurn) and the answer is
 * dispatched, unless the turn ended first. One turn is open at a time.
 */
export function createTurns(store: SessionStore): Turns {
  let seats: Seats | null = null;
  let open: { key: TurnKey; ctrl: AbortController } | null = null;

  // While a Roulette bag lands (RouletteReveal) the turn waits: nobody,
  // bot or human, may act until it is the side's.
  const playerOf = (s: SessionState): Player | null =>
    isOver(s) || !seats || revealOf(s) ? null : seats[boardOf(s).sideToMove];

  function close() {
    open?.ctrl.abort();
    open = null;
  }

  function refresh() {
    const s = store.getState();
    const player = playerOf(s);
    if (!player) {
      close();
      return;
    }
    const key = keyOf(s, player);
    if (open && sameKey(open.key, key)) return;
    close();
    const ctrl = new AbortController();
    const turn = { key, ctrl };
    open = turn;
    player.onTurn(s, ctrl.signal).then(
      (action) => {
        if (ctrl.signal.aborted || open !== turn) return;
        // The turn is answered, not aborted: what the action starts (the
        // next side's turn) opens as the session runs it. A refused action
        // leaves the board as it was, and the player is not asked again
        // for the same turn: the bot used to stall the same way.
        open = null;
        const before = store.getState();
        const events = store.dispatch(action);
        if (store.getState() === before && open === null) open = turn;
        player.onPlayed?.(action, events);
      },
      () => {
        // Aborted, or the player gave up on the turn: nothing to run.
      },
    );
  }

  const unsubscribe = store.subscribe(refresh);

  return {
    seat(next) {
      seats = next;
      refresh();
    },
    act(action) {
      const player = playerOf(store.getState());
      if (!player || (player.kind !== 'human' && player.kind !== 'chat')) return [];
      return store.dispatch(action);
    },
    toMove: () => playerOf(store.getState()),
    stop() {
      unsubscribe();
      close();
      seats = null;
    },
  };
}
