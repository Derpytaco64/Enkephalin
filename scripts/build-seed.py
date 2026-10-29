"""Merge the extracted sheet and the RxNorm classes into the seed the app loads.

The flat sheet stores brands and indications as parallel lists, which silently
loses which brand treats which condition. That matters: tirzepatide is listed as
Mounjaro + Zepbound against Diabetes / OSA / Weight management, but Mounjaro is
the diabetes brand and Zepbound the weight-management one. A Brand -> Indication
card built from the flat lists would teach the wrong pair.

So brands and indications become entities, and a brand may link to a subset of
indications. A brand with no links covers all of the drug's indications, which is
the common case (Proventil / Ventolin / Proair are all albuterol for asthma) and
keeps the default free of busywork.

Usage:  python scripts/build-seed.py data/top-drugs-2026.json \
            data/drug-classes-rxnorm.json data/drugs-seed.json
"""
import json, re, sys


def slugify(text):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', text.lower())).strip('-')


# Release and form suffixes. "Wellbutrin SR" is the same brand as "Wellbutrin";
# "Zyban" is a different one. Collapsing them matters twice over: the pairing
# review only applies to drugs with genuinely competing brands (Depakote /
# Depakote ER is one brand, so it needs no review), and sibling forms make
# useless multiple-choice distractors -- three Wellbutrins against one Zyban
# gives the answer away.
FORM_SUFFIX = re.compile(
    r'\s+(SR|XR|ER|XL|CR|DR|LA|ODT|CD|HFA|XR-ODT|Respiclick|Redihaler)\b.*$',
    re.I)


def brand_family(name):
    return FORM_SUFFIX.sub('', name).strip()


# Indication keyword -> class-name fragments that treat it. Used only to ORDER
# class candidates for a human, never to pick one. RxNorm returns candidates
# alphabetically, which buries the right answer: topiramate's ATC list leads
# with "Centrally acting antiobesity products" (true of the phentermine
# combination product) ahead of "Other antiepileptics", though the sheet
# indicates it for seizure.
INDICATION_CLASS_HINTS = {
    r'seizure|epilep|convuls':        ['antiepilep', 'anticonvuls'],
    r'depress':                       ['antidepress', 'serotonin', 'reuptake'],
    r'bipolar|mania':                 ['antipsychot', 'lithium', 'mood'],
    r'psychos|schizo':                ['antipsychot'],
    r'anxiety|panic':                 ['anxiolytic', 'benzodiazep'],
    r'insomnia|sleep':                ['hypnotic', 'sedative', 'benzodiazep'],
    r'diabet':                        ['antidiabet', 'glp-1', 'insulin', 'glucose', 'biguanide'],
    r'obesity|weight':                ['antiobesity', 'appetite', 'glp-1'],
    r'hypertension|blood pressure':   ['antihypertens', 'adrenergic', 'angiotensin', 'calcium channel', 'diuretic'],
    r'heart failure|angina|arrhythm|fibrillat|flutter': ['cardiac', 'antiarrhythm', 'adrenergic', 'glycoside'],
    r'cholesterol|lipid|triglycerid': ['antilipem', 'lipid', 'reductase', 'fibrate'],
    r'thromb|clot|anticoagul|stroke|embol': ['anticoagul', 'antiplatelet', 'thrombo', 'fibrinolytic'],
    r'asthma|copd|bronchospasm':      ['bronchodil', 'adrenergic', 'corticosteroid', 'muscarinic', 'leukotriene'],
    r'pain|headache|migraine':        ['analges', 'opioid', 'anti-inflammat', 'nonsteroidal', 'antimigraine', 'triptan'],
    r'arthrit':                       ['anti-inflammat', 'nonsteroidal', 'antirheumatic'],
    r'gerd|ulcer|reflux|heartburn':   ['proton pump', 'histamine', 'antacid'],
    r'nausea|vomit|emesis':           ['antiemetic', 'serotonin'],
    r'allerg|rhinitis|urticaria':     ['antihistamin', 'histamine', 'corticosteroid'],
    r'infect|bacteri|antibiot':       ['antibacter', 'penicillin', 'cephalospor', 'macrolide', 'quinolone', 'tetracyclin', 'sulfonamide'],
    r'antiviral|herpes|hiv|influenza': ['antiviral'],
    r'fungal|candid':                 ['antifung'],
    r'gout':                          ['antigout', 'uric', 'xanthine'],
    r'osteoporos':                    ['bisphosphon', 'bone'],
    r'thyroid|hypothyroid':           ['thyroid'],
    r'neuropath':                     ['anticonvuls', 'antiepilep', 'gabapentinoid', 'analges'],
    r'contracept':                    ['contracept', 'progestin', 'estrogen'],
    r'menopaus|vasomotor':            ['estrogen'],
    r'glaucoma':                      ['adrenergic', 'prostaglandin', 'carbonic anhydrase'],
    r'bph|prostat':                   ['adrenergic', 'reductase'],
    r'smoking|cessation':             ['smoking', 'nicotin', 'antidepress'],
    r'edema|diures':                  ['diuretic'],
    r'anemia':                        ['erythropoie', 'iron', 'vitamin'],
}


def rank_candidates(candidates, indications):
    """Order class candidates by agreement with the drug's own indications.

    Returns (ordered_list, suggestion). The suggestion is a hint for whoever
    reviews the drug; it is never written to drug_class automatically.
    """
    text = ' '.join(indications).lower()
    wanted = []
    for pattern, fragments in INDICATION_CLASS_HINTS.items():
        if re.search(pattern, text):
            wanted.extend(fragments)

    def score(name):
        low = name.lower()
        # A curated pharmacologic match outranks incidental word overlap.
        # Methenamine is indicated for "Urinary tract infection prevention":
        # bare-word overlap pulls "ANTISPASMODICS,URINARY,OTHER" level with the
        # correct "Other antibacterials" unless the mapped match weighs more.
        hits = 3 * sum(1 for frag in wanted if frag in low)
        hits += sum(1 for word in re.findall(r'[a-z]{5,}', text) if word in low)
        return hits

    scored = sorted(candidates, key=lambda c: (-score(c), c))
    best = scored[0] if scored and score(scored[0]) > 0 else None
    return scored, best


def main():
    sheet_path, classes_path, dest = sys.argv[1], sys.argv[2], sys.argv[3]
    sheet = json.load(open(sheet_path, encoding='utf-8'))
    classes = {c['generic']: c for c in
               json.load(open(classes_path, encoding='utf-8'))['drugs']}

    drugs, review = [], {'class': [], 'pairing': []}
    for row in sheet['drugs']:
        generic = row['generic']
        cls = classes.get(generic, {})

        indications = [{'id': f'{slugify(generic)}--ind-{i}',
                        'text': text.rstrip('*'),
                        'starred': text.endswith('*')}
                       for i, text in enumerate(row['indications'])]

        brands = []
        for i, name in enumerate(row['brands']):
            clean = name.rstrip('*').rstrip(',')
            brands.append({'id': f'{slugify(generic)}--brand-{i}',
                           'name': clean,
                           'family': brand_family(clean),
                           'starred': name.endswith('*'),
                           'indication_ids': [],  # empty = covers all indications
                           'route': None, 'note': None})
        families = {b['family'] for b in brands}

        # The sheet's asterisk appears to pair a brand with a specific
        # indication (Sarafem* <-> Premenstrual dysphoria disorder*). It is an
        # unreliable convention -- tirzepatide has the same split with no
        # asterisk at all, and Adcirca* points at an indication the sheet never
        # lists -- so it only seeds a suggestion, never a committed link.
        starred_inds = [i for i in indications if i['starred']]
        starred_brands = [b for b in brands if b['starred']]
        suggested = (len(starred_brands) == 1 and len(starred_inds) == 1)
        if suggested:
            starred_brands[0]['indication_ids'] = [starred_inds[0]['id']]

        # Once ANY brand is narrowed to specific indications, the siblings'
        # implicit "covers all" stops being a safe default: fluoxetine ends up
        # with Sarafem -> PMDD explicitly while Prozac still silently claims
        # PMDD too. Mark those siblings so the editor can warn instead of
        # letting a wrong pairing look deliberate.
        if any(b['indication_ids'] for b in brands):
            claimed = {i for b in brands for i in b['indication_ids']}
            for brand in brands:
                if not brand['indication_ids']:
                    brand['default_pairing_suspect'] = True
                    brand['suspect_reason'] = (
                        'Covers all indications by default, but a sibling brand '
                        'is narrowed to specific ones. Confirm this brand really '
                        'treats: ' + ', '.join(
                            i['text'] for i in indications if i['id'] in claimed))

        # A drug needs pairing review only when genuinely competing brands meet
        # several indications. Counting raw brands would flag lamotrigine
        # (Lamictal in four forms, one brand) alongside tirzepatide (Mounjaro vs
        # Zepbound, two brands with different indications) -- only the second is
        # a real question.
        needs_pairing = len(families) > 1 and len(indications) > 1
        if needs_pairing:
            review['pairing'].append(generic)
        if cls.get('needs_review', True):
            review['class'].append(generic)

        # Rank the fallback candidates for whoever picks a class by hand.
        indication_text = [i['text'] for i in indications]
        fallbacks = (cls.get('atc', []) + cls.get('va', []))
        ranked, hint = rank_candidates(fallbacks, indication_text)

        drugs.append({
            'slug': slugify(generic),
            'generic': generic,
            'brands': brands,
            'brand_families': sorted(families),
            'indications': indications,
            'class_suggestion': None if cls.get('epc') else hint,
            'class_candidates_ranked': ranked,
            'dosing': row['dosing'],
            'schedule': row['schedule'] or None,
            'schedule_note': row['schedule_note'] or None,
            'moa': row['moa'],
            'bbw': row['bbw'],
            'bbw_status': 'none' if not row['bbw'] else 'from_sheet',
            'drug_class': cls.get('primary_class'),
            'class_candidates': {k: cls.get(k, []) for k in
                                 ('epc', 'atc', 'moa', 'va')},
            'rxcui': cls.get('rxcui'),
            'variants': row['variants'],
            'needs_class_review': cls.get('needs_review', True),
            'needs_pairing_review': needs_pairing,
            'pairing_suggested_by_asterisk': suggested,
            'source_page': row['source_page'],
        })

    json.dump({'source': sheet_path, 'count': len(drugs),
               'year_levels': sheet['year_levels'], 'drugs': drugs},
              open(dest, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)

    print(f'{len(drugs)} drugs -> {dest}')
    print(f'  with drug_class        {sum(1 for d in drugs if d["drug_class"]):>3}')
    print(f'  need class review      {len(review["class"]):>3}')
    print(f'  need brand pairing     {len(review["pairing"]):>3}  {review["pairing"]}')
    print(f'  asterisk suggestions   {sum(1 for d in drugs if d["pairing_suggested_by_asterisk"]):>3}')
    suspect = [(d['generic'], b['name']) for d in drugs for b in d['brands']
               if b.get('default_pairing_suspect')]
    print(f'  suspect brand defaults {len(suspect):>3}  {suspect}')
    hinted = sum(1 for d in drugs if d['class_suggestion'])
    print(f'  class hints for review {hinted:>3} of {len(review["class"])}')
    print(f'  no BBW (answered none) {sum(1 for d in drugs if d["bbw_status"] == "none"):>3}')
    print(f'  scheduled              {sum(1 for d in drugs if d["schedule"]):>3}')


if __name__ == '__main__':
    main()
