import { isBotStrength, type BotStrength } from '../../ai/agents';

/** The level picked last time, kept across visits. */
export const BOT_LEVEL_KEY = 'subutai_bot_level';

export function readInitialBotLevel(): BotStrength {
  try {
    const raw = localStorage.getItem(BOT_LEVEL_KEY);
    if (isBotStrength(raw)) return raw;
  } catch {
    /* private mode */
  }
  return 'strong';
}

/** V1 — what actually changes between levels, in the player's terms.
 *  The numbers are the real search profile in src/ai/agents.ts, so the
 *  panel never promises a difference the engine does not make. */
export const BOT_STRENGTH_HINT: Record<BotStrength, string> = {
  casual:
    'Looks 2 moves ahead and throws away about 1 move in 3 on purpose. It hangs pieces and misses simple tactics. Practice only, not ranked.',
  normal:
    'Looks 4 moves ahead and slips about 1 move in 10. It punishes anything you leave hanging but will hand you chances back. Practice only, not ranked.',
  strong:
    'Looks 6 moves ahead and never slips on purpose. Measured at about a quarter of the error the lower levels make. The leaderboard is this bot.',
};

/** One-line summary under the pills: the single fact that matters most. */
export const BOT_STRENGTH_SUMMARY: Record<BotStrength, string> = {
  casual: 'Casual: 2 moves ahead, gives away 1 move in 3. Not ranked.',
  normal: 'Normal: 4 moves ahead, slips 1 move in 10. Not ranked.',
  strong: 'Strong: 6 moves ahead, no slips. Wins and survival count for the leaderboard.',
};
