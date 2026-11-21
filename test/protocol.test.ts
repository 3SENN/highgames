import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK } from '../src/shared/look';
import { cleanName, parseJoin, parsePhoneMsg, parseTvMsg } from '../src/shared/protocol';

describe('phone messages', () => {
  it('accepts well-formed messages', () => {
    expect(parsePhoneMsg({ t: 'look', look: DEFAULT_LOOK })).toEqual({ t: 'look', look: DEFAULT_LOOK });
    expect(parsePhoneMsg({ t: 'buy', item: null })).toEqual({ t: 'buy', item: null });
    expect(parsePhoneMsg({ t: 'rounds', rounds: 8 })).toEqual({ t: 'rounds', rounds: 8 });
    expect(parsePhoneMsg({ t: 'roll', extra: 'ignored' })).toEqual({ t: 'roll' });
  });

  it('clamps sensor values', () => {
    expect(parsePhoneMsg({ t: 'tilt', x: 5, y: -9 })).toEqual({ t: 'tilt', x: 1, y: -1 });
    expect(parsePhoneMsg({ t: 'pump', power: 3 })).toEqual({ t: 'pump', power: 1 });
  });

  it('rejects anything malformed', () => {
    for (const bad of [
      null,
      'roll',
      { t: 'pick', character: 'kit' },
      { t: 'look', look: { ...DEFAULT_LOOK, rig: 'Z' } },
      { t: 'tilt', x: Number.NaN, y: 0 },
      { t: 'choose', index: -1 },
      { t: 'choose', index: 1.5 },
      { t: 'use', item: 'rocket' },
      { t: 'rounds', rounds: 99 },
      { t: '__proto__' },
    ]) {
      expect(parsePhoneMsg(bad)).toBeNull();
    }
  });
});

describe('tv messages', () => {
  it('checks the shape and clamps the meter', () => {
    expect(parseTvMsg({ t: 'meter', value: 9, danger: true })).toEqual({ t: 'meter', value: 1.5, danger: true });
    expect(parseTvMsg({ t: 'layout', layout: { kind: 'pump' } })).toEqual({ t: 'layout', layout: { kind: 'pump' } });
    expect(parseTvMsg({ t: 'layout' })).toBeNull();
  });
});

describe('joining (the query of a phone\'s socket through atelier.server)', () => {
  it('takes a name and a token', () => {
    expect(parseJoin({ name: ' Sam ', token: 'tok-12345' }, 'Player 1')).toEqual({ name: 'Sam', token: 'tok-12345' });
    expect(parseJoin({ token: 'tok-12345' }, 'Player 1')).toEqual({ name: 'Player 1', token: 'tok-12345' });
  });

  it('refuses a socket without a proper token', () => {
    expect(parseJoin({ name: 'x', token: 'short' }, 'P')).toBeNull();
    expect(parseJoin({ name: 'x', token: 'has spaces in it' }, 'P')).toBeNull();
    expect(parseJoin({ name: 'x' }, 'P')).toBeNull();
    expect(parseJoin(null, 'P')).toBeNull();
  });

  it('cleans names', () => {
    expect(cleanName('  a\u0000b\n  c  ', 'x')).toBe('ab c');
    expect(cleanName('a very long name indeed', 'x')).toHaveLength(14);
    expect(cleanName('', 'Player 1')).toBe('Player 1');
  });
});
