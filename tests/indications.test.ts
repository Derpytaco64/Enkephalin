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

  it('keeps the fuller wording as the label', () => {
    expect(canonicalIndication('BPH')).toBe('Benign prostatic hypertrophy (BPH)');
  });
});

describe('indicationOptions', () => {
  it('counts drugs rather than rows', () => {
    const options = indicationOptions([
      { drugId: 'a', text: 'Seizure' },
      // Same drug written up both ways: one drug, not two.
      { drugId: 'a', text: 'Seizures' },
      { drugId: 'b', text: 'Seizures' },
      { drugId: 'c', text: 'Hypertension' },
    ]);

    expect(options).toEqual([
      { slug: 'hypertension', label: 'Hypertension', count: 1 },
      { slug: 'seizure', label: 'Seizure', count: 2 },
    ]);
  });

  it('drops text that slugs to nothing', () => {
    expect(indicationOptions([{ drugId: 'a', text: '  ' }])).toEqual([]);
  });
});
