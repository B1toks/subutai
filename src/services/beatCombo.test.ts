import { afterEach, describe, expect, it, vi } from 'vitest';
import { beatBridge } from '../integrations/music/beatBridge';
import { beatComboOnEvents } from './beatCombo';
import { isPlayed } from './played';
import type { Actor, SessionEvent } from '../session/types';

const move = (actor: Actor, kind: 'normal' | 'topologyToggle' = 'normal'): SessionEvent => ({
  type: 'move',
  move: kind === 'normal' ? { from: 'e2', to: 'e4', kind } : { kind },
  san: 'e2→e4',
  by: 'white',
  actor,
  index: 0,
});

describe('beat combo', () => {
  afterEach(() => vi.restoreAllMocks());

  it('scores moves made here and by chat, not the bot, an online match, a rotation or a replay', () => {
    const report = vi.spyOn(beatBridge, 'reportMove').mockReturnValue(null);
    beatComboOnEvents([move('human')]);
    beatComboOnEvents([move('chat')]);
    beatComboOnEvents([move('bot')]);
    beatComboOnEvents([move('remote')]);
    beatComboOnEvents([move('replay')]);
    beatComboOnEvents([move('human', 'topologyToggle')]);
    beatComboOnEvents([{ type: 'gameEnd', status: 'checkmate' }]);
    expect(report).toHaveBeenCalledTimes(2);
  });
});

describe('isPlayed', () => {
  it('is every move made now, and no replayed one', () => {
    expect(isPlayed(move('human'))).toBe(true);
    expect(isPlayed(move('bot'))).toBe(true);
    expect(isPlayed(move('chat'))).toBe(true);
    expect(isPlayed(move('replay'))).toBe(false);
    expect(isPlayed({ type: 'check', side: 'black' })).toBe(false);
  });
});
