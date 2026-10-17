import { useState, useRef, useEffect } from 'react';
import type { BotStrength } from '../../ai/agents';
import { readInitialBotLevel, BOT_LEVEL_KEY } from './botLevel';
import { localData } from '../../infra/localData';

/**
 * The bot's strength: the level on screen, a ref the bot's scheduler
 * reads, and a setter that also remembers the choice in localStorage.
 */
export function useBotLevel() {
  // V1 — bot strength. Persisted; mirrored in a ref because the AI
  // scheduler is a memoised callback that must read the live value.
  const [botLevel, setBotLevelState] = useState<BotStrength>(readInitialBotLevel);
  const botLevelRef = useRef<BotStrength>(botLevel);
  useEffect(() => {
    botLevelRef.current = botLevel;
  }, [botLevel]);
  function setBotLevel(next: BotStrength) {
    setBotLevelState(next);
    try {
      localData.set(BOT_LEVEL_KEY, next);
    } catch {
      /* private mode */
    }
  }
  return { botLevel, botLevelRef, setBotLevel };
}
