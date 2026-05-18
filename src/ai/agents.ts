import type { BoardState, Move } from '../engine';
import { generateLegalMoves } from '../engine/moves';
import { iterativeDeepen } from './search';

export interface AgentContext {
  readonly seed?: number;
  /** If true, the agent must not play a topology toggle (no two rotations in a row). */
  readonly lastMoveWasRotation?: boolean;
  /** Q.D.8: roulette mode — engine plays capture-the-king variant (no
   *  check enforcement). When true, the underlying search yields legal
   *  moves with self-check allowed so the AI competes by the same rules
   *  as the human in roulette. */
  readonly allowSelfCheck?: boolean;
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
    context?: AgentContext,
  ): Promise<Move | null> {
    const moves = legalMoves.length
      ? legalMoves
      : generateLegalMoves(state, { allowSelfCheck: context?.allowSelfCheck });
    if (!moves.length) return null;
    const index = Math.floor(Math.random() * moves.length);
    return moves[index] ?? null;
  },
};

export const SubutaiAgent: Agent = {
  id: 'subutai',
  name: 'Subutai',
  async chooseMove(
    state: BoardState,
    _legalMoves: readonly Move[],
    context?: AgentContext,
  ): Promise<Move | null> {
    return iterativeDeepen(
      state,
      800,
      context?.lastMoveWasRotation ?? false,
      context?.allowSelfCheck ?? false,
    );
  },
};

