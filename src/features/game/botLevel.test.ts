import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOT_STRENGTHS } from '../../ai/agents';
import { BOT_LEVEL_KEY, BOT_STRENGTH_HINT, BOT_STRENGTH_SUMMARY, readInitialBotLevel } from './botLevel';

afterEach(() => vi.unstubAllGlobals());
const storing = (value: string | null) =>
  vi.stubGlobal('localStorage', { getItem: (k: string) => (k === BOT_LEVEL_KEY ? value : null) });

describe('readInitialBotLevel', () => {
  it('starts from the level saved under subutai_bot_level', () => {
    expect(BOT_LEVEL_KEY).toBe('subutai_bot_level');
    storing('casual');
    expect(readInitialBotLevel()).toBe('casual');
  });
  it('falls back to Strong for nothing saved, an unknown level, or no storage', () => {
    storing(null);
    expect(readInitialBotLevel()).toBe('strong');
    storing('grandmaster');
    expect(readInitialBotLevel()).toBe('strong');
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); } });
    expect(readInitialBotLevel()).toBe('strong');
  });
});

describe('level texts', () => {
  it('describe every level, and only Strong as ranked', () => {
    for (const level of BOT_STRENGTHS) {
      expect(BOT_STRENGTH_HINT[level]).toBeTruthy();
      expect(BOT_STRENGTH_SUMMARY[level].includes('Not ranked')).toBe(level !== 'strong');
    }
  });
});
