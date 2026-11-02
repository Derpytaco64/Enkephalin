import { describe, expect, it } from 'vitest';
import { emptyRegimen, type Regimen } from '@/lib/dosing/model';
import { toEnglish, toSig } from '@/lib/dosing/sig';

function regimen(partial: Partial<Regimen> = {}): Regimen {
  return { ...emptyRegimen(), ...partial };
}

const mg = (low: number, high: number | null = null) =>
  ({ low, high, unit: 'mg' as const, perKg: false, per: null, active: null });

describe('toSig', () => {
  it('prints the plain case', () => {
    const sig = toSig(regimen({
      amounts: [mg(10)],
      routes: ['PO'],
      frequency: { kind: 'per_day', times: 1, timesHigh: null },
    }));

    expect(sig).toBe('10 mg PO QD');
  });

  it('keeps a dose range as a range', () => {
    // 58 of the 237 are written this way. Collapsing to one endpoint would
    // make "200 mg" and "300 mg" both look wrong for allopurinol.
    expect(toSig(regimen({
      amounts: [mg(200, 300)],
      routes: ['PO'],
      frequency: { kind: 'per_day', times: 1, timesHigh: null },
    }))).toBe('200-300 mg PO QD');
  });

  it('combines a frequency with PRN, which is a modifier and not a frequency', () => {
    // Alprazolam: "0.25-0.5 mg by mouth three times a day prn". TID and PRN
    // are both true at once, so PRN cannot be a frequency value.
    expect(toSig(regimen({
      amounts: [mg(0.25, 0.5)],
      routes: ['PO'],
      frequency: { kind: 'per_day', times: 3, timesHigh: null },
      modifiers: ['PRN'],
    }))).toBe('0.25-0.5 mg PO TID PRN');
  });

  it('prints an hour interval, and a range of hours', () => {
    expect(toSig(regimen({
      amounts: [mg(200)],
      routes: ['PO'],
      frequency: { kind: 'interval', low: 4, high: null, unit: 'hour' },
    }))).toBe('200 mg PO Q4H');

    expect(toSig(regimen({
      amounts: [mg(5, 10)],
      routes: ['PO'],
      frequency: { kind: 'interval', low: 4, high: 6, unit: 'hour' },
      modifiers: ['PRN'],
    }))).toBe('5-10 mg PO Q4-6H PRN');
  });

  it('knows QOD and QWK', () => {
    expect(toSig(regimen({
      amounts: [mg(70)],
      routes: ['PO'],
      frequency: { kind: 'interval', low: 1, high: null, unit: 'week' },
    }))).toBe('70 mg PO QWK');

    expect(toSig(regimen({
      amounts: [mg(10)],
      routes: ['PO'],
      frequency: { kind: 'interval', low: 2, high: null, unit: 'day' },
    }))).toBe('10 mg PO QOD');
  });

  it('writes a combination product the way the sheet does', () => {
    // Carbidopa/levodopa is "25/100 mg", one unit named once -- but only
    // because both halves are milligrams.
    expect(toSig(regimen({
      amounts: [mg(25), mg(100)],
      routes: ['PO'],
      frequency: { kind: 'per_day', times: 3, timesHigh: null },
    }))).toBe('25/100 mg PO TID');
  });

  it('never collapses amounts whose units differ', () => {
    // The 15 mg / 15 mL confusion, made structurally impossible: mixed units
    // print in full rather than as a bare "15/15".
    const mixed = toSig(regimen({
      amounts: [mg(15), { low: 15, high: null, unit: 'mL', perKg: false, per: null, active: null }],
      routes: ['PO'],
      frequency: { kind: 'per_day', times: 1, timesHigh: null },
    }));

    expect(mixed).toBe('15 mg + 15 mL PO QD');
  });

  it('counts doses in prescription units', () => {
    // Hydrocodone/APAP: "1-2 tablets by mouth every 4-6 hours as needed".
    expect(toSig(regimen({
      amounts: [{ low: 1, high: 2, unit: 'tablet', perKg: false, per: null, active: null }],
      routes: ['PO'],
      frequency: { kind: 'interval', low: 4, high: 6, unit: 'hour' },
      modifiers: ['PRN'],
    }))).toBe('1-2 tab PO Q4-6H PRN');
  });

  it('puts the dose per site when the sheet says per site', () => {
    // Fluticasone nasal: "2 sprays in each nostril once daily" is two each,
    // four altogether -- the distinction a general dosing actually carries.
    expect(toSig(regimen({
      amounts: [{ low: 2, high: null, unit: 'spray', perKg: false, per: null, active: null }],
      routes: ['NAS'],
      site: { region: 'nostril', basis: 'each', note: null },
      frequency: { kind: 'per_day', times: 1, timesHigh: null },
      // "sprays", because a sig abbreviates (tab, gtt) but pluralises a unit
      // it writes out in full.
    }))).toBe('2 sprays NAS each nostril QD');
  });

  it('keeps "affected" distinct from "each"', () => {
    // Latanoprost says "affected eye", declining to pick a side. That is not
    // the same claim as "each eye".
    expect(toSig(regimen({
      amounts: [{ low: 1, high: null, unit: 'drop', perKg: false, per: null, active: null }],
      routes: ['OPH'],
      site: { region: 'eye', basis: 'affected', note: null },
      frequency: { kind: 'per_day', times: 1, timesHigh: null },
      modifiers: ['PM'],
    }))).toBe('1 gtt OPH affected eye QD PM');
  });

  it('offers every route the sheet offers', () => {
    // Naloxone: "0.4-2 mg IV/IM/subQ every 2-3 minutes as needed up to 10 mg".
    expect(toSig(regimen({
      amounts: [mg(0.4, 2)],
      routes: ['IV', 'IM', 'SC'],
      frequency: { kind: 'interval', low: 2, high: 3, unit: 'minute' },
      modifiers: ['PRN'],
      ceiling: mg(10),
    }))).toBe('0.4-2 mg IV/IM/subQ Q2-3MIN PRN (max 10 mg)');
  });

  it('prints a weight-based infusion rate', () => {
    expect(toSig(regimen({
      amounts: [{ low: 1, high: 20, unit: 'mcg', perKg: true, per: 'minute', active: null }],
      routes: ['IV'],
      frequency: { kind: 'continuous' },
      qualifiers: ['titrated to clinical effect'],
    }))).toBe('1-20 mcg/kg/min IV');
  });

  it('carries a course length and a daily ceiling', () => {
    expect(toSig(regimen({
      amounts: [mg(250, 500)],
      routes: ['PO'],
      frequency: { kind: 'per_day', times: 3, timesHigh: null },
      duration: { low: 7, high: null, unit: 'day', cycleDays: null },
    }))).toBe('250-500 mg PO TID x 7 days');

    expect(toSig(regimen({
      amounts: [mg(12.5)],
      routes: ['PO'],
      frequency: { kind: 'per_day', times: 1, timesHigh: null },
      ceiling: { low: 900, high: null, unit: 'mg', perKg: false, per: 'day', active: null },
      label: 'Initial',
    }))).toBe('Initial: 12.5 mg PO QD (max 900 mg/day)');
  });

  it('says nothing about a frequency the sheet never gave', () => {
    // Amitriptyline's "in divided doses" does not say how many. Inventing a
    // number is the guess this system refuses.
    expect(toSig(regimen({
      amounts: [mg(10, 100)],
      routes: ['PO'],
      frequency: { kind: 'unspecified' },
    }))).toBe('10-100 mg PO');
  });
});

describe('toEnglish', () => {
  it('reads back as a sentence, for comparing against the original prose', () => {
    expect(toEnglish(regimen({
      amounts: [mg(0.25, 0.5)],
      routes: ['PO'],
      frequency: { kind: 'per_day', times: 3, timesHigh: null },
      modifiers: ['PRN'],
    }))).toBe('0.25 to 0.5 mg by mouth three times a day as needed');
  });

  it('names which active got which number, when the sheet lets it be known', () => {
    // Carbidopa/levodopa 25/100 mg is 25 of the one and 100 of the other, not
    // a range from 25 to 100. The sig is written as the product is labelled;
    // the readback names the actives, which is the whole point of a readback.
    const combination = regimen({
      amounts: [
        { ...mg(25), active: 'carbidopa' },
        { ...mg(100), active: 'levodopa' },
      ],
      routes: ['PO'],
      frequency: { kind: 'per_day', times: 3, timesHigh: null },
    });

    expect(toSig(combination)).toBe('25/100 mg PO TID');
    expect(toEnglish(combination)).toBe('25/100 mg (carbidopa/levodopa) by mouth three times a day');

    // Unlabelled, it still reads as a combination rather than a range.
    const unlabelled = regimen({
      amounts: [mg(500), mg(125)],
      routes: ['PO'],
      frequency: { kind: 'interval', low: 8, high: null, unit: 'hour' },
    });
    expect(toEnglish(unlabelled)).toBe('500/125 mg by mouth every 8 hours');
  });

  it('pluralises a countable unit only when the count calls for it', () => {
    expect(toEnglish(regimen({
      amounts: [{ low: 1, high: null, unit: 'drop', perKg: false, per: null, active: null }],
      routes: ['OPH'],
      site: { region: 'eye', basis: 'each', note: null },
      frequency: { kind: 'per_day', times: 2, timesHigh: null },
      // The site says where, so the readback drops the route label rather than
      // stuttering "into the eye in each eye".
    }))).toBe('1 drop in each eye twice a day');

    expect(toEnglish(regimen({
      amounts: [{ low: 2, high: null, unit: 'spray', perKg: false, per: null, active: null }],
      routes: ['NAS'],
      site: { region: 'nostril', basis: 'each', note: null },
      frequency: { kind: 'per_day', times: 1, timesHigh: null },
    }))).toBe('2 sprays in each nostril once a day');
  });

  it('keeps qualifiers visible without letting them into the comparison', () => {
    const titrated = regimen({
      amounts: [{ low: 1, high: 20, unit: 'mcg', perKg: true, per: 'minute', active: null }],
      routes: ['IV'],
      frequency: { kind: 'continuous' },
      qualifiers: ['titrated to clinical effect'],
    });

    expect(toEnglish(titrated)).toBe(
      '1 to 20 mcg/kg/min intravenously as a continuous infusion (titrated to clinical effect)',
    );
    // The qualifier shows, but the sig -- the comparable rendering -- omits it.
    expect(toSig(titrated)).not.toContain('titrated');
  });
});
