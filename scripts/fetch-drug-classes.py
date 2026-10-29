"""Resolve drug classes for the Top Drugs dataset via RxNorm / RxClass.

The class sheet has no Drug Class column, but class drives same-class distractor
generation, filtering, and color coding. This is the one bulk lookup the project
allows, because a classification is a fact to be looked up rather than prose to
be written. Output is a review file: every row carries its resolution path so a
human can audit it before it reaches the database.

Usage:  python scripts/fetch-drug-classes.py data/top-drugs-2026.json \
            data/drug-classes-rxnorm.json [cache_dir]
"""
import json, re, sys, time, urllib.parse, urllib.request, os

API   = 'https://rxnav.nlm.nih.gov/REST'
PAUSE = 0.06                      # RxNav asks for <= 20 requests/second
SALTS = (r'\b(sulfate|sodium|hydrochloride|hcl|tartrate|succinate|besylate|'
         r'maleate|potassium|calcium|fumarate|mesylate|citrate|acetate|'
         r'bromide|furoate|propionate|valerate|phosphate|nitrate|salts)\b')
# Release, route, and form qualifiers the sheet appends to generic names.
# RxNorm indexes the ingredient, so "Clonidine ER" and "Fentanyl Transdermal
# Patch" only resolve once these are stripped.
FORMS = (r'\b(ER|XR|SR|CR|DR|LA|XL|oral|topical|vaginal|nasal|ophthalmic|'
         r'otic|rectal|transdermal|parenteral|injection|patch|inhaled|'
         r'inhalation|cream|ointment|solution|suspension|tablet|capsule)\b')

_cache_dir = None


def fetch(path, params):
    """GET with an on-disk cache so re-runs cost nothing."""
    url = f'{API}/{path}?' + urllib.parse.urlencode(params)
    key = re.sub(r'[^A-Za-z0-9]+', '_', url)[-150:] + '.json'
    cached = os.path.join(_cache_dir, key)
    if os.path.exists(cached):
        with open(cached, encoding='utf-8') as fh:
            return json.load(fh)
    time.sleep(PAUSE)
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.load(resp)
    with open(cached, 'w', encoding='utf-8') as fh:
        json.dump(data, fh)
    return data


def candidates(name):
    """Spellings to try, best first.

    Covers PDF artifacts the extractor cannot fix on its own: the generic column
    wraps mid-word without a hyphen, so "Hydrochlorothiazi de" must be retried
    with the space closed. RxNorm recognising a candidate is what confirms it.
    """
    out, seen = [], set()

    def add(c):
        c = re.sub(r'\s+', ' ', c).strip(' ,')
        if c and c.lower() not in seen:
            seen.add(c.lower())
            out.append(c)

    add(name)
    base = re.sub(r'\s*\([^)]*\)', '', name)          # drop "(ophthalmic)"
    base = re.sub(r'\s*/\s*', '/', base)
    add(base)
    # close a wrap that split a word: "...thiazi de" -> "...thiazide"
    for m in re.finditer(r'(?<=[a-z]) (?=[a-z]{1,3}\b)', base):
        add(base[:m.start()] + base[m.start() + 1:])
    stripped = re.sub(FORMS, '', base, flags=re.I)
    add(stripped)
    add(re.sub(SALTS, '', stripped, flags=re.I))
    add(re.sub(SALTS, '', base, flags=re.I))
    # "Cyanocobalamin Vitamin B-12" -> the leading ingredient token
    add(base.split()[0] if base.split() else base)
    return out


def components(name):
    """Split a combination product into its ingredients.

    The sheet writes combinations three ways: "Amoxicillin/ Clavulanate",
    "Codeine phosphate with Guaifenesin", and "Butalbital, Acetaminophen and
    Caffeine".
    """
    name = re.sub(r'\s*\([^)]*\)', '', name)
    parts = re.split(r'\s*/\s*|\s+with\s+|\s*,\s*|\s+and\s+', name, flags=re.I)
    parts = [re.sub(FORMS, '', p, flags=re.I).strip() for p in parts]
    return [p for p in parts if len(p) > 2]


def rxcui(name):
    for cand in candidates(name):
        for search in (2, 1):
            got = fetch('rxcui.json', {'name': cand, 'search': search})
            ids = got.get('idGroup', {}).get('rxnormId') or []
            if ids:
                return ids[0], cand
    return None, None


def classes(cui):
    data = fetch('rxclass/class/byRxcui.json', {'rxcui': cui})
    rows = data.get('rxclassDrugInfoList', {}).get('rxclassDrugInfo', [])
    out = {'epc': [], 'atc': [], 'moa': [], 'va': []}
    for row in rows:
        item = row['rxclassMinConceptItem']
        kind, src = item['classType'], row.get('relaSource')
        name = item['className']
        if kind == 'EPC' and src in ('FDASPL', 'DAILYMED'):
            out['epc'].append(name)
        elif kind == 'ATC1-4' and src == 'ATC':
            out['atc'].append(name)
        elif kind == 'MOA' and src in ('FDASPL', 'DAILYMED'):
            out['moa'].append(name)
        elif kind == 'VA' and src == 'VA':
            out['va'].append(name)
    return {k: sorted(set(v)) for k, v in out.items()}


def resolve(generic):
    cui, matched = rxcui(generic)
    if cui:
        got = classes(cui)
        if any(got.values()):
            return {'rxcui': cui, 'matched_as': matched,
                    'path': 'direct' if matched == generic else 'normalized',
                    **got}
    # Combination product: union the ingredients' classes.
    parts = components(generic)
    if len(parts) > 1:
        merged = {'epc': [], 'atc': [], 'moa': [], 'va': []}
        cuis, names = [], []
        for part in parts:
            pcui, pmatch = rxcui(part)
            if not pcui:
                continue
            cuis.append(pcui)
            names.append(pmatch)
            for k, v in classes(pcui).items():
                merged[k].extend(v)
        if cuis:
            return {'rxcui': '+'.join(cuis), 'matched_as': ' / '.join(names),
                    'path': 'components',
                    **{k: sorted(set(v)) for k, v in merged.items()}}
    return {'rxcui': cui, 'matched_as': matched,
            'path': 'unresolved' if not cui else 'no-classes',
            'epc': [], 'atc': [], 'moa': [], 'va': []}


def main():
    global _cache_dir
    src, dest = sys.argv[1], sys.argv[2]
    _cache_dir = sys.argv[3] if len(sys.argv) > 3 else '.rxnav-cache'
    os.makedirs(_cache_dir, exist_ok=True)

    drugs = json.load(open(src, encoding='utf-8'))['drugs']
    results, counts = [], {}
    for i, d in enumerate(drugs, 1):
        got = resolve(d['generic'])
        counts[got['path']] = counts.get(got['path'], 0) + 1
        # EPC is the FDA's Established Pharmacologic Class and reads the way a
        # pharmacy course does ("Proton Pump Inhibitor"). Anything without one
        # falls to a human rather than guessing from ATC, which classifies by
        # product and can mislabel a drug by its combination-product sibling.
        results.append({
            'generic': d['generic'],
            'primary_class': got['epc'][0] if got['epc'] else None,
            'needs_review': not got['epc'],
            **got,
        })
        if i % 40 == 0:
            print(f'  ...{i}/{len(drugs)}', flush=True)

    json.dump({'source': src, 'count': len(results), 'drugs': results},
              open(dest, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)

    print(f'\nresolved {len(results)} drugs -> {dest}')
    for k, v in sorted(counts.items(), key=lambda x: -x[1]):
        print(f'  {k:<12} {v:>3}')
    withepc = sum(1 for r in results if r['epc'])
    print(f'\n  has EPC      {withepc:>3}  {100 * withepc / len(results):.0f}%')
    for key in ('atc', 'moa', 'va'):
        n = sum(1 for r in results if r[key])
        print(f'  has {key.upper():<9}{n:>3}  {100 * n / len(results):.0f}%')


if __name__ == '__main__':
    main()
