"""Extract the class Top Drugs PDF into data/top-drugs-<year>.json.

The source PDF is revised roughly annually ("Revision 4/28/2026"), so this is a
one-shot tool re-run per edition rather than part of the app runtime. Output is
the canonical seed consumed by scripts/sync-content.ts.

Usage:  pip install pdfplumber
        python scripts/extract-top-drugs.py "<source>.pdf" data/top-drugs-2026.json
"""
import json, re, sys
import pdfplumber

# The table grid is identical on every page. Some pages sub-split the Generic
# column (route variants) or the Black Box column (floating text boxes), so we
# force this canonical grid instead of trusting per-page column detection.
CANON = [36, 153, 230, 302, 408, 455, 604, 758]
KEYS  = ['generic', 'brand', 'indication', 'dosing', 'controlled', 'moa', 'bbw']

# Which program years are responsible for each column, per the PDF header.
YEAR_LEVELS = {
    'generic': ['P1', 'P2', 'P3'], 'brand': ['P1', 'P2', 'P3'],
    'indication': ['P1', 'P2', 'P3'], 'dosing': ['P2', 'P3'],
    'controlled': ['P2', 'P3'], 'moa': ['P3'], 'bbw': ['P3'],
}

YEARS = re.compile(r'^\s*(?:P[123]\s*)+$')
LABEL = re.compile(r'^\s*(Generic|Brand|Indication|Dosing|Controlled|'
                   r'Mechanism of Action|Black Box Warning)\s*(?:P[123]\s*)*$', re.I)
SCHED = re.compile(r'\bC(II|III|IV|V|I)\b')
CONT  = re.compile(r'^(and|or|with|of|\()', re.I)


def fix(s):
    """Repair glyphs the PDF font leaves unmapped, then drop header noise.

    The font has no mapping for U+2019 and U+2013; both arrive as U+FFFD.
    Position disambiguates them: between letters it is an apostrophe
    (Parkinson's), space-padded it is an en dash (Capsule - 50 mg).
    """
    if not s:
        return ''
    s = s.replace('\ufffd', '\x00')
    s = re.sub(r'(?<=[A-Za-z])\x00(?=[A-Za-z])', '\u2019', s)
    s = re.sub(r'\s*\x00\s*', ' \u2013 ', s)
    s = re.sub(r'[ \t]+', ' ', s)
    lines = [ln.strip() for ln in s.split('\n')]
    lines = [ln for ln in lines
             if ln and not YEARS.match(ln) and not LABEL.match(ln)]
    return '\n'.join(lines).strip()


def unwrap(lines):
    """Join word-wrapped continuations while keeping genuine list items apart.

    Cells hold either multiple values (Proventil / Ventolin / Proair) or one
    wrapped value (Acetaminophen / overdose). A line opening lowercase or with
    a joining word continues the previous one.
    """
    out = []
    for ln in lines:
        if out and (ln[:1].islower() or CONT.match(ln)):
            out[-1] += ' ' + ln
        else:
            out.append(ln)
    return out


def flatten(s):
    return re.sub(r'\s*\n\s*', ' ', s).strip()


def extract(src):
    rows = []
    with pdfplumber.open(src) as pdf:
        for pno, page in enumerate(pdf.pages, 1):
            table = page.extract_table({
                'vertical_strategy': 'explicit',
                'explicit_vertical_lines': CANON,
                'horizontal_strategy': 'lines',
            })
            for row in (table or []):
                cells = [fix(c) for c in (list(row) + [''] * 7)[:7]]
                if any(cells):
                    rows.append({'page': pno, **dict(zip(KEYS, cells))})

    # A row without a generic name either continues the previous drug's text
    # across a page break, or is a route/form variant of it.
    merged = []
    for r in rows:
        if r['generic']:
            merged.append({**r, 'variants': []})
        elif merged:
            prev = merged[-1]
            if r['brand'] or r['dosing']:
                prev['variants'].append({k: r[k] for k in KEYS[1:] if r[k]})
            else:
                for k in KEYS[1:]:
                    if r[k]:
                        prev[k] = (prev[k] + '\n' + r[k]).strip()

    drugs = []
    for d in merged:
        ctl = d['controlled']
        m = SCHED.search(ctl)
        schedule = 'C' + m.group(1) if m else ''
        note = re.sub(r'\s+', ' ', SCHED.sub('', ctl)).strip(' .,;') if m else ctl
        # Brands are usually one per line, but some cells comma-separate them
        # on a single line ("Lamictal, Lamictal XR").
        brand_lines = []
        for line in unwrap([b for b in d['brand'].split('\n') if b]):
            brand_lines.extend(p.strip() for p in line.split(',') if p.strip())

        drugs.append({
            'generic':       flatten(d['generic']),
            'brands':        brand_lines,
            'indications':   unwrap([i for i in d['indication'].split('\n') if i]),
            'dosing':        flatten(d['dosing']),
            'schedule':      schedule,
            'schedule_note': note,
            'moa':           flatten(d['moa']),
            'bbw':           flatten(d['bbw']),
            'variants':      d['variants'],
            'source_page':   d['page'],
        })
    return drugs


def main():
    src, dest = sys.argv[1], sys.argv[2]
    drugs = extract(src)
    payload = {
        'source': src,
        'year_levels': YEAR_LEVELS,
        'count': len(drugs),
        'drugs': drugs,
    }
    with open(dest, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=False)
    filled = {k: sum(1 for d in drugs if d[k]) for k in
              ('brands', 'indications', 'dosing', 'schedule', 'moa', 'bbw')}
    print(f'{len(drugs)} drugs -> {dest}')
    for k, n in filled.items():
        print(f'  {k:<12} {n:>3}  {100 * n / len(drugs):>3.0f}%')


if __name__ == '__main__':
    main()
