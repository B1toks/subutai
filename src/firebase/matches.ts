import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './client';
import { createStartingPosition, type Move, type SquareId } from '../engine';
import type { PieceType, TopologyState } from '../engine/types';
import type { DrawOffer } from '../utils/drawOffer';

// R13 cleanup: 'abandoned' removed — nothing ever wrote it (verified against
// prod: statuses in the wild are waiting/active/completed only).
export type MatchStatus = 'waiting' | 'active' | 'completed';
export type MatchOutcome =
  | 'white-win'
  | 'black-win'
  | 'draw'
  | 'host-resign'
  | 'guest-resign';

export type MatchGameMode = 'classic' | 'roulette';

/** QA-04 — why a match ended in 'host-resign' / 'guest-resign': the
 *  Resign button, the inactivity forfeit, or a flag fall. 'agreement' is
 *  a 'draw': the other player accepted a draw offer. */
export type MatchEndReason = 'resign' | 'inactive' | 'flag' | 'agreement';

export interface MatchParticipant {
  uid: string;
  displayName: string;
  color: 'white' | 'black';
}

interface SavedMove {
  san?: string;
  move: Move;
  topology?: TopologyState;
  timestamp: number;
}

export interface MatchDoc {
  code: string;
  chess960Id: string;
  seed: number;
  host: MatchParticipant;
  guest: MatchParticipant | null;
  status: MatchStatus;
  currentTurn: string;
  log: { initialTopology: TopologyState; moves: SavedMove[] };
  outcome: MatchOutcome | null;
  /** QA-04 — set with a resign outcome, or 'agreement' with a draw;
   *  absent on matches ended by older clients and on every other outcome. */
  endReason?: MatchEndReason;
  /** The last draw offer, { by: uid, atPly: log length }. It stands only
   *  while the log is that long (src/utils/drawOffer.ts), so a move
   *  retires it even when the mover's client leaves the field alone.
   *  Absent on matches nobody offered a draw in, and on older docs. */
  drawOffer?: DrawOffer | null;
  createdAt: Timestamp;
  lastActivity: Timestamp;
  /** R-7 — server time the turn on the clock started: the join, then each
   *  appended move. firestore.rules measures the 90 s of inactivity from
   *  it. Absent on matches from before it (and before the join). */
  turnStartedAt?: Timestamp;
  // Stage Q.D — optional so old docs keep working. Treated as 'classic'
  // / null / {} when absent.
  gameMode?: MatchGameMode;
  /** B8 — per-side clock budget in seconds; null/absent = untimed.
   *  Clocks are derived client-side from move timestamps (both peers
   *  compute identically from the shared log), flag-fall self-forfeits
   *  through the existing resign path. */
  timeControlSec?: number | null;
  /** R13 — Fischer increment in seconds, credited to the mover after
   *  each completed move. null/absent = no increment (old docs). */
  timeIncrementSec?: number | null;
  /** Stage Q.D.3: full solo parity — one spin yields a slot bag of
   *  ROULETTE_SLOT_COUNT piece types and the on-clock player gets
   *  ROULETTE_MAX_ACTIONS actions to spend. Each move consumes a
   *  matching slot; rotates spend an action without consuming a slot. */
  rouletteSlots?: PieceType[] | null;
  /** Actions remaining this turn. 0 between turns / pre-spin. */
  rouletteActionsLeft?: number;
  /** Indices into rouletteSlots already consumed by moves this turn. */
  usedRouletteSlots?: number[];
  /** Per-player spin counter for the first-spin-manual gate
   *  (subsequent spins auto-fire after a short delay). */
  rouletteSpinsByPlayer?: Record<string, number>;
  /** Total spin count across both players. Drives the pawn-bias window
   *  (first 3 spins per match weight pawn slightly higher) so MP roulette
   *  matches the solo ease-in behaviour. */
  rouletteSpinCount?: number;
}

/** Crockford-ish alphabet: removed 0/O/I/1 to keep typed codes unambiguous. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;
const MAX_COLLISION_RETRIES = 6;

export function generateMatchCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Normalize user-typed input — strip spaces, uppercase. Keep the
 *  alphabet check loose: invalid codes will simply miss in Firestore. */
export function normalizeMatchCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Create a new waiting-room match. Picks an unused 6-char code, generates a
 * random chess960 position, and randomly assigns the host's color. Returns
 * the chosen code so the host can share it.
 */
export async function createMatch(
  host: { uid: string; displayName: string },
  gameMode: MatchGameMode = 'classic',
  timeControlSec: number | null = null,
  timeIncrementSec: number | null = null,
): Promise<string> {
  // Vanishingly rare for 32^6 (~10^9) codes, but bound the loop just in case
  // someone runs a botnet flooding /matches.
  let code = '';
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const candidate = generateMatchCode();
    const existing = await getDoc(doc(db, 'matches', candidate));
    if (!existing.exists()) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new Error('MATCH_CODE_COLLISION');

  await setDoc(
    doc(db, 'matches', code),
    buildMatchDocPayload(host, code, gameMode, timeControlSec, timeIncrementSec),
  );

  return code;
}

/** Fresh waiting-room match payload. Shared between createMatch and the
 *  R16 quick-match claim transaction so the doc shape can't drift. */
export function buildMatchDocPayload(
  host: { uid: string; displayName: string },
  code: string,
  gameMode: MatchGameMode = 'classic',
  timeControlSec: number | null = null,
  timeIncrementSec: number | null = null,
): Record<string, unknown> {
  // Use the timestamp as the chess960 seed — keeps replays deterministic
  // for the same match.
  const seed = Date.now();
  const chess960Id = chess960IdFromSeed(seed);
  const hostColor: 'white' | 'black' = Math.random() < 0.5 ? 'white' : 'black';
  return {
    code,
    chess960Id,
    seed,
    host: { uid: host.uid, displayName: host.displayName, color: hostColor },
    guest: null,
    status: 'waiting',
    currentTurn: '',
    log: { initialTopology: 'A', moves: [] },
    outcome: null,
    gameMode,
    timeControlSec,
    timeIncrementSec,
    rouletteSlots: null,
    rouletteActionsLeft: 0,
    usedRouletteSlots: [],
    rouletteSpinsByPlayer: {},
    rouletteSpinCount: 0,
    createdAt: serverTimestamp(),
    lastActivity: serverTimestamp(),
  };
}

/**
 * Join an existing waiting-room match. Wrapped in a transaction so two guests
 * can't both claim the seat. On success, status flips to 'active' and the
 * white-color player becomes currentTurn.
 */
export async function joinMatch(
  code: string,
  guest: { uid: string; displayName: string },
): Promise<MatchDoc> {
  const matchRef = doc(db, 'matches', code);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(matchRef);
    if (!snap.exists()) throw new Error('MATCH_NOT_FOUND');
    const data = snap.data() as MatchDoc;
    if (data.status !== 'waiting') throw new Error('MATCH_NOT_AVAILABLE');
    if (data.host.uid === guest.uid) throw new Error('CANNOT_JOIN_OWN_MATCH');

    const guestColor: 'white' | 'black' =
      data.host.color === 'white' ? 'black' : 'white';
    const guestEntry: MatchParticipant = {
      uid: guest.uid,
      displayName: guest.displayName,
      color: guestColor,
    };
    const currentTurn =
      data.host.color === 'white' ? data.host.uid : guest.uid;

    tx.update(matchRef, {
      guest: guestEntry,
      status: 'active',
      currentTurn,
      lastActivity: serverTimestamp(),
      turnStartedAt: serverTimestamp(),
    });

    return {
      ...data,
      guest: guestEntry,
      status: 'active',
      currentTurn,
    };
  });
}

/**
 * R13b — resume a match this uid already sits in (page refresh, tab
 * crash). Read-only: unlike joinMatch it claims nothing, it just
 * verifies the seat and returns the live doc so App can re-mount the
 * sync hook. Throws MATCH_NOT_FOUND / NOT_PARTICIPANT / MATCH_OVER.
 */
export async function rejoinMatch(code: string, uid: string): Promise<MatchDoc> {
  const snap = await getDoc(doc(db, 'matches', code));
  if (!snap.exists()) throw new Error('MATCH_NOT_FOUND');
  const data = snap.data() as MatchDoc;
  if (data.host.uid !== uid && data.guest?.uid !== uid) {
    throw new Error('NOT_PARTICIPANT');
  }
  if (data.status !== 'active' && data.status !== 'waiting') {
    throw new Error('MATCH_OVER');
  }
  return data;
}

export function subscribeMatch(
  code: string,
  onChange: (doc: MatchDoc | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, 'matches', code), (snap) => {
    if (!snap.exists()) {
      onChange(null);
      return;
    }
    onChange(snap.data() as MatchDoc);
  });
}

// Derive the canonical back-rank string ("RNBQKBNR" etc) so the doc carries
// the same chess960 identifier the rest of the app uses. Lets the peer just
// re-run createPositionFromBackRankKey(chess960Id) to reconstruct the layout.
function chess960IdFromSeed(seed: number): string {
  const state = createStartingPosition(seed);
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const abbrev: Record<string, string> = {
    rook: 'R',
    knight: 'N',
    bishop: 'B',
    queen: 'Q',
    king: 'K',
  };
  return files
    .map((f) => {
      const piece = state.pieces[`${f}1` as SquareId];
      return piece ? abbrev[piece.type] ?? '?' : '?';
    })
    .join('');
}
