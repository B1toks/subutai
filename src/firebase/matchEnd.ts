import type { MatchDoc } from './matches';

/**
 * QA-04 — does the inactivity forfeit apply to this match right now?
 *
 * A match with a clock already ends itself when a player runs out of time
 * (App's flag-fall, which either peer can claim), so forfeiting after 90 s
 * of thinking with minutes left on that clock took away time the player
 * had. The one gap is before White's first move: the clocks only start
 * with it, so a White who never moves would stall the match forever, and
 * the 90 s rule still covers that.
 */
export function inactivityForfeitApplies(match: MatchDoc): boolean {
  const timed = match.gameMode !== 'roulette' && !!match.timeControlSec;
  return !timed || match.log.moves.length === 0;
}

/**
 * QA-04 / N-4 — why a match ended with 'host-resign' / 'guest-resign'.
 *
 * The match doc cannot say: a resignation, a flag fall and an inactivity
 * forfeit all write the same outcome (the value set is fixed by the
 * Firestore rules). With a clock, the time left on the loser's clock when
 * the match ended tells a flag fall from a resignation, and the inactivity
 * forfeit does not apply once the clock runs. Without one there is no way
 * to tell, and the text has to say both.
 */
export function mpResignCause(match: MatchDoc): 'timeout' | 'resign' | 'unknown' {
  if (match.outcome !== 'host-resign' && match.outcome !== 'guest-resign') return 'unknown';
  if (inactivityForfeitApplies(match)) return 'unknown';
  const loser = match.outcome === 'host-resign' ? match.host.color : match.guest?.color;
  if (!loser || !match.timeControlSec) return 'resign';
  const moves = match.log.moves;
  // A write still in flight has no server stamp yet; it is happening now.
  const endMs = match.lastActivity?.toMillis?.() ?? Date.now();
  // Same accounting as mpClocks: entries alternate W,B,W,B…, White's first
  // move is free, every later entry charges the time since the previous one.
  let used = 0;
  for (let i = 1; i < moves.length; i++) {
    const mover = i % 2 === 0 ? 'white' : 'black';
    if (mover === loser) used += Math.max(0, (moves[i].timestamp ?? 0) - (moves[i - 1].timestamp ?? 0));
  }
  // Only the side to move has a running clock, so only it can flag; a
  // player resigning on the opponent's turn resigned, however little time
  // they had.
  const toMove = moves.length % 2 === 0 ? 'white' : 'black';
  if (toMove !== loser) return 'resign';
  used += Math.max(0, endMs - (moves[moves.length - 1].timestamp ?? endMs));
  const loserMoves = loser === 'white' ? Math.ceil(moves.length / 2) : Math.floor(moves.length / 2);
  const left = match.timeControlSec * 1000 + loserMoves * (match.timeIncrementSec ?? 0) * 1000 - used;
  // The flag is claimed by a client the moment its clock reads 0 (polled
  // twice a second); the server stamps the end a moment later. Allow for
  // that and for clock skew between the players' machines.
  return left <= 3000 ? 'timeout' : 'resign';
}
