import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { db } from './client';
import type { MatchDoc, MatchOutcome, MatchParticipant } from './matches';
import type { GameOutcome, GamePoints } from '../analysis/points';

/**
 * Persist a finished PvP match to /games so the player keeps a record they
 * can replay from Memory. Crucially:
 *   - vsAI: false → never enters the classic leaderboard query
 *   - points are explicitly zero so even if some future code path forgets to
 *     filter by vsAI, PvP wins can't inflate any player's bestGamePoints
 *   - opponentId / opponentName let the row render "vs X" later
 *
 * R13 host-gone fix: EACH peer saves their OWN record (their perspective,
 * their playerId) instead of the old host-only single doc — a host who
 * closes the tab at game end no longer costs the guest their record. The
 * deterministic id mp-{code}-{uid} + setDoc makes retries idempotent: a
 * second write to the same id is an UPDATE, which /games rules deny, and
 * we swallow exactly that error. (Rules also require playerId == auth.uid,
 * so a peer can only ever create their own copy.)
 */
export async function saveMultiplayerGameToGames(
  match: MatchDoc,
  myUid: string,
): Promise<void> {
  if (!match.guest || !match.outcome) return;
  const me = match.host.uid === myUid ? match.host : match.guest;
  const opponent = match.host.uid === myUid ? match.guest : match.host;
  if (me.uid !== myUid) return; // spectator/foreign uid — nothing to save

  const moveCount = Math.floor(match.log.moves.length / 2);
  const myOutcome = translateOutcomeForPlayer(match.outcome, me, match.host.uid);
  const ref = doc(db, 'games', `mp-${match.code}-${myUid}`);

  try {
    await setDoc(ref, {
      playerId: me.uid,
      playerName: me.displayName,
      opponentId: opponent.uid,
      opponentName: opponent.displayName,
      chess960Id: match.chess960Id,
      seed: match.seed,
      humanColor: me.color,
      log: {
        initialTopology: match.log.initialTopology,
        moves: match.log.moves,
      },
      outcome: myOutcome,
      moveCount,
      points: zeroPoints(moveCount),
      matchCode: match.code,
      vsAI: false,
      // Q.D.8: persist the rules the match was played under so retro-analysis
      // matches reality (roulette → no-check classifier).
      gameMode: match.gameMode ?? 'classic',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Doc already exists (this device or another one raced us) → the denied
    // UPDATE is the idempotency signal, not a failure. QA-22: but only when
    // the doc really is there; any other refusal (a roulette log over the
    // rule's 700 entries, say) is a real failure and is rethrown.
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      const existing = await getDoc(ref).catch(() => null);
      if (existing?.exists() && existing.data().playerId === myUid) return;
    }
    throw err;
  }
}

/** Map a MatchOutcome (stored at match level) into one player's
 *  perspective using the existing GameOutcome vocabulary so the rest of
 *  the app's review / display code keeps working unchanged.
 *
 *  R13/BUG-1 fix: resign/forfeit outcomes are stored by ROLE
 *  (host-resign / guest-resign), and host color is randomized at match
 *  creation — so they must be resolved against the host's uid, never
 *  against the player's color. Keying off color inverted the result in
 *  every match where the host drew Black (~half of them). */
export function translateOutcomeForPlayer(
  outcome: MatchOutcome,
  player: MatchParticipant,
  hostUid: string,
): GameOutcome {
  if (outcome === 'draw') return 'draw';
  const isHost = player.uid === hostUid;
  if (outcome === 'host-resign') {
    return isHost ? 'human-resign' : 'human-win';
  }
  if (outcome === 'guest-resign') {
    return isHost ? 'human-win' : 'human-resign';
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
