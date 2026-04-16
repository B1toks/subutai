import type { BoardState } from '../engine';
import { applyMove } from '../engine/moves';
import { applyRotationMove } from '../engine/auxetic';
import { PIECE_VALUE } from '../ai/evaluate';
import type { GameLog } from '../recording/log';
import { computeSAN } from '../recording/log';
import type { SavedGame } from './types';
import type { PieceType } from '../engine';

function backRankString(boardState: BoardState): string {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const abbrev: Record<string, string> = {
    rook: 'R', knight: 'N', bishop: 'B', queen: 'Q', king: 'K',
  };
  return files
    .map((f) => {
      const piece = boardState.pieces[`${f}1` as import('../engine').SquareId];
      return piece ? abbrev[piece.type] ?? '?' : '?';
    })
    .join('');
}

function materialScore(state: BoardState): number {
  let white = 0;
  let black = 0;
  for (const piece of Object.values(state.pieces)) {
    if (!piece) continue;
    const v = PIECE_VALUE[piece.type as PieceType];
    if (piece.color === 'white') white += v;
    else black += v;
  }
  return white - black;
}

function buildNotation(log: GameLog, config960: string): string {
  const lines: string[] = [
    `[Chess960 "${config960}"]`,
    `[Seed "${log.randomSeed}"]`,
    '',
  ];
  let current: BoardState = log.initialState;
  const entries = log.moves;
  for (let i = 0; i < entries.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const white = entries[i];
    const black = entries[i + 1];

    function fmt(entry: typeof white): string {
      let san = entry.san;
      if (!san) {
        san = computeSAN(current, entry.move);
      }
      if (entry.move.kind !== 'topologyToggle' && entry.topology === 'B') {
        if (!san.includes('@')) san += '@B';
      }
      if (entry.move.kind === 'topologyToggle') {
        current = applyRotationMove(current);
      } else if (entry.move.from && entry.move.to) {
        current = applyMove(current, entry.move);
      }
      return san;
    }

    let line = `${moveNum}. ${fmt(white)}`;
    if (black) line += `  ${fmt(black)}`;
    lines.push(line);
  }
  return lines.join('\n');
}

function buildBaseFromLog(
  log: GameLog,
): {
  config960: string;
  movesInA: number;
  movesInB: number;
  scoreHistory: number[];
  moves: SavedGame['moves'];
  notation: string;
} {
  const config960 = backRankString(log.initialState);
  let movesInA = 0;
  let movesInB = 0;
  let topo = log.initialTopology;
  for (const entry of log.moves) {
    const t = entry.topology ?? topo;
    if (t === 'A') movesInA++;
    else movesInB++;
    if (entry.move.kind === 'topologyToggle') topo = topo === 'A' ? 'B' : 'A';
  }

  const scoreHistory: number[] = [];
  let current: BoardState = log.initialState;
  scoreHistory.push(materialScore(current));
  for (const entry of log.moves) {
    if (entry.move.kind === 'topologyToggle') {
      current = applyRotationMove(current);
    } else if (entry.move.from && entry.move.to) {
      current = applyMove(current, entry.move);
    }
    scoreHistory.push(materialScore(current));
  }

  const moves = log.moves.map((e) => ({
    move: e.move,
    topology: e.topology,
  }));

  return {
    config960,
    movesInA,
    movesInB,
    scoreHistory,
    moves,
    notation: buildNotation(log, config960),
  };
}

export function buildSavedGameFromLog(
  log: GameLog,
  finalState: BoardState,
  termination: 'checkmate' | 'stalemate',
  sourceGameId?: string,
): SavedGame {
  const base = buildBaseFromLog(log);

  const humanIsWhite = true;
  const winner = termination === 'checkmate'
    ? (finalState.sideToMove === 'white' ? 'black' : 'white')
    : null;
  const result: 'win' | 'loss' | 'draw' =
    termination === 'stalemate' ? 'draw'
    : winner === 'white' ? (humanIsWhite ? 'win' : 'loss')
    : (humanIsWhite ? 'loss' : 'win');

  return {
    id: `${log.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: log.createdAt,
    status: 'complete',
    result,
    termination,
    moveCount: log.moves.length,
    moves: base.moves,
    movesInA: base.movesInA,
    movesInB: base.movesInB,
    scoreHistory: base.scoreHistory,
    notation: base.notation,
    config960: base.config960,
    sourceGameId,
  };
}

export function buildSavedGameSnapshot(
  log: GameLog,
  id: string,
): SavedGame {
  const base = buildBaseFromLog(log);
  return {
    id,
    createdAt: log.createdAt,
    status: 'incomplete',
    moveCount: log.moves.length,
    moves: base.moves,
    movesInA: base.movesInA,
    movesInB: base.movesInB,
    scoreHistory: base.scoreHistory,
    notation: base.notation,
    config960: base.config960,
  };
}

// Backwards-compatible wrapper for existing callers.
export function buildSavedGame(
  log: GameLog,
  finalState: BoardState,
  termination: 'checkmate' | 'stalemate',
): SavedGame {
  return buildSavedGameFromLog(log, finalState, termination);
}
