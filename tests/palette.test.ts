import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CATEGORICAL_RAMP, checkFill, colorFor, contrastRatio, hslToHex, MIN_FILL_CONTRAST,
  normalizeHex, paletteKey, randomPalette, readableOnHue, readableTextOn, SCHEDULE_COLORS,
  scheduleBadge,
  SURFACE_DARK, SURFACE_LIGHT,
} from '@/lib/theme/palette';

describe('normalizeHex', () => {
  it('takes the forms a person types and refuses the rest', () => {
    expect(normalizeHex('#2563EB')).toBe('#2563eb');
    expect(normalizeHex('2563eb')).toBe('#2563eb');
    expect(normalizeHex('  #abc ')).toBe('#aabbcc');

    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex('blue')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('rgb(0,0,0)')).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('agrees with the WCAG extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // Order does not matter: it is a ratio of the lighter to the darker.
    expect(contrastRatio('#2563eb', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#2563eb'), 5);
  });
});

describe('readableTextOn', () => {
  it('picks whichever of black and white reads better', () => {
    expect(readableTextOn('#ffffff')).toBe('#000000');
    expect(readableTextOn('#000000')).toBe('#ffffff');
  });

  it('clears the text threshold on every colour in the ramps', () => {
    // This is what keeps "colour is never the only signal" true: the badge
    // carries its text, and the text is legible on whatever the fill is.
    for (const fill of [...CATEGORICAL_RAMP, ...Object.values(SCHEDULE_COLORS)]) {
      expect(contrastRatio(fill, readableTextOn(fill))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('checkFill', () => {
  it('measures against both grounds, because one is how things vanish', () => {
    // #7e22ce was a class colour before this: 7.0:1 on white and 2.6:1 on the
    // dark surface, which is a colour that works until you switch themes.
    const check = checkFill('#7e22ce');
    expect(check.light).toBeGreaterThan(MIN_FILL_CONTRAST);
    expect(check.dark).toBeLessThan(MIN_FILL_CONTRAST);
    expect(check.ok).toBe(false);
  });

  it('passes a colour that clears both', () => {
    const check = checkFill('#8b5cf6');
    expect(check.ok).toBe(true);
    expect(Math.min(check.light, check.dark)).toBeGreaterThanOrEqual(MIN_FILL_CONTRAST);
  });

  it('holds for every default colour, in both themes', () => {
    // The whole reason these ramps were rechosen. A default that failed its
    // own check would make the warning noise rather than information.
    for (const fill of [...CATEGORICAL_RAMP, ...Object.values(SCHEDULE_COLORS)]) {
      const check = checkFill(fill);
      expect(check.ok, `${fill} on light ${check.light.toFixed(2)} / dark ${check.dark.toFixed(2)}`)
        .toBe(true);
    }
  });

  it('uses the surfaces the stylesheet actually defines', () => {
    expect(SURFACE_LIGHT).toBe('#ffffff');
    expect(SURFACE_DARK).toBe('#14171c');
  });
});

describe('colorFor', () => {
  const statin = { drugClass: 'HMG-CoA Reductase Inhibitor', schedule: null, tags: ['statins'] };

  it('gives nothing when colour is off', () => {
    expect(colorFor('none', statin)).toBeNull();
  });

  it('assigns a class the same colour every time', () => {
    // Stability is the whole point: a drug that is blue today and orange
    // tomorrow is worse than no colour at all.
    const once = colorFor('class', statin);
    expect(once).not.toBeNull();
    expect(colorFor('class', statin)).toBe(once);
    expect(CATEGORICAL_RAMP).toContain(once);
  });

  it('gives different classes different colours, usually', () => {
    const colors = new Set([
      'ACE Inhibitor', 'Biguanide', 'Beta Blocker', 'Statin', 'Opioid Agonist',
    ].map((drugClass) => colorFor('class', { drugClass })));
    // Eight colours over five classes: collisions are possible, a single
    // colour for all five would mean the hash is not spreading.
    expect(colors.size).toBeGreaterThan(2);
  });

  it('has no colour for a drug with no value on the axis', () => {
    expect(colorFor('class', { drugClass: null })).toBeNull();
    expect(colorFor('tag', { tags: [] })).toBeNull();
  });

  it('treats not-controlled as a value on the schedule axis', () => {
    // Every drug has a schedule answer, and "no" is one of them -- unlike a
    // class, which a drug can simply lack.
    expect(colorFor('schedule', { schedule: null })).not.toBeNull();
    expect(colorFor('schedule', { schedule: 'CII' })).toBe(SCHEDULE_COLORS.CII);
  });

  it('matches a schedule whatever case it arrives in', () => {
    expect(colorFor('schedule', { schedule: 'civ' })).toBe(SCHEDULE_COLORS.CIV);
  });

  it('lets an override win, and ignores one that is not a colour', () => {
    const key = paletteKey('class', 'Biguanide');
    expect(colorFor('class', { drugClass: 'Biguanide' }, { [key]: '#123456' })).toBe('#123456');

    // A stored value that is not a colour falls back rather than reaching a
    // style attribute: a restored backup is not a reason to render garbage.
    expect(colorFor('class', { drugClass: 'Biguanide' }, { [key]: 'octarine' }))
      .toBe(colorFor('class', { drugClass: 'Biguanide' }));
  });

  it('keys an override by axis, so one value can differ per axis', () => {
    expect(paletteKey('class', 'Opioid')).toBe('class:Opioid');
    expect(paletteKey('schedule', 'CII')).toBe('schedule:CII');
  });
});

describe('readableOnHue', () => {
  it('finds a passing colour on every hue around the wheel', () => {
    // The band is not the same width at every hue: yellow around 60 degrees
    // only clears 3:1 on both grounds at a lower saturation and a darker
    // lightness than blue does. A single fixed lightness would hand out a
    // yellow nobody can see on white.
    for (let hue = 0; hue < 360; hue += 3) {
      const hex = readableOnHue(hue);
      expect(hex, `hue ${hue}`).not.toBeNull();
      expect(checkFill(hex!).ok, `hue ${hue} -> ${hex}`).toBe(true);
    }
  });

  it('wraps, so arithmetic on hues needs no modulo at the call site', () => {
    expect(readableOnHue(370)).toBe(readableOnHue(10));
    expect(readableOnHue(-10)).toBe(readableOnHue(350));
  });
});

describe('hslToHex', () => {
  it('agrees with the obvious cases', () => {
    expect(hslToHex(0, 1, 0.5)).toBe('#ff0000');
    expect(hslToHex(120, 1, 0.5)).toBe('#00ff00');
    expect(hslToHex(240, 1, 0.5)).toBe('#0000ff');
    expect(hslToHex(0, 0, 1)).toBe('#ffffff');
    expect(hslToHex(0, 0, 0)).toBe('#000000');
  });
});

describe('randomPalette', () => {
  const classes = Array.from({ length: 119 }, (_, at) => `class:Class ${at}`);

  it('gives every key a colour that passes the contrast check', () => {
    // The shuffle must not be a way around the check the editor enforces by
    // hand. If this fails, pressing one button fills the app with colours the
    // same screen would have warned about.
    const palette = randomPalette(classes);
    expect(Object.keys(palette)).toHaveLength(classes.length);
    for (const [key, color] of Object.entries(palette)) {
      expect(checkFill(color).ok, `${key} -> ${color}`).toBe(true);
    }
  });

  it('spreads the wheel instead of drawing each hue independently', () => {
    // Independent draws cluster: over a hundred classes you get six
    // near-identical greens and a gap where orange should be. Even spacing is
    // what makes the result look chosen rather than spilt.
    const palette = randomPalette(classes);
    const distinct = new Set(Object.values(palette));
    expect(distinct.size).toBeGreaterThan(classes.length * 0.8);
  });

  it('differs between presses', () => {
    const one = Object.values(randomPalette(classes));
    const two = Object.values(randomPalette(classes));
    expect(one).not.toEqual(two);
  });

  it('is decidable when the rng is', () => {
    // A constant rng rotates by 0 and shuffles to the identity, so the hues
    // come out in order -- which is what makes the spacing assertable at all.
    const keys = ['class:a', 'class:b', 'class:c', 'class:d'];
    const palette = randomPalette(keys, () => 0);
    expect(palette).toEqual(randomPalette(keys, () => 0));
    expect(Object.keys(palette)).toEqual(keys);
  });

  it('has nothing to say about an empty axis', () => {
    expect(randomPalette([])).toEqual({});
  });
});

describe('scheduleBadge', () => {
  it('colours a controlled drug whatever the reader chose to colour by', () => {
    // The axis is not a parameter at all: that is the point of the function.
    const badge = scheduleBadge('CII');
    expect(badge).not.toBeNull();
    expect(badge!.backgroundColor).toBe(SCHEDULE_COLORS.CII);
  });

  it('has no badge to colour when a drug is not controlled', () => {
    expect(scheduleBadge(null)).toBeNull();
    expect(scheduleBadge(undefined)).toBeNull();
    expect(scheduleBadge('')).toBeNull();
  });

  it('still obeys the editor, which writes schedule keys on any axis', () => {
    const badge = scheduleBadge('CIV', { [paletteKey('schedule', 'CIV')]: '#123456' });
    expect(badge!.backgroundColor).toBe('#123456');
  });

  it('ignores an override that is not a colour', () => {
    const badge = scheduleBadge('CIV', { [paletteKey('schedule', 'CIV')]: 'cornflower' });
    expect(badge!.backgroundColor).toBe(SCHEDULE_COLORS.CIV);
  });

  it('picks text that can be read on the fill', () => {
    for (const schedule of Object.keys(SCHEDULE_COLORS)) {
      const badge = scheduleBadge(schedule)!;
      const ratio = contrastRatio(badge.color, badge.backgroundColor);
      expect(ratio, `${schedule} (${ratio.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is what both pages and the preview use, rather than their own rule', () => {
    // Three call sites drifting apart is exactly what the helper is for.
    const sources = [
      'app/drugs/drug-browser.tsx',
      'app/drugs/[slug]/page.tsx',
      'app/settings/page.tsx',
    ];
    for (const path of sources) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).toContain('scheduleBadge(');
    }
  });
});
