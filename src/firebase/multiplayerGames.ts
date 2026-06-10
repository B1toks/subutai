import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './client';
import type { MatchDoc, MatchOutcome, MatchParticipant } from './matches';
import type { GameOutcome, GamePoints } from '../analysis/points';

/**
 * Persist a finished PvP match to /games so both players keep a record they
 * can replay from Memory. Crucially:
 *   - vsAI: false → never enters the classic leaderboard query
 *   - points are explicitly zero so even if some future code path forgets to
 *     filter by vsAI, PvP wins can't inflate any player's bestGamePoints
 *   - opponentId / opponentName let the row render "vs X" later
 *
 * Called from MultiplayerGameView when the match transitions to completed.
 * Only one peer should call this (we pick host) to avoid two near-duplicate
 * docs in /games; the contract is enforced by the caller, not the rules.
 */
export async function saveMultiplayerGameToGames(
  match: MatchDoc,
): Promise<void> {
  if (!match.guest || !match.outcome) return;

  const moveCount = Math.floor(match.log.moves.length / 2);
  const hostOutcome = translateOutcomeForPlayer(match.outcome, match.host);

  await addDoc(collection(db, 'games'), {
    playerId: match.host.uid,
    playerName: match.host.displayName,
    opponentId: match.guest.uid,
    opponentName: match.guest.displayName,
    chess960Id: match.chess960Id,
    seed: match.seed,
    humanColor: match.host.color,
    log: {
      initialTopology: match.log.initialTopology,
      moves: match.log.moves,
    },
    outcome: hostOutcome,
    moveCount,
    points: zeroPoints(moveCount),
    matchCode: match.code,
    vsAI: false,
    // Q.D.8: persist the rules the match was played under so retro-analysis
    // matches reality (roulette → no-check classifier).
    gameMode: match.gameMode ?? 'classic',
    createdAt: serverTimestamp(),
  });
}

/** Map a MatchOutcome (stored at match level) into the host's perspective
 *  using the existing GameOutcome vocabulary so the rest of the app's
 *  review / display code keeps working unchanged. */
export function translateOutcomeForPlayer(
  outcome: MatchOutcome,
  player: MatchParticipant,
): GameOutcome {
  if (outcome === 'draw') return 'draw';
  if (outcome === 'host-resign') {
    return player.color === 'white' ? 'human-resign' : 'human-win';
  }
  if (outcome === 'guest-resign') {
    return player.color === 'white' ? 'human-win' : 'human-resign';
  }
  // Color outcomes (white-win / black-win): "I won" if my color matches.
  const winColor = outcome === 'white-win' ? 'white' : 'black';
  return player.color === winColor ? 'human-win' : 'ai-win';
}

function zeroPoints(moveCount: number): GamePoints {
  return {
    movePoints: 0,
    capturePoints: 0,
    qualityPoints: 0,
    rotationPoints: 0,
    outcomeBonus: 0,
    total: 0,
    moveCount,
    captureValueCp: 0,
    moveQualityCounts: {
      brilliant: 0,
      best: 0,
      good: 0,
      mistake: 0,
      blunder: 0,
    },
    counted: false,
  };
}
