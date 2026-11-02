import { describe, expect, it } from 'vitest';
import { parseDosing } from '@/lib/dosing/parse';
import { toSig } from '@/lib/dosing/sig';

/** Every string here is verbatim from the 2026 class sheet. */
const sig = (prose: string, actives: string[] = []) =>
  parseDosing(prose, actives).regimens.map(toSig).join(' | ');

describe('parseDosing', () => {
  it('reads the plain case', () => {
    const result = parseDosing('5 mg by mouth once daily');

    expect(result.status).toBe('parsed');
    expect(result.quizzable).toBe(true);
    expect(toSig(result.regimens[0])).toBe('5 mg PO QD');
  });

  it('keeps a dose range', () => {
    expect(sig('200-300 mg by mouth once a day')).toBe('200-300 mg PO QD');
  });

  it('reads a frequency and PRN as the two separate things they are', () => {
    const result = parseDosing('0.25-0.5 mg by mouth three times a day prn');

    expect(result.regimens[0].frequency).toEqual({ kind: 'per_day', times: 3, timesHigh: null });
    expect(result.regimens[0].modifiers).toEqual(['PRN']);
    expect(toSig(result.regimens[0])).toBe('0.25-0.5 mg PO TID PRN');
  });

  it('counts a frequency written as a range', () => {
    const result = parseDosing('10 mg by mouth 2-3 times a day');
    expect(result.regimens[0].frequency).toEqual({ kind: 'per_day', times: 2, timesHigh: 3 });
    expect(toSig(result.regimens[0])).toBe('10 mg PO 2-3x/day');
  });

  it('keeps a regimen the sheet gives no amount for, and will not quiz it', () => {
    // Nystatin topical is "apply to affected area 2-3 times a day": a real
    // route, site and frequency, and no amount anywhere. Refusing the row
    // would throw away three facts to punish the absence of a fourth.
    const result = parseDosing('Apply to affected area 2-3 times a day');

    expect(result.regimens[0].routes).toEqual(['TOP']);
    expect(result.regimens[0].site).toEqual({ region: 'skin', basis: 'affected', note: null });
    expect(result.notes).toContain('The source never gives an amount.');
    expect(result.quizzable).toBe(false);
  });

  it('splits alternatives, carrying the route across the OR', () => {
    // The sheet states the route once and lets it stand: both halves are oral.
    const result = parseDosing('10 mg orally once daily OR 70 mg once weekly');

    expect(result.regimens).toHaveLength(2);
    expect(result.regimens.map(toSig)).toEqual(['10 mg PO QD', '70 mg PO QWK']);
    expect(result.status).toBe('parsed');
  });

  it('splits a sequence into labelled steps', () => {
    const result = parseDosing('200 mg by mouth initially then 100 mg every 12 hours');

    expect(result.regimens).toHaveLength(2);
    expect(result.regimens.map((regimen) => [regimen.step, regimen.label])).toEqual([
      [0, 'Initial'],
      [1, 'then'],
    ]);
    // The loading dose has no frequency, because it is one dose; the
    // maintenance dose inherits the route stated only on the first step.
    expect(result.regimens.map(toSig)).toEqual(['Initial: 200 mg PO', 'then: 100 mg PO Q12H']);
    expect(result.regimens[0].frequency).toEqual({ kind: 'unspecified' });
  });

  it('does not read a combination out of a per-kilogram dose', () => {
    // The slash trap: "0.6 mg/kg" is one amount per weight, and reading "0.6"
    // and "kg" as two things would both mis-dose it and leave residue.
    const result = parseDosing('0.6 mg/kg IV');

    expect(result.regimens[0].amounts).toEqual([
      { low: 0.6, high: null, unit: 'mg', perKg: true, per: null, active: null },
    ]);
    expect(toSig(result.regimens[0])).toBe('0.6 mg/kg IV');
  });

  it('reads a rate as one amount per weight per time', () => {
    const result = parseDosing('1-20 mcg/kg/minute IV titrated to clinical effect');

    expect(result.regimens[0].amounts[0]).toEqual({
      low: 1, high: 20, unit: 'mcg', perKg: true, per: 'minute', active: null,
    });
    // Titrated dosing has no single right answer to build options against.
    expect(result.quizzable).toBe(false);
  });

  it('reads a combination strength as two amounts', () => {
    const result = parseDosing('500/125 mg by mouth every 8 hours', ['amoxicillin', 'clavulanate']);

    expect(result.regimens[0].amounts.map((amount) => [amount.low, amount.active])).toEqual([
      [500, 'amoxicillin'],
      [125, 'clavulanate'],
    ]);
    expect(toSig(result.regimens[0])).toBe('500/125 mg PO Q8H');
  });

  it('reads a combination whose halves each name a unit', () => {
    const result = parseDosing('200 mg/25 mg capsule by mouth twice daily');

    expect(result.regimens[0].amounts.map((amount) => amount.low)).toEqual([200, 25]);
    expect(result.status).toBe('parsed');
  });

  it('will not say which active got which number when the counts disagree', () => {
    // Three names, two numbers. Pinning 125 to the clavulanate would be a
    // guess, and a guess about a dose is the worst kind here.
    const result = parseDosing('500/125 mg by mouth every 8 hours', ['butalbital', 'acetaminophen', 'caffeine']);

    expect(result.regimens[0].amounts.every((amount) => amount.active === null)).toBe(true);
    expect(result.notes.join(' ')).toContain('which number belongs to which drug is unconfirmed');
  });

  it('knows the dose is the actuation and the strength is the product', () => {
    // "1 inhalation of 100/25 mcg daily": the dose given is one inhalation.
    // Reading 100/25 mcg as the dose is wrong, not merely incomplete.
    const result = parseDosing('1 inhalation of 100/25 mcg daily');

    expect(result.regimens[0].amounts).toEqual([
      { low: 1, high: null, unit: 'inhalation', perKg: false, per: null, active: null },
    ]);
    expect(result.regimens[0].qualifiers.join(' ')).toContain('100/25 mcg per inhalation');
    expect(toSig(result.regimens[0])).toBe('1 inh INH QD');
  });

  it('reads a count written as a word', () => {
    expect(sig('One drop into affected eye once a day in the evening'))
      .toBe('1 gtt OPH affected eye QD PM');
  });

  it('tells "each" from "affected"', () => {
    expect(parseDosing('2 sprays in each nostril once daily').regimens[0].site)
      .toEqual({ region: 'nostril', basis: 'each', note: null });

    expect(parseDosing('2 drops in affected eye four times daily').regimens[0].site)
      .toEqual({ region: 'eye', basis: 'affected', note: null });
  });

  it('takes a ceiling out of its parentheses', () => {
    const result = parseDosing('Initial 12.5 mg by mouth 1-2 times a day (MAX 900 mg/day)');

    expect(result.regimens[0].ceiling).toEqual({
      low: 900, high: null, unit: 'mg', perKg: false, per: 'day', active: null,
    });
  });

  it('reads a course length', () => {
    const result = parseDosing('250-500 mg by mouth three times daily for 7 days');

    expect(result.regimens[0].duration).toEqual({ low: 7, high: null, unit: 'day', cycleDays: null });
    expect(toSig(result.regimens[0])).toBe('250-500 mg PO TID x 7 days');
  });

  it('keeps the product form as a qualifier rather than treating it as residue', () => {
    const result = parseDosing('5-20 mg (XR) by mouth once a day');

    expect(result.status).toBe('parsed');
    expect(result.regimens[0].qualifiers).toContain('XR');
    expect(toSig(result.regimens[0])).toBe('5-20 mg PO QD');
  });

  it('reads a bedtime or morning dose as a once-a-day dose', () => {
    // How a pharmacist reads it: a bedtime dose is one dose a day.
    expect(sig('5-10 mg by mouth at bedtime')).toBe('5-10 mg PO QD HS');
    expect(sig('5-10 mg by mouth in the morning')).toBe('5-10 mg PO QD AM');
  });

  /* ------------------------------------------------ refusing to guess ----- */

  it('refuses a row whose meaning it would have to drop', () => {
    // The guard: "three days per day" is a typo in the sheet. Rather than
    // quietly reading "three times a day" out of it, the row is refused.
    const result = parseDosing('250-350 mg by mouth three days per day and at bedtime');

    expect(result.status).toBe('refused');
    expect(result.regimens).toEqual([]);
    expect(result.unconsumed.length).toBeGreaterThan(0);
  });

  it('refuses rather than reading a dose out of a product table', () => {
    const result = parseDosing(
      'Capsule - 50 mg/300 mg/40 mg Tablet - 50 mg/325 mg/40 mg Dose - 1-2 capsule/tablet every four hours as needed',
    );

    expect(result.status).toBe('refused');
  });

  it('refuses an empty dosing', () => {
    expect(parseDosing('').status).toBe('refused');
    expect(parseDosing('   ').status).toBe('refused');
  });

  it('will not quiz a dose the source individualises', () => {
    const result = parseDosing('0.125-0.25 mg by mouth once a day (dose individualized based on serum levels)');

    // The components are good -- the profile and flashcards can use them.
    expect(toSig(result.regimens[0])).toBe('0.125-0.25 mg PO QD');
    // Multiple choice cannot, because there is no single right answer.
    expect(result.quizzable).toBe(false);
    expect(result.status).toBe('needs_review');
  });

  it('will not quiz a frequency the source never fixed', () => {
    const result = parseDosing('500 mg by mouth on day 1');

    expect(result.regimens[0].frequency).toEqual({ kind: 'unspecified' });
    expect(result.quizzable).toBe(false);
    expect(result.notes).toContain('The source never gives a frequency.');
  });

  it('flags a daily total whose division the source leaves open', () => {
    // "4 grams daily in 1 or 2 doses" is QD or BID, and the sheet does not say
    // which. Printing a confident QD would be the quiet kind of wrong.
    const result = parseDosing('4 grams daily in 1 or 2 doses with meals');

    expect(result.status).toBe('needs_review');
    expect(result.notes.join(' ')).toContain('without saying how it is divided');
  });

  it('asks for a route the source never gave, without failing the row', () => {
    const result = parseDosing('100 mg three time daily as needed');

    expect(result.status).toBe('needs_review');
    expect(result.notes).toContain('The source never gives a route.');
    // Still usable: route simply is not among the things compared.
    expect(result.quizzable).toBe(true);
    expect(toSig(result.regimens[0])).toBe('100 mg TID PRN');
  });
});
