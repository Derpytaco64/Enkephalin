import { describe, expect, it } from 'vitest';
import { canonicalIndication, indicationOptions, indicationSlug } from '@/lib/drugs/indications';

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
