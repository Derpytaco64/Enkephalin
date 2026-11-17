import { describe, expect, it } from 'vitest';
import {
  canonicalIndication, indicationHeads, indicationOptions, indicationSlug, nearestIndication,
  qualifierOf,
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

describe('indicationHeads', () => {
  it('lets the vocabulary name its own heads', () => {
    // No curated list of conditions: "Gonorrhea" is a head because the library
    // already writes it on its own and writes longer things containing it.
    const heads = indicationHeads([
      'Gonorrhea',
      'Gonorrhea in pregnancy',
      'Uncomplicated gonorrhea (first line)',
      'Hypertension',
    ]);

    expect(heads.get('Gonorrhea in pregnancy')).toBe('Gonorrhea');
    expect(heads.get('Uncomplicated gonorrhea (first line)')).toBe('Gonorrhea');
    // Its own head, which is what every unqualified indication gets.
    expect(heads.get('Gonorrhea')).toBe('Gonorrhea');
    expect(heads.get('Hypertension')).toBe('Hypertension');
  });

  it('takes the condition named first, not the one named loudest', () => {
    // The bug this rule exists for: "Antibiotic" is a real label, genuinely
    // present in the longer wording, and 50 characters in. Position is what
    // keeps a skin infection from filing itself under a drug class.
    const heads = indicationHeads([
      'Antibiotic',
      'Skin and soft tissue infections',
      'Severe purulent skin and soft tissue infection after oral antibiotics',
    ]);

    expect(heads.get('Severe purulent skin and soft tissue infection after oral antibiotics'))
      .toBe('Skin and soft tissue infections');
  });

  it('matches across a plural, because the sources do not agree about one', () => {
    const heads = indicationHeads([
      'Intra-abdominal infections',
      'Complicated intra-abdominal infection, with metronidazole',
    ]);

    expect(heads.get('Complicated intra-abdominal infection, with metronidazole'))
      .toBe('Intra-abdominal infections');
  });

  it('follows a chain to the condition at the end of it', () => {
    // "Adjunct for hypoxemic Pneumocystis pneumonia" nominates "Pneumocystis
    // pneumonia", which nominates "Pneumonia". A head has to be a condition,
    // not another qualified indication, or the picker offers two entries where
    // a reader expects one.
    const heads = indicationHeads([
      'Pneumonia',
      'Pneumocystis pneumonia',
      'Adjunct for hypoxemic Pneumocystis pneumonia',
    ]);

    expect(heads.get('Adjunct for hypoxemic Pneumocystis pneumonia')).toBe('Pneumonia');
  });

  it('never reads non-small cell lung cancer as small cell', () => {
    // Two different diseases with different treatment, and one spelling sits
    // inside the other. The hyphen is the only thing separating them, so it
    // counts as part of the word.
    const heads = indicationHeads([
      'Metastatic non-small cell lung cancer, ALK-positive, first line',
      'Relapsed small cell lung cancer',
    ]);

    expect(heads.get('Metastatic non-small cell lung cancer, ALK-positive, first line'))
      .toBe('Non-small cell lung cancer (NSCLC)');
    expect(heads.get('Relapsed small cell lung cancer')).toBe('Small cell lung cancer (SCLC)');
  });

  it('groups a condition the sources spell two ways with no word in common', () => {
    // "rhinosinusitis" is one word, so no boundary matching finds "sinusitis"
    // inside it. This is what `HEAD_PHRASES` is for.
    const heads = indicationHeads([
      'Sinusitis',
      'Acute bacterial rhinosinusitis (first line)',
    ]);

    expect(heads.get('Acute bacterial rhinosinusitis (first line)')).toBe('Sinusitis');
  });

  it('refuses to let a strategy be a condition', () => {
    // Expedited partner therapy is how a drug is given. Without the override
    // it wins on position -- it is a label of its own and it comes first.
    const heads = indicationHeads([
      'Gonorrhea',
      'Expedited partner therapy',
      'Expedited partner therapy for gonorrhea',
    ]);

    expect(heads.get('Expedited partner therapy for gonorrhea')).toBe('Gonorrhea');
    // Bare, too. Doxycycline carries the unqualified wording and its own
    // dosing for it reads "with cefixime for gonorrhea", so the condition is
    // known even where the indication does not name it. Azithromycin is the
    // one that means chlamydia, and says so.
    expect(heads.get('Expedited partner therapy')).toBe('Gonorrhea');

    const chlamydia = indicationHeads([
      'Chlamydia',
      'Expedited partner therapy',
      'Expedited partner therapy for chlamydia',
    ]);
    expect(chlamydia.get('Expedited partner therapy for chlamydia')).toBe('Chlamydia');
  });

  it('files the antiretroviral switches under HIV', () => {
    // Four combination antiretrovirals on ID Exam 4. Switching a suppressed
    // patient is something you do about HIV, not a condition of its own.
    const heads = indicationHeads([
      'HIV treatment',
      'Switch during viral suppression',
      'Switch during viral suppression in adults',
    ]);

    expect(heads.get('Switch during viral suppression')).toBe('HIV treatment');
    expect(heads.get('Switch during viral suppression in adults')).toBe('HIV treatment');
  });

  it('calls candidiasis candidiasis wherever the fungus is found', () => {
    const heads = indicationHeads([
      'Vulvovaginal candidiasis',
      'Oropharyngeal candidiasis (first line)',
      'Step-down therapy for susceptible invasive candidiasis',
      'Candidemia in non-neutropenic patients (or an echinocandin)',
      'Candida infection',
    ]);

    for (const label of heads.keys()) expect(heads.get(label)).toBe('Candidiasis');
  });
});

describe('qualifierOf', () => {
  it('keeps the connective where the condition came first', () => {
    // "in pregnancy" says more than "pregnancy", and "when chlamydia has not
    // been ruled out" says much more than the noun phrase inside it.
    expect(qualifierOf('Gonorrhea in pregnancy', 'Gonorrhea')).toBe('in pregnancy');
    expect(qualifierOf('Gonorrhea when chlamydia has not been ruled out', 'Gonorrhea'))
      .toBe('when chlamydia has not been ruled out');
    expect(qualifierOf('Gonorrhea, alternative with gentamicin', 'Gonorrhea'))
      .toBe('alternative with gentamicin');
  });

  it('drops the connective left dangling where the condition came last', () => {
    expect(qualifierOf('Expedited partner therapy for gonorrhea', 'Gonorrhea'))
      .toBe('Expedited partner therapy');
  });

  it('leaves a bracket it did not open', () => {
    // Trimming punctuation by character class ate the closing bracket, which
    // is a worse read than the tidying was worth.
    expect(qualifierOf('Gonorrhea, alternative to ceftriaxone (with azithromycin)', 'Gonorrhea'))
      .toBe('alternative to ceftriaxone (with azithromycin)');
  });

  it('gives up rather than cut a condition out of the middle', () => {
    // "Uncomplicated (first line)" is damage, not a qualifier, so the caller
    // shows the whole label -- never wrong, only longer.
    expect(qualifierOf('Uncomplicated gonorrhea (first line)', 'Gonorrhea')).toBeNull();
  });

  it('is null where the label is the head', () => {
    expect(qualifierOf('Gonorrhea', 'Gonorrhea')).toBeNull();
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
      { slug: 'hypertension', label: 'Hypertension', count: 1, qualifiers: [] },
      { slug: 'seizures', label: 'Seizures', count: 2, qualifiers: [] },
    ]);
  });

  it('ignores a row with no slug', () => {
    expect(indicationOptions([{ drugId: 'a', slug: '', label: '  ' }])).toEqual([]);
  });

  it('offers one condition and carries every wording of it', () => {
    // The bug: 730 labels in the picker, 68% of them worth a single drug, and
    // picking one narrowed 41 drugs to one. A suggestion list that punishes
    // you for using it is worse than no suggestion list.
    const options = indicationOptions([
      { drugId: 'a', slug: 'pneumonia', label: 'Pneumonia' },
      { drugId: 'b', slug: 'community-acquired-pneumonia-cap', label: 'Community-acquired pneumonia (CAP)' },
      { drugId: 'c', slug: 'pneumonia-in-pregnancy', label: 'Pneumonia in pregnancy' },
    ]);

    expect(options).toHaveLength(1);
    expect(options[0].slug).toBe('pneumonia');
    expect(options[0].count).toBe(3);
    // The head's own wording is not a qualifier of itself.
    expect(options[0].qualifiers).toEqual(['Community-acquired pneumonia (CAP)', 'in pregnancy']);
  });
});
