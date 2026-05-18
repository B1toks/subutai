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

export type MatchStatus = 'waiting' | 'active' | 'completed' | 'abandoned';
export type MatchOutcome =
  | 'white-win'
  | 'black-win'
  | 'draw'
  | 'host-resign'
  | 'guest-resign';

export type MatchGameMode = 'classic' | 'roulette';

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
  createdAt: Timestamp;
  lastActivity: Timestamp;
  // Stage Q.D — optional so old docs keep working. Treated as 'classic'
  // / null / {} when absent.
  gameMode?: MatchGameMode;
  /** Non-null when the on-clock player has spun and must now move that
   *  piece type. Cleared back to null after the move is committed. */
  currentRoulettePiece?: PieceType | null;
  /** Per-player spin counter for the first-spin-manual gate
   *  (subsequent spins auto-fire after a short delay). */
  rouletteSpinsByPlayer?: Record<string, number>;
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

  // Use the timestamp as the chess960 seed — keeps replays deterministic
  // for the same match.
  const seed = Date.now();
  const chess960Id = chess960IdFromSeed(seed);
  const hostColor: 'white' | 'black' = Math.random() < 0.5 ? 'white' : 'black';

  await setDoc(doc(db, 'matches', code), {
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
    currentRoulettePiece: null,
    rouletteSpinsByPlayer: {},
    createdAt: serverTimestamp(),
    lastActivity: serverTimestamp(),
  });

  return code;
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
    });

    return {
      ...data,
      guest: guestEntry,
      status: 'active',
      currentTurn,
    };
  });
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
