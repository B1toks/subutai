import type { BoardState, Move } from '../engine';
import { generateLegalMoves } from '../engine/moves';

export interface AgentContext {
  readonly seed?: number;
}

export interface Agent {
  readonly id: string;
  readonly name: string;
  chooseMove: (
    state: BoardState,
    legalMoves: readonly Move[],
    context?: AgentContext,
  ) => Promise<Move | null>;
}

export const RandomAgent: Agent = {
  id: 'random',
  name: 'Random Move Agent',
  async chooseMove(
    state: BoardState,
    legalMoves: readonly Move[],
  ): Promise<Move | null> {
    const moves = legalMoves.length ? legalMoves : generateLegalMoves(state);
    if (!moves.length) return null;
    const index = Math.floor(Math.random() * moves.length);
    return moves[index] ?? null;
  },
};

