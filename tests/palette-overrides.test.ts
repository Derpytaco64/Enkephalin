import { describe, expect, it } from 'vitest';
import { isPaletteKey, withAxisColors, withColor } from '@/lib/theme/overrides';

/* Both palettes -- one per user, one for the site -- are these functions over
   a different row. Tested here for the one property neither store can show:
   that a rejected or applied edit leaves the map it was handed alone, since a
   caller holds that map across the write. */

describe('withColor', () => {
  it('returns a new map and does not touch the one it was given', () => {
    const before = { 'class:Statin': '#111111' };
    const edit = withColor(before, 'class:Biguanide', '#222222');

    expect(edit.ok).toBe(true);
    expect(edit.ok && edit.value!.overrides).toEqual({
      'class:Statin': '#111111',
      'class:Biguanide': '#222222',
    });
    expect(before).toEqual({ 'class:Statin': '#111111' });
  });

  it('normalises what it stores', () => {
    const edit = withColor({}, 'class:Statin', '  #ABCDEF ');
    expect(edit.ok && edit.value!.color).toBe('#abcdef');
  });

  it('treats a blank as clearing that one entry', () => {
    const edit = withColor({ 'class:Statin': '#111111', 'tag:x': '#222222' }, 'class:Statin', '  ');
    expect(edit.ok && edit.value!.color).toBeNull();
    expect(edit.ok && edit.value!.overrides).toEqual({ 'tag:x': '#222222' });
  });

  it('refuses a key that is not axis-shaped, and a colour that is not one', () => {
    expect(withColor({}, 'Statin', '#111111').ok).toBe(false);
    expect(withColor({}, 'class:a:b', '#111111').ok).toBe(false);
    expect(withColor({}, 42, '#111111').ok).toBe(false);
    expect(withColor({}, 'class:Statin', 'cornflower').ok).toBe(false);
  });
});

describe('withAxisColors', () => {
  it('replaces one axis and keeps every other', () => {
    const before = {
      'class:Statin': '#111111',
      'schedule:CII': '#dc2626',
      'tag:year-one': '#333333',
    };
    const edit = withAxisColors(before, 'class', { 'class:Biguanide': '#444444' });

    expect(edit.ok && edit.value!.overrides).toEqual({
      'schedule:CII': '#dc2626',
      'tag:year-one': '#333333',
      'class:Biguanide': '#444444',
    });
    expect(edit.ok && edit.value!.changed).toBe(1);
    expect(Object.keys(before)).toHaveLength(3);
  });

  it('clears an axis when handed nothing for it', () => {
    const edit = withAxisColors({ 'class:Statin': '#111111', 'tag:x': '#222222' }, 'class', {});
    expect(edit.ok && edit.value!.overrides).toEqual({ 'tag:x': '#222222' });
    expect(edit.ok && edit.value!.changed).toBe(0);
  });

  it('refuses the whole batch rather than writing the good half', () => {
    const before = { 'class:Statin': '#111111' };
    expect(withAxisColors(before, 'class', {
      'class:Biguanide': '#222222',
      'class:Opioid': 'cornflower',
    }).ok).toBe(false);
    expect(withAxisColors(before, 'class', { 'tag:statins': '#222222' }).ok).toBe(false);
    expect(before).toEqual({ 'class:Statin': '#111111' });
  });
});

describe('isPaletteKey', () => {
  it('wants one lowercase axis, a colon, and one value', () => {
    expect(isPaletteKey('class:Statin')).toBe(true);
    expect(isPaletteKey('schedule:CII')).toBe(true);
    expect(isPaletteKey('Class:Statin')).toBe(false);
    expect(isPaletteKey('class:')).toBe(false);
    expect(isPaletteKey(':Statin')).toBe(false);
    expect(isPaletteKey(`class:${'x'.repeat(201)}`)).toBe(false);
    expect(isPaletteKey(null)).toBe(false);
  });
});
