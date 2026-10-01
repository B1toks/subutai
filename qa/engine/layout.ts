/* The board as the player SEES it.
 *
 * Source of truth, in order:
 *   1. qa/fixtures/visual-layout.json — tile centres measured from the
 *      rendered DOM (qa/e2e/tests/layout.spec.ts writes it), white at the
 *      bottom, grid cell (x, y) with y = 0 the top row on screen.
 *   2. Fallback: the renderer's own getSquarePosition(). Used only when the
 *      fixture is missing; the fuzz then prints a warning, because in that
 *      mode "visual" is whatever the code says it is.
 *
 * Nothing here calls stepInDirection or any other movement helper — the
 * oracle has to be independent of the code it judges.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SquareId, TopologyState } from '../../src/engine/types';
import { QA_ROOT, srcModule, type EngineAuxetic } from './_src';

export interface XY { x: number; y: number }
export type Layout = Record<TopologyState, Record<SquareId, XY>>;

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const ALL_SQUARES: SquareId[] = FILES.flatMap((f) =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${f}${r}` as SquareId),
);

export const FIXTURE_PATH = path.join(QA_ROOT, 'fixtures', 'visual-layout.json');

export async function layoutFromCode(): Promise<Layout> {
  const aux = await srcModule<EngineAuxetic>('engine/auxetic.ts');
  const out = { A: {}, B: {} } as Layout;
  for (const topo of ['A', 'B'] as const) {
    for (const sq of ALL_SQUARES) {
      const p = aux.getSquarePosition(sq, topo);
      out[topo][sq] = { x: Math.round(p.x), y: Math.round(p.y) };
    }
  }
  return out;
}

export async function loadLayout(): Promise<{ layout: Layout; source: 'dom-fixture' | 'code' }> {
  if (fs.existsSync(FIXTURE_PATH)) {
    const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as { layout: Layout };
    validate(raw.layout);
    return { layout: raw.layout, source: 'dom-fixture' };
  }
  const layout = await layoutFromCode();
  validate(layout);
  return { layout, source: 'code' };
}

function validate(layout: Layout) {
  for (const topo of ['A', 'B'] as const) {
    const seen = new Set<string>();
    for (const sq of ALL_SQUARES) {
      const p = layout[topo][sq];
      if (!p || p.x < 0 || p.x > 7 || p.y < 0 || p.y > 7) {
        throw new Error(`layout ${topo}: ${sq} off-grid ${JSON.stringify(p)}`);
      }
      const k = `${p.x},${p.y}`;
      if (seen.has(k)) throw new Error(`layout ${topo}: two squares at ${k}`);
      seen.add(k);
    }
  }
}

/** Inverse map: grid cell -> square label, per topology. */
export function invert(layout: Layout): Record<TopologyState, (SquareId | undefined)[]> {
  const out = { A: new Array(64), B: new Array(64) } as Record<TopologyState, (SquareId | undefined)[]>;
  for (const topo of ['A', 'B'] as const) {
    for (const sq of ALL_SQUARES) {
      const { x, y } = layout[topo][sq];
      out[topo][y * 8 + x] = sq;
    }
  }
  return out;
}

/** Visual row a colour promotes on: the top edge for white, bottom for black. */
export function farRow(color: 'white' | 'black'): number {
  return color === 'white' ? 0 : 7;
}

export function farRowSquares(layout: Layout, topo: TopologyState, color: 'white' | 'black'): SquareId[] {
  return ALL_SQUARES.filter((sq) => layout[topo][sq].y === farRow(color)).sort();
}
