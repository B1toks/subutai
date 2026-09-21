/**
 * V1 — does the bot-strength selector actually change anything?
 *
 * Answers it with numbers instead of trust, in two ways:
 *
 *  1. QUALITY. On a shared set of positions, ask each level for its move,
 *     then score that move with a deep reference search (the same engine at
 *     depth 8 / 3s). Average centipawn loss against the reference best move
 *     is the level's real strength; agreement % is how often it simply
 *     finds the reference move.
 *
 *  2. RESULT. A short head-to-head: Casual and Normal each play a few games
 *     against Strong from random Chess960 starts, capped in length, scored
 *     by the final evaluation from the weaker side's perspective.
 *
 * Run: npx tsx scripts/bench-bot-levels.ts
 */

import { createStartingPosition } from '../src/engine';
import type { BoardState, Move } from '../src/engine';
import { generateLegalMoves, isCheckmate } from '../src/engine/moves';
import { applyMove, checkDrawConditions } from '../src/engine/moves';
import { applyRotationMove } from '../src/engine/auxetic';
import { searchPosition } from '../src/ai/search';
import { SubutaiAgent, BOT_STRENGTHS, type BotStrength } from '../src/ai/agents';
import { evaluate } from '../src/ai/evaluate';

const POSITION_COUNT = 24;
const REFERENCE_BUDGET_MS = 3000;
const REFERENCE_DEPTH = 8;
const HEAD_TO_HEAD_GAMES = 3;
const MAX_PLIES = 60;

function evalFromWhite(state: BoardState): number {
  const raw = evaluate(state);
  return state.sideToMove === 'white' ? raw : -raw;
}

function advance(state: BoardState, move: Move): BoardState {
  return move.kind === 'topologyToggle'
    ? applyRotationMove(state)
    : applyMove(state, move);
}

/** Walk a fresh game forward a few plies with the reference engine so the
 *  sample positions are real middlegames, not 24 copies of move one. */
function samplePositions(count: number): BoardState[] {
  const out: BoardState[] = [];
  for (let i = 0; i < count; i++) {
    let state = createStartingPosition(1000 + i * 37);
    const plies = 4 + (i % 9);
    for (let p = 0; p < plies; p++) {
      const moves = generateLegalMoves(state);
      if (moves.length === 0) break;
      // Deterministic spread: pick a different legal move per ply/seed.
      state = advance(state, moves[(i * 7 + p * 3) % moves.length]);
    }
    if (generateLegalMoves(state).length > 0) out.push(state);
  }
  return out;
}

async function qualityPass(positions: BoardState[]) {
  const rows: Record<BotStrength, { cplSum: number; agree: number; msSum: number; n: number }> = {
    casual: { cplSum: 0, agree: 0, msSum: 0, n: 0 },
    normal: { cplSum: 0, agree: 0, msSum: 0, n: 0 },
    strong: { cplSum: 0, agree: 0, msSum: 0, n: 0 },
  };

  for (const [idx, state] of positions.entries()) {
    // Reference: what a much deeper search thinks of this position.
    const ref = searchPosition(state, {
      budgetMs: REFERENCE_BUDGET_MS,
      maxDepth: REFERENCE_DEPTH,
    });
    if (!ref.bestMove) continue;
    const refKey = JSON.stringify(ref.bestMove);

    for (const level of BOT_STRENGTHS) {
      const legal = generateLegalMoves(state);
      const t0 = performance.now();
      const move = await SubutaiAgent.chooseMove(state, legal, { strength: level });
      const ms = performance.now() - t0;
      if (!move) continue;

      // Score the played move by searching the position it leads to with the
      // reference engine, negated back to the mover's perspective.
      const after = advance(state, move);
      const reply = searchPosition(after, {
        budgetMs: REFERENCE_BUDGET_MS,
        maxDepth: REFERENCE_DEPTH,
      });
      const playedScore = -reply.score;
      const cpl = Math.max(0, ref.score - playedScore);

      const r = rows[level];
      r.cplSum += cpl;
      r.msSum += ms;
      r.n++;
      if (JSON.stringify(move) === refKey) r.agree++;
    }
    process.stdout.write(`  position ${idx + 1}/${positions.length}\r`);
  }
  process.stdout.write('\n');
  return rows;
}

async function playGame(
  white: BotStrength,
  black: BotStrength,
  seed: number,
): Promise<{ plies: number; finalEvalWhite: number; ended: string }> {
  let state = createStartingPosition(seed);
  let lastWasRotation = false;
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const legal = generateLegalMoves(state);
    if (legal.length === 0) {
      return {
        plies: ply,
        finalEvalWhite: evalFromWhite(state),
        ended: isCheckmate(state) ? 'checkmate' : 'stalemate',
      };
    }
    const draw = checkDrawConditions(state, lastWasRotation);
    if (draw) {
      return { plies: ply, finalEvalWhite: evalFromWhite(state), ended: String(draw) };
    }
    const level = state.sideToMove === 'white' ? white : black;
    const move = await SubutaiAgent.chooseMove(state, legal, {
      strength: level,
      lastMoveWasRotation: lastWasRotation,
    });
    if (!move) break;
    lastWasRotation = move.kind === 'topologyToggle';
    state = advance(state, move);
  }
  return { plies: MAX_PLIES, finalEvalWhite: evalFromWhite(state), ended: 'move cap' };
}

async function main() {
  console.log('Sampling positions…');
  const positions = samplePositions(POSITION_COUNT);
  console.log(`Quality pass over ${positions.length} positions (reference: depth ${REFERENCE_DEPTH} / ${REFERENCE_BUDGET_MS}ms)`);
  const rows = await qualityPass(positions);

  console.log('\n=== QUALITY (lower CPL = stronger) ===');
  console.log('level    avg CPL   agrees with reference   avg think');
  for (const level of BOT_STRENGTHS) {
    const r = rows[level];
    if (!r.n) continue;
    const cpl = (r.cplSum / r.n).toFixed(0).padStart(7);
    const agree = `${Math.round((r.agree / r.n) * 100)}%`.padStart(21);
    const ms = `${(r.msSum / r.n).toFixed(0)}ms`.padStart(11);
    console.log(`${level.padEnd(8)}${cpl}${agree}${ms}`);
  }

  console.log('\n=== HEAD TO HEAD vs strong (eval from the weak side, negative = losing) ===');
  for (const weak of ['casual', 'normal'] as BotStrength[]) {
    const results: number[] = [];
    for (let g = 0; g < HEAD_TO_HEAD_GAMES; g++) {
      // Alternate colours so neither side gets a first-move advantage.
      const weakIsWhite = g % 2 === 0;
      const r = await playGame(
        weakIsWhite ? weak : 'strong',
        weakIsWhite ? 'strong' : weak,
        4242 + g * 91,
      );
      const fromWeak = weakIsWhite ? r.finalEvalWhite : -r.finalEvalWhite;
      results.push(fromWeak);
      console.log(
        `  ${weak} as ${weakIsWhite ? 'white' : 'black'}: ${(fromWeak / 100).toFixed(2)} pawns after ${r.plies} plies (${r.ended})`,
      );
    }
    const avg = results.reduce((a, b) => a + b, 0) / results.length / 100;
    console.log(`  ${weak} average: ${avg.toFixed(2)} pawns\n`);
  }
}

void main();
