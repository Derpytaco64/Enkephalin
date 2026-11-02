import { describe, expect, it } from 'vitest';
import {
  canonicalIndication, indicationOptions, indicationSlug, nearestIndication,
} from '@/lib/drugs/indications';

describe('indicationSlug', () => {
  it('folds the sheet wording the sheet wrote twice', () => {
    // The sheet has both spellings; picking one and missing the other's drugs
    // is the bug this exists to prevent.
    expect(indicationSlug('Seizures')).toBe(indicationSlug('Seizure'));
    expect(indicationSlug('Bacterial infections')).toBe(indicationSlug('Bacterial infection'));
    expect(indicationSlug('BPH')).toBe(indicationSlug('Benign prostatic hypertrophy (BPH)'));
  });

  it('leaves anything needing a clinical judgement alone', () => {
    // "Chronic pain" is not "Pain" and nothing in this file is entitled to
    // decide that it is.
    expect(indicationSlug('Chronic pain')).not.toBe(indicationSlug('Pain'));
    expect(indicationSlug('Acute ischemic stroke')).not.toBe(indicationSlug('Ischemic stroke prevention'));
  });

  it('survives the punctuation the sheet uses', () => {
    expect(indicationSlug('Musculoskeletal pain/spasm')).toBe('musculoskeletal-pain-spasm');
    expect(indicationSlug('Alzheimer’s disease')).toBe('alzheimer-s-disease');
  });

  it('settles on one wording, plural where the sheet disagrees', () => {
    // Not just comparable: this is what every writer stores, so the database
    // holds one spelling and a profile reads the same words as a quiz option.
    expect(canonicalIndication('Seizure')).toBe('Seizures');
    expect(canonicalIndication('Bacterial infection')).toBe('Bacterial infections');
    // BPH is not a plural question; the expansion teaches the abbreviation.
    expect(canonicalIndication('BPH')).toBe('Benign prostatic hypertrophy (BPH)');
    // Anything with one spelling is left exactly as it is.
    expect(canonicalIndication('Hypertension')).toBe('Hypertension');
  });
});

describe('the wordings the sheet got wrong', () => {
  it('corrects the two the source PDF broke across a line', () => {
    // The extractor kept the PDF's mid-word line break. Nothing about this is
    // a judgement, so it belongs in the alias table with the plurals.
    expect(canonicalIndication('Keratoconjuncti vitis sicca (Dry eye syndrome)'))
      .toBe('Keratoconjunctivitis sicca (Dry eye syndrome)');
    expect(canonicalIndication('Ophthalmic anti- inflammatory')).toBe('Ophthalmic anti-inflammatory');
  });

  it('corrects the one the sheet itself misspelled', () => {
    expect(canonicalIndication('Pruritis')).toBe('Pruritus');
  });

  it('keeps them corrected through a re-import, which is the point', () => {
    // The sheet still says "Pruritis". The table is what stops a re-import
    // putting it back beside the corrected row.
    expect(indicationSlug('Pruritis')).toBe(indicationSlug('Pruritus'));
  });
});

describe('nearestIndication', () => {
  const known = [
    'Dyslipidemia', 'Pruritus', 'Pain', 'Chronic pain', 'Rhinitis', 'Allergic rhinitis',
    'Panic disorder', 'Seizures',
  ];

  it('spots a slip of a character or two', () => {
    expect(nearestIndication('Dyslipidimia', known)?.label).toBe('Dyslipidemia');
    expect(nearestIndication('Pruritas', known)?.label).toBe('Pruritus');
    expect(nearestIndication('Panic disorderr', known)?.label).toBe('Panic disorder');
  });

  it('says nothing about a wording that already exists', () => {
    // Nothing to warn about: it is not new. The alias table counts here too,
    // so the three the sheet got wrong resolve rather than warn -- "Pruritis"
    // *is* "Pruritus" now, and only a slip nobody has catalogued needs saying.
    expect(nearestIndication('Dyslipidemia', known)).toBeNull();
    expect(nearestIndication('Seizure', known)).toBeNull();
    expect(nearestIndication('Pruritis', known)).toBeNull();
  });

  it('leaves genuinely different indications alone', () => {
    // These are the pairs the alias table deliberately refuses to fold, and a
    // warning that cried typo at them would teach people to ignore it.
    expect(nearestIndication('Chronic pain', known)).toBeNull();
    expect(nearestIndication('Allergic rhinitis', known)).toBeNull();
    expect(nearestIndication('Gout', known)).toBeNull();
  });

  it('stays quiet on wording too short to compare', () => {
    expect(nearestIndication('ADHD', ['ADHS'])).toBeNull();
  });

  it('picks the closest when several are near', () => {
    const match = nearestIndication('Pruritos', ['Pruritus', 'Pruritas', 'Pain']);
    expect(match?.label).toBe('Pruritus');
    expect(match?.distance).toBe(1);
  });
});

describe('indicationOptions', () => {
  it('counts drugs rather than rows', () => {
    // The vocabulary makes two spellings one row, so the double-counting this
    // guards against now arrives as the same slug reached twice -- a drug on
    // both an indication and, through a brand, the same one again.
    const options = indicationOptions([
      { drugId: 'a', slug: 'seizures', label: 'Seizures' },
      { drugId: 'a', slug: 'seizures', label: 'Seizures' },
      { drugId: 'b', slug: 'seizures', label: 'Seizures' },
      { drugId: 'c', slug: 'hypertension', label: 'Hypertension' },
    ]);

    expect(options).toEqual([
      { slug: 'hypertension', label: 'Hypertension', count: 1 },
      { slug: 'seizures', label: 'Seizures', count: 2 },
    ]);
  });

  it('ignores a row with no slug', () => {
    expect(indicationOptions([{ drugId: 'a', slug: '', label: '  ' }])).toEqual([]);
  });
});
