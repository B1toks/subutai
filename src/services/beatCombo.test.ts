import { afterEach, describe, expect, it, vi } from 'vitest';
import { beatBridge } from '../music/beatBridge';
import { beatComboOnEvents } from './beatCombo';
import type { SessionEvent } from '../session/types';

const move = (actor: 'human' | 'bot' | 'chat', kind: 'normal' | 'topologyToggle' = 'normal'): SessionEvent => ({
  type: 'move',
  move: kind === 'normal' ? { from: 'e2', to: 'e4', kind } : { kind },
  san: 'e2→e4',
  by: 'white',
  actor,
  index: 0,
});

describe('beat combo', () => {
  afterEach(() => vi.restoreAllMocks());

  it('scores moves made here and by chat, not the bot or a rotation', () => {
    const report = vi.spyOn(beatBridge, 'reportMove').mockReturnValue(null);
    beatComboOnEvents([move('human')]);
    beatComboOnEvents([move('chat')]);
    beatComboOnEvents([move('bot')]);
    beatComboOnEvents([move('human', 'topologyToggle')]);
    beatComboOnEvents([{ type: 'gameEnd', status: 'checkmate' }]);
    expect(report).toHaveBeenCalledTimes(2);
  });
});
