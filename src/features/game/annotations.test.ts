import { describe, expect, it } from 'vitest';
import { colorFromMouseEvent } from './annotations';

const keys = (held: Partial<Record<'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey', boolean>>) => ({
  shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...held,
});

describe('colorFromMouseEvent', () => {
  it('draws green by default and switches colour with a modifier', () => {
    expect(colorFromMouseEvent(keys({}))).toBe('green');
    expect(colorFromMouseEvent(keys({ shiftKey: true }))).toBe('red');
    expect(colorFromMouseEvent(keys({ altKey: true }))).toBe('yellow');
    expect(colorFromMouseEvent(keys({ ctrlKey: true }))).toBe('blue');
    expect(colorFromMouseEvent(keys({ metaKey: true }))).toBe('blue');
  });
  it('lets Shift win when several are held', () => {
    expect(colorFromMouseEvent(keys({ shiftKey: true, altKey: true, ctrlKey: true }))).toBe('red');
  });
});
