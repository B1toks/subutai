import type { Move } from '../engine';

export class NotationParseError extends Error {}

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

function parseMoveToken(tokenRaw: string): Move {
  const token = tokenRaw.trim();
  if (!token) throw new NotationParseError('Empty move token.');

  // Topology toggle token like "A→B" or "B→A"
  if (/^[AB]\s*→\s*[AB]$/.test(token)) {
    return { kind: 'topologyToggle' };
  }

  // Square move token like "e2→e4" with optional "@B" topology marker.
  const m = token.match(/^([a-h][1-8])\s*→\s*([a-h][1-8])(?:@[AB])?$/);
  if (!m) {
    throw new NotationParseError(`Unrecognized move token: "${tokenRaw}"`);
  }
  return { from: m[1] as any, to: m[2] as any, kind: 'normal' };
}

export function parseMemoryNotation(notation: string): { config960: string; moves: Move[] } {
  const lines = notation
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const config960 = parseChess960Header(lines);

  const moves: Move[] = [];

  for (const line of lines) {
    const mm = line.match(/^(\d+)\.\s+(.+)$/);
    if (!mm) continue;
    const rest = mm[2];
    // White and black tokens are separated by 2+ spaces in our formatter.
    const parts = rest.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 1) moves.push(parseMoveToken(parts[0]));
    if (parts.length >= 2) moves.push(parseMoveToken(parts[1]));
  }

  if (moves.length === 0) {
    throw new NotationParseError('No moves found in notation.');
  }

  return { config960, moves };
}

