import { describe, expect, it } from 'vitest';
import { extractRoutes } from '@/lib/content/routes';

const routesOf = (name: string, dosing?: string | null) => extractRoutes({ name, dosing }).routes;

describe('extractRoutes', () => {
  it('reads the route a name states, over anything the dosing says', () => {
    expect(extractRoutes({ name: 'Methylprednisolone (oral)', dosing: 'Individualized' })).toEqual({
      routes: ['Oral'],
      source: 'name',
    });
    expect(routesOf('Diclofenac (topical)')).toEqual(['Topical']);
    expect(routesOf('Fentanyl Transdermal Patch')).toEqual(['Transdermal']);
    expect(routesOf('Ofloxacin Ophthalmic', '1-2 drops into conjunctival sac')).toEqual(['Ophthalmic']);
  });

  it('reads several routes from a name that lists them', () => {
    // The one drug the sheet gives three routes, and the case the future
    // per-route subsystem exists for.
    expect(routesOf('Estradiol Oral Topical Vaginal')).toEqual(['Oral', 'Topical', 'Vaginal']);
  });

  it('reads the common dosing phrasings', () => {
    expect(routesOf('Lisinopril', '10 mg by mouth once a day')).toEqual(['Oral']);
    expect(routesOf('Acyclovir', '200 mg orally every 4 hours')).toEqual(['Oral']);
    expect(routesOf('Semaglutide', 'Initial dose 0.25 mg injected subQ once weekly')).toEqual(['Subcutaneous']);
    expect(routesOf('Albuterol', '2 puffs every 4-6 hours as needed')).toEqual(['Inhaled']);
    expect(routesOf('Fluticasone', '1 spray in each nostril daily')).toEqual(['Nasal']);
  });

  it('keeps both routes when the sheet gives a choice', () => {
    expect(routesOf('Ceftriaxone', '1-2 g IV/IM every 24 hours')).toEqual(['IV', 'IM']);
    expect(routesOf('Naloxone', '0.4-2 mg IV/IM/subQ every 2-3 minutes')).toEqual([
      'IV',
      'IM',
      'Subcutaneous',
    ]);
  });

  it('does not read Schedule IV as the intravenous route', () => {
    expect(routesOf('Alprazolam', '0.25 mg by mouth; Schedule IV controlled substance')).toEqual(['Oral']);
  });

  it('prefers ophthalmic over topical when the text says eye', () => {
    expect(routesOf('Prednisolone Acetate', 'Apply 1-2 drops to the affected eye four times a day')).toEqual([
      'Topical',
      'Ophthalmic',
    ]);
  });

  it('returns nothing rather than inferring from clinical knowledge', () => {
    // An infusion rate implies intravenous to a pharmacist, and insulin is
    // obviously subcutaneous -- but neither text says so, and guessing is how
    // a study aid teaches something confidently wrong.
    expect(extractRoutes({ name: 'Norepinephrine', dosing: '0.05-0.15 mcg/kg/minute, titrated' })).toEqual({
      routes: [],
      source: null,
    });
    expect(routesOf('Insulin degludec', 'Long acting Individualized dosing administered once daily')).toEqual([]);
    expect(routesOf('Vancomycin', 'Individualized doses Monitor trough levels')).toEqual([]);
    expect(routesOf('Memantine', '5-10 mg daily')).toEqual([]);
  });

  it('keeps a route the name states even when it names a category', () => {
    // "(parenteral)" is broader than IV or IM, but it is what the sheet says,
    // and recording it beats throwing stated evidence away.
    expect(routesOf('Methylprednisolone sodium succinate (parenteral)', 'Individualized')).toEqual([
      'Parenteral',
    ]);
  });

  it('reports which source answered, so a backfill can say what it read', () => {
    expect(extractRoutes({ name: 'Lisinopril', dosing: '10 mg by mouth' }).source).toBe('dosing');
    expect(extractRoutes({ name: 'Nystatin (topical)', dosing: '' }).source).toBe('name');
  });
});
