import type { Move, MoveKind, PieceType, SquareId, TopologyState } from '../engine';

export class NotationParseError extends Error {}

export interface ParsedToken {
  move: Move;
  requiredTopology?: TopologyState;
  castleSide?: 'king' | 'queen';
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

/** Strip annotation markers our renderer appends to SAN: checkmate '#',
 *  brilliant '!!', blunder '??', mistake '?', best '⭐'. The parser only
 *  cares about the move itself, not the qualitative tag. */
function stripMarkers(token: string): string {
  return token
    // Drop the entire "← Better: ... (−123 cp)" suggestion tail. Matches
    // any arrow-prefixed annotation (handles both Stage M's "Better:" and
    // pre-Stage-M Ukrainian "краще:" wording for back-compat).
    .replace(/\s*←\s.*$/u, '')
    .replace(/\s*\(−\d+\s*cp\)\s*$/u, '')
    .replace(/[!?#+★⭐]+$/u, '')
    .trim();
}

function parseMoveToken(tokenRaw: string): ParsedToken {
  const token = stripMarkers(tokenRaw.trim());
  if (!token) throw new NotationParseError('Empty move token.');

  // Topology toggle: "A→B" or "B→A"
  if (/^[AB]\s*[→\-\>]\s*[AB]$/.test(token)) {
    return { move: { kind: 'topologyToggle' } };
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
    };
  }

  // Piece move: [NBRQK]?from→to[=QRBN]?[@AB]?
  // Accepts both → and - as separators for robustness.
  const moveMatch = token.match(
    /^([NBRQK])?([a-h][1-8])\s*[→\-]\s*([a-h][1-8])(?:=([QRBN]))?(?:@([AB]))?$/,
  );
  if (moveMatch) {
    const [, , from, to, promo, topo] = moveMatch;
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
    };
  }

  throw new NotationParseError(`Unrecognized move token: "${tokenRaw}"`);
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
    const rest = mm[2];
    const parts = rest.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 1) moves.push(parseMoveToken(parts[0]));
    if (parts.length >= 2) moves.push(parseMoveToken(parts[1]));
  }

  if (moves.length === 0) {
    throw new NotationParseError('No moves found in notation.');
  }

  return { config960, moves };
}
