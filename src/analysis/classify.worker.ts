/// <reference lib="webworker" />

import type { BoardState, Move } from '../engine';
import { classifyMove, type ClassifyOptions, type MoveAnalysis } from './classify';

export interface ClassifyRequest {
  readonly id: number;
  readonly stateBefore: BoardState;
  readonly move: Move;
  readonly stateAfter: BoardState;
  readonly opts?: ClassifyOptions;
}

export interface ClassifyResponse {
  readonly id: number;
  readonly ok: boolean;
  readonly analysis?: MoveAnalysis;
  readonly error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<ClassifyRequest>) => {
  const { id, stateBefore, move, stateAfter, opts } = e.data;
  try {
    const analysis = classifyMove(stateBefore, move, stateAfter, opts);
    const response: ClassifyResponse = { id, ok: true, analysis };
    ctx.postMessage(response);
  } catch (err) {
    const response: ClassifyResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(response);
  }
};
