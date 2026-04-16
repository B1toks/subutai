import type { BoardState, SquareId, TopologyState } from './types';

// --- Block geometry ---

function squareToFileRank(square: SquareId): { file: number; rank: number } {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(square[1]) - 1;
  return { file, rank };
}

function fileRankToSquare(file: number, rank: number): SquareId | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${String.fromCharCode('a'.charCodeAt(0) + file)}${rank + 1}` as SquareId;
}

export function getBlockIndex(square: SquareId): number {
  const { file, rank } = squareToFileRank(square);
  const bc = file >> 1;
  const br = rank >> 1;
  return br * 4 + bc;
}

// --- Visual positions ---

export interface SquarePosition {
  x: number;
  y: number;
  angle: number;
}

/**
 * Full 90° rotation: blocks rotate ±90° in a checkerboard pattern.
 * At 90° the expansion factor (cosθ + sinθ) returns to 1, so the board
 * re-compacts into a regular grid with tiles at integer positions — just
 * reshuffled. The 45° diamond pattern only appears mid-animation.
 */
export function getSquarePosition(
  square: SquareId,
  topology: TopologyState,
): SquarePosition {
  const { file, rank } = squareToFileRank(square);
  const col = file;
  const row = 7 - rank;

  if (topology === 'A') {
    return { x: col, y: row, angle: 0 };
  }

  const ROTATION = Math.PI / 2; // 90°
  const S = 1; // cos(90°) + sin(90°) = 1: board re-compacts

  const bc = col >> 1;
  const br = row >> 1;
  const lc = col - 2 * bc;
  const lr = row - 2 * br;

  const theta = (br + bc) % 2 === 0 ? ROTATION : -ROTATION;
  const cosT = Math.round(Math.cos(theta)); // 0 at ±90°
  const sinT = Math.round(Math.sin(theta)); // ±1 at ±90°

  const blockCx = 3.5 + (2 * bc - 3) * S;
  const blockCy = 3.5 + (2 * br - 3) * S;

  const localX = lc - 0.5;
  const localY = lr - 0.5;
  const ox = localX * cosT - localY * sinT;
  const oy = localX * sinT + localY * cosT;

  return {
    x: blockCx + ox,
    y: blockCy + oy,
    angle: (theta * 180) / Math.PI,
  };
}

export interface BoardLayout {
  tileSize: number;
  offsetX: number;
  offsetY: number;
}

export function computeBoardLayout(
  topology: TopologyState,
  containerSize: number,
): BoardLayout {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const f of files) {
    for (const r of ranks) {
      const sq = `${f}${r}` as SquareId;
      const pos = getSquarePosition(sq, topology);
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    }
  }

  // At both 0° and 90° tiles are axis-aligned, so half-tile = 0.5
  const halfExtent = 0.5;
  const spanX = maxX - minX + 2 * halfExtent;
  const spanY = maxY - minY + 2 * halfExtent;
  const span = Math.max(spanX, spanY);
  const tileSize = containerSize / span;

  const padX = (span - spanX) / 2;
  const padY = (span - spanY) / 2;

  return {
    tileSize,
    offsetX: (-minX + padX + halfExtent) * tileSize,
    offsetY: (-minY + padY + halfExtent) * tileSize,
  };
}

export function tilePixelCenter(
  square: SquareId,
  topology: TopologyState,
  layout: BoardLayout,
): { cx: number; cy: number; angle: number } {
  const pos = getSquarePosition(square, topology);
  return {
    cx: pos.x * layout.tileSize + layout.offsetX,
    cy: pos.y * layout.tileSize + layout.offsetY,
    angle: pos.angle,
  };
}

// --- Physical position map for State B adjacency ---

const ALL_SQUARES: SquareId[] = (() => {
  const sqs: SquareId[] = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      sqs.push(fileRankToSquare(f, r)!);
    }
  }
  return sqs;
})();

let physicalMapB: Map<string, SquareId> | null = null;

function getPhysicalMapB(): Map<string, SquareId> {
  if (!physicalMapB) {
    physicalMapB = new Map();
    for (const sq of ALL_SQUARES) {
      const pos = getSquarePosition(sq, 'B');
      const key = `${Math.round(pos.x)},${Math.round(pos.y)}`;
      physicalMapB.set(key, sq);
    }
  }
  return physicalMapB;
}

// --- Movement helpers ---

export function stepInDirection(
  from: SquareId,
  df: number,
  dr: number,
  topology: TopologyState,
): SquareId | null {
  if (topology === 'A') {
    const { file, rank } = squareToFileRank(from);
    return fileRankToSquare(file + df, rank + dr);
  }

  // State B: move on the physical grid.
  // df = screen-right, dr = rank-up (screen-up = negative Y)
  const pos = getSquarePosition(from, 'B');
  const physX = Math.round(pos.x);
  const physY = Math.round(pos.y);

  const targetX = physX + df;
  const targetY = physY - dr;

  if (targetX < 0 || targetX > 7 || targetY < 0 || targetY > 7) return null;

  return getPhysicalMapB().get(`${targetX},${targetY}`) ?? null;
}

export function rayFrom(
  from: SquareId,
  df: number,
  dr: number,
  topology: TopologyState,
): SquareId[] {
  const result: SquareId[] = [];
  let current: SquareId | null = stepInDirection(from, df, dr, topology);
  while (current) {
    result.push(current);
    current = stepInDirection(current, df, dr, topology);
  }
  return result;
}

export function knightTargets(
  from: SquareId,
  topology: TopologyState,
): SquareId[] {
  const deltas: Array<readonly [number, number]> = [
    [1, 2],
    [2, 1],
    [-1, 2],
    [-2, 1],
    [1, -2],
    [2, -1],
    [-1, -2],
    [-2, -1],
  ];
  const targets: SquareId[] = [];
  for (const [df, dr] of deltas) {
    const target = stepInDirection(from, df, dr, topology);
    if (target) targets.push(target);
  }
  return targets;
}

export function pawnForwardTargets(
  from: SquareId,
  color: 'white' | 'black',
  topology: TopologyState,
): { one: SquareId | null; two: SquareId | null } {
  const direction = color === 'white' ? 1 : -1;
  const one = stepInDirection(from, 0, direction, topology);
  if (!one) return { one: null, two: null };

  const { rank } = squareToFileRank(from);
  const startRank = color === 'white' ? 1 : 6;
  if (rank !== startRank) return { one, two: null };

  const two = stepInDirection(one, 0, direction, topology);
  return { one, two };
}

export function pawnCaptureTargets(
  from: SquareId,
  color: 'white' | 'black',
  topology: TopologyState,
): SquareId[] {
  const direction = color === 'white' ? 1 : -1;
  const left = stepInDirection(from, -1, direction, topology);
  const right = stepInDirection(from, 1, direction, topology);
  return [left, right].filter((sq): sq is SquareId => Boolean(sq));
}

/**
 * Pure rotation: flips the board topology between 'A' and 'B' and nothing else.
 * The turn does NOT advance — callers that want rotation to cost a move must
 * use `applyRotationMove` instead.
 */
export function toggleTopology(state: BoardState): BoardState {
  return {
    ...state,
    topologyState: state.topologyState === 'A' ? 'B' : 'A',
  };
}

/**
 * Applies a rotation as a recorded move: flips topology AND advances the turn.
 * Use this when rotation is submitted as the player's move in the game log.
 */
export function applyRotationMove(state: BoardState): BoardState {
  return {
    ...state,
    topologyState: state.topologyState === 'A' ? 'B' : 'A',
    sideToMove: state.sideToMove === 'white' ? 'black' : 'white',
  };
}
