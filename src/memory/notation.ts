import type { Move, MoveKind, PieceType, SquareId, TopologyState } from '../engine';

export class NotationParseError extends Error {}

export interface ParsedToken {
  move: Move;
  requiredTopology?: TopologyState;
  castleSide?: 'king' | 'queen';
  /** The piece letter the token named (none = no letter given). */
  piece?: PieceType;
  /** Which topology a rotation token says it rotates FROM ("A→B" = A). */
  rotationFrom?: TopologyState;
  /** QA-02 — the log's move number and the token as written, so an
   *  import error can say which move it is about. */
  moveNumber: number;
  text: string;
}

function parseChess960Header(lines: string[]): string {
  const header = lines.find((l) => l.startsWith('[Chess960 '));
  if (!header) {
    throw new NotationParseError('Missing [Chess960 "........"] header.');
  }
  const m = header.match(/^\[Chess960\s+"([A-Z]{8})"\]$/);
  if (!m) {
    throw new NotationParseError('Invalid Chess960 header format.');
  }
  return m[1];
}

const PROMO_MAP: Record<string, PieceType> = {
  Q: 'queen', R: 'rook', B: 'bishop', N: 'knight',
};

/**
 * Strip everything our renderer decorates a move with: checkmate '#',
 * check '+', brilliant '!!', blunder '??', mistake '?', best '⭐', and
 * the whole "← Better: … (−123 cp)" tail. The parser only cares about
 * the move itself, never the qualitative tag.
 *
 * The trailing strip is a blacklist of "not part of a move" rather than a
 * whitelist of known markers, because a whitelist keeps losing. A star
 * that has been through a chat client, an emoji keyboard or some
 * clipboards arrives as U+2B50 U+FE0F — the variation selector sits after
 * the star, an anchored `[⭐]+$` no longer reaches the end of the string,
 * and the entire log is rejected with "Could not parse replay log."
 * Every real move token ends in a letter or a digit (e4, =Q, @B, O-O,
 * A→B), so anything else on the end can go, whatever it is.
 */
function stripMarkers(token: string): string {
  return token
    // Drop the "← Better: … " suggestion tail. Accepts the arrow glyph or
    // an ASCII "<-", and both the Stage M "Better:" wording and the
    // pre-Stage-M Ukrainian "краще:" one.
    .replace(/\s*(?:←|<-)\s.*$/u, '')
    // The loss in brackets: "(−123 cp)" from older logs, "(−1.2 pawns)"
    // and "(allows mate)" / "(hangs the king)" from the move list since V1.
    .replace(/\s*\((?:[−-]?\d+(?:\.\d+)?\s*(?:cp|pawns?)|allows mate|hangs the king)\)\s*$/u, '')
    .replace(/[^A-Za-z0-9]+$/u, '')
    .replace(/^[^A-Za-z0-9]+/u, '')
    .trim();
}

const LETTER_PIECE: Record<string, PieceType> = {
  N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king',
};

function parseMoveToken(tokenRaw: string, moveNumber: number): ParsedToken {
  const token = stripMarkers(tokenRaw.trim());
  if (!token) throw new NotationParseError(`Move ${moveNumber}: empty move token.`);

  // Topology toggle: "A→B" or "B→A"
  const rotation = token.match(/^([AB])\s*[→\->]\s*[AB]$/);
  if (rotation) {
    return {
      move: { kind: 'topologyToggle' },
      rotationFrom: rotation[1] as TopologyState,
      moveNumber,
      text: token,
    };
  }

  // Castling: O-O-O or O-O (also accept 0-0-0 / 0-0 numeric form), with
  // optional @A/@B topology suffix.
  const castleMatch = token.match(/^(O-O-O|O-O|0-0-0|0-0)(?:@([AB]))?$/);
  if (castleMatch) {
    const tag = castleMatch[1];
    const side = tag === 'O-O-O' || tag === '0-0-0' ? 'queen' : 'king';
    return {
      move: { kind: 'castle' },
      castleSide: side,
      requiredTopology: castleMatch[2] as TopologyState | undefined,
      moveNumber,
      text: token,
    };
  }

  // Piece move: [NBRQK]?from→to[=QRBN]?[@AB]?
  // Accepts both → and - as separators for robustness.
  const moveMatch = token.match(
    /^([NBRQK])?([a-h][1-8])\s*[→-]\s*([a-h][1-8])(?:=([QRBN]))?(?:@([AB]))?$/,
  );
  if (moveMatch) {
    const [, letter, from, to, promo, topo] = moveMatch;
    const promotion = promo ? PROMO_MAP[promo] : undefined;
    const kind: MoveKind = promotion ? 'promotion' : 'normal';
    return {
      move: {
        from: from as SquareId,
        to: to as SquareId,
        kind,
        ...(promotion ? { promotion } : {}),
      },
      requiredTopology: topo as TopologyState | undefined,
      piece: letter ? LETTER_PIECE[letter] : undefined,
      moveNumber,
      text: token,
    };
  }

  throw new NotationParseError(`Move ${moveNumber}: unrecognized move token "${tokenRaw.trim()}".`);
}

export function parseMemoryNotation(notation: string): { config960: string; moves: ParsedToken[] } {
  const lines = notation
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const config960 = parseChess960Header(lines);

  const moves: ParsedToken[] = [];

  for (const line of lines) {
    const mm = line.match(/^(\d+)\.\s+(.+)$/);
    if (!mm) continue;
    const moveNumber = Number(mm[1]);
    const rest = mm[2];
    const parts = rest.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 1) moves.push(parseMoveToken(parts[0], moveNumber));
    if (parts.length >= 2) moves.push(parseMoveToken(parts[1], moveNumber));
  }

  if (moves.length === 0) {
    throw new NotationParseError('No moves found in notation.');
  }

  return { config960, moves };
}
