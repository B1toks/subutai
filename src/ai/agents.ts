import type { BoardState, Move } from '../engine';
import { generateLegalMoves } from '../engine/moves';
import { iterativeDeepen } from './search';
import { scaleBudgetMs } from '../utils/deviceTier';

/** V1 — bot strength levels. `strong` is the historical engine (800ms /
 *  depth 6) and the only level whose games are ranked; the two lighter
 *  levels exist so newcomers get a game they can actually finish (R15 data:
 *  40% of solo games were over by move 10 against the full-strength bot).
 *  Levels only change the search budget / depth and, for casual, mix in
 *  the occasional random legal move — the engine's rules never change. */
export type BotStrength = 'casual' | 'normal' | 'strong';

export const BOT_STRENGTHS: readonly BotStrength[] = ['casual', 'normal', 'strong'] as const;

export const BOT_STRENGTH_LABEL: Record<BotStrength, string> = {
  casual: 'Casual',
  normal: 'Normal',
  strong: 'Strong',
};

interface StrengthProfile {
  budgetMs: number;
  maxDepth: number;
  /** Probability that the bot plays a random legal move instead of the
   *  search result. 0 = always the engine move. */
  randomMoveChance: number;
}

/* V1 — measured, not guessed. scripts/bench-bot-levels.ts scores each level
 * against a depth-8 reference search. The first cut (casual d2/25% slip,
 * normal d4/no slip) came back at 116 vs 123 average centipawn loss: the
 * two levels were indistinguishable, because search depth alone stops
 * paying off quickly on this board while a slip costs material outright.
 * The ladder below separates them with the lever that actually moves the
 * number — how often the bot lets one go — and keeps depth as the slower
 * second axis. Note the time budget only binds at strong: depth 2 and 4
 * finish in well under their allowance, so the honest way to describe the
 * lower levels to a player is depth + slip rate, never seconds.
 *
 * Measured after this change (24 positions, depth-8 reference; 3 games per
 * level head to head, evaluation from the weaker side):
 *   casual  154 cpl   42% agreement   -26.6 pawns vs strong
 *   normal  128 cpl   63% agreement    -2.9 pawns vs strong
 *   strong   33 cpl   71% agreement    reference
 * Re-run scripts/bench-bot-levels.ts after touching these numbers. */
const STRENGTH_PROFILE: Record<BotStrength, StrengthProfile> = {
  casual: { budgetMs: 150, maxDepth: 2, randomMoveChance: 0.35 },
  normal: { budgetMs: 400, maxDepth: 4, randomMoveChance: 0.1 },
  strong: { budgetMs: 800, maxDepth: 6, randomMoveChance: 0 },
};

export function isBotStrength(value: unknown): value is BotStrength {
  return typeof value === 'string' && (BOT_STRENGTHS as readonly string[]).includes(value);
}

export interface AgentContext {
  readonly seed?: number;
  /** If true, the agent must not play a topology toggle (no two rotations in a row). */
  readonly lastMoveWasRotation?: boolean;
  /** Q.D.8: roulette mode — engine plays capture-the-king variant (no
   *  check enforcement). When true, the underlying search yields legal
   *  moves with self-check allowed so the AI competes by the same rules
   *  as the human in roulette. */
  readonly allowSelfCheck?: boolean;
  /** V1 — bot strength; defaults to 'strong' (the historical behaviour). */
  readonly strength?: BotStrength;
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
    legalMoves: readonly Move[],
    context?: AgentContext,
  ): Promise<Move | null> {
    const profile = STRENGTH_PROFILE[context?.strength ?? 'strong'];
    if (profile.randomMoveChance > 0 && Math.random() < profile.randomMoveChance) {
      const moves = legalMoves.length
        ? legalMoves
        : generateLegalMoves(state, { allowSelfCheck: context?.allowSelfCheck });
      if (moves.length) return moves[Math.floor(Math.random() * moves.length)] ?? null;
    }
    // Sprint 4.5 — low-end devices get ~45% of the think budget so the
    // AI never locks the main thread for close to a second.
    return iterativeDeepen(
      state,
      scaleBudgetMs(profile.budgetMs),
      context?.lastMoveWasRotation ?? false,
      context?.allowSelfCheck ?? false,
      profile.maxDepth,
    );
  },
};
