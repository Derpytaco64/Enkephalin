# `enkephalin.drugs/1` — authoring guide

This is the import format for **drug profiles**: what Enkephalin stores about a drug, and what a
lecture adds to it.

You are probably reading this because somebody handed you this file plus a lecture — notes, a slide
deck, or both — and asked for a drug file. Everything you need is here. Output **one strict JSON
file per lecture**: no comments, no trailing commas, UTF-8.

See `PLAN.md` → *Importing what a lecture says about drugs* for why the format is shaped this way.

---

## The one rule that matters

**This app is about drugs. A lecture is about a disease.**

A melanoma deck has fifty-five slides and maybe eight of them are about a drug. The incidence, the
risk factors, the ABCDE rule, the Breslow thickness table, the staging, the screening advice, the
irAE body maps — all of that is real material and **none of it belongs in this file.** There is
nowhere for it to go: Enkephalin stores drugs, their fields, and the protocols they appear in.
Anything else has to be left out, and leaving it out is correct rather than lossy.

So read the deck twice. The first pass answers *which drugs is this lecture about*. The second pass
answers, for each of them, *what does this deck say about this drug that a drug profile has a place
for*.

Two corollaries, and they are the two mistakes to avoid:

- **Do not file a disease fact under a drug** because the drug was on the same slide. "Stage IV
  melanoma metastasises to brain, lung, liver" is not nivolumab's mechanism, its indication or its
  dosing. Drop it.
- **Do not invent a drug** for a class, a target or a pathway. `BRAF`, `PD-1` and `MAPK` are not
  drugs. Dabrafenib is.

---

## The second rule: absent, blank and none are three different things

| In the file | What it means | What the app does |
|---|---|---|
| the key is **not there** | this deck did not say | keeps whatever it already knows; writes nothing |
| `"fields": { "bbw": null }` | this deck says there is **none** | records *none to record*, which is an answer and is quizzed |
| `"fields": { "bbw": "" }` | — | **refused.** An empty string says nothing; use `null` or omit the key |

A missing mechanism and a drug that *has* no black box warning must never be stored the same way:
one is work to do and the other is a fact to learn. If you are not sure which you have, omit the
key.

---

## Skeleton

Copy this and fill it. Delete the optional keys you do not need.

```json
{
  "format": "enkephalin.drugs/1",

  "scope": { "course": "", "exam": "" },
  "source": { "file": "", "deck": "", "pages": "", "accessed": "" },
  "write": "fill",

  "declare": [
    { "key": "", "label": "", "type": "markdown", "group": "Clinical", "prompt": "" }
  ],

  "drugs": [
    {
      "generic": "",
      "aliases": [],
      "brands": [],
      "indications": [],
      "class": "",
      "schedule": "",
      "fields": {},
      "source": ""
    }
  ],

  "regimens": [
    {
      "name": "",
      "when": "",
      "components": [{ "drug": "", "dose": "", "role": "component" }],
      "flow": "",
      "notes": ""
    }
  ],

  "issues": []
}
```

---

## File level

| Key | Required | What it is |
|---|---|---|
| `format` | **yes** | Always the literal `"enkephalin.drugs/1"` |
| `scope` | **yes** | Where this lecture sits: `course` and/or `exam`. At least one |
| `source` | **yes** | Where the facts came from. `file` is the one you read; `deck` the original slides |
| `write` | no | `fill` (default), `variant`, or `base`. See below — **the person importing can change it**, so this is a suggestion rather than an instruction |
| `declare` | no | Fields this lecture needs that the app does not have yet |
| `drugs` | **yes** | The drugs, one entry each |
| `regimens` | no | Named multi-drug protocols |
| `issues` | no | Anything you could not resolve. Shown to the person importing, stored nowhere |

### `scope` — the class, and the exam within it

Each becomes a **tag**, created if it does not exist, of kind `course` or `exam`. Every drug in the
file is tagged with all of them, which buys three things at once:

- the browse list filters by them,
- Flashcards and Quiz offer them in the **Drug list** dropdown, exactly like *Top Drugs 2026*,
- each one can carry its **own version** of a drug profile — see `write` below.

**There is no `topic` scope, and a file that uses one is refused.** What a lecture is *about* —
melanoma, heart failure, migraine — is an **indication**, and indications are already a field on
every drug, already searchable, already their own axis in the study scope. Recording it a second
time as a tag means two places that can disagree about the same drug with neither being wrong. So
put it in each drug's `indications`, where it belongs:

```json
{ "generic": "nivolumab", "indications": ["Unresectable or metastatic melanoma"] }
```

Write them the way the course writes them. The slug is derived, and **same words, same digits, same
tag**:

| Written | Slug |
|---|---|
| `"Exam 3"` | `exam-3` |
| `"exam 3"` | `exam-3` |
| `"Exam #3"` | `exam-3` |
| `"Heme/Onc Exam 3"` | `heme-onc-exam-3` |

And these are **different** tags, so pick one spelling and keep it across every file for the same
course:

| Written | Slug | Why it splits |
|---|---|---|
| `"Exam III"` | `exam-iii` | Roman numerals are different words |
| `"Exam 03"` | `exam-03` | `03` and `3` are different digits |
| `"PHRM535"` | `phrm535` | No separator, so no `-` |

### `source`

```json
"source": {
  "file": "16.Melanoma.pdf",
  "deck": "PHRM 535 - Melanoma - Student.pdf",
  "pages": "12-24",
  "accessed": "2026-11-09"
}
```

Every value you write carries a provenance string, and it is the **class name only** — shown on
the profile as *from PHRM 535 content*. The same line appears beside every value from the file, so
it says whose words these are and nothing else; a file name repeated under fourteen fields is noise
shaped like information.

The file name is not lost. The whole of `source` is recorded **once**, as the note on the class's
version of each drug, which is where somebody checking a value goes next. So fill it in properly —
`file` is the one you actually read, `deck` the original slides it came from.

A drug entry may override the provenance with its own `source` string, which is worth doing for a
value that came from somewhere else entirely (a package insert you checked, say).

### `write` — what happens when the app already knows something

| `write` | A field the drug has **no** value for | A field whose value **differs** |
|---|---|---|
| `fill` *(default)* | written to the drug's own profile | written to the **variant layer** for the narrowest scope |
| `variant` | written to the variant layer | written to the variant layer |
| `base` | written to the drug's own profile | **overwrites** the drug's own profile |

`fill` is the honest default: a lecture should be able to fill in what nobody has recorded yet
without ever silently overwriting what somebody else did. Where it disagrees, the disagreement is
recorded as *what this class says*, which is what a variant is for — see `PLAN.md` → *A course says
it differently*.

Use `variant` when the lecture is deliberately a second reading of drugs the app already knows well
(an endocrine course's own wording for levothyroxine). Use `base` only to correct the app, and only
when you know the existing value is wrong.

**The import screen shows these three as a choice and the person importing picks one**, starting on
whichever your file names. You are telling them what you think the file is for; they are the one who
knows what state their database is in. So set it to what the lecture actually is, and do not work
around it — there is no need to split a deck into two files to get two behaviours.

**A drug the app has never held takes everything as its own**, whatever `write` says. There is
nothing to differ from, and a brand-new drug whose mechanism lived only in a class layer would read
as an empty profile — which looks broken rather than sourced. This is the normal case for an
oncology lecture, where most of the drugs are not on any top-200 list.

**Core fields are always the drug's own**, whatever `write` says: the generic name, the brands, the
indications, the class and the controlled schedule. A class cannot differ about what a drug *is* —
a different generic name is a different drug — so those five are written to the drug, or not at all.
The class and the schedule are *filled* and never corrected, except in `base` mode.

---

## `drugs` — one entry per drug

| Key | Required | What it is |
|---|---|---|
| `generic` | **yes** | The generic name, as the deck writes it: `"nivolumab"` |
| `aliases` | no | Other names the deck uses: `["T-VEC", "talimogene"]`. Used for matching only |
| `brands` | no | Trade names: `["Opdivo"]`. Only ones the deck names |
| `indications` | no | What it is used for, **as specifically as the deck says it** |
| `class` | no | The pharmacologic class, if the deck gives one |
| `schedule` | no | `CI`–`CV`, and only for a controlled substance |
| `fields` | no | Everything else. See the field set below |
| `source` | no | Overrides the file's `source` for this drug |
| `note` | no | One line for the importer's eyes. Stored nowhere |

**Matching.** A drug is matched by `generic`, then by `aliases`, case-insensitively. No match means
a new drug is created — which is normal for an oncology lecture, where most of the drugs are not on
a top-200 list. A near-match is **not** guessed at: if the deck says "ipilimumab" and the app holds
"Ipilimumab", that is the same drug; if it says "nivolumab-relatlimab", that is a new one.

**Indications are where oncology earns its specificity.** `"melanoma"` is almost useless as an
indication — a dozen drugs would share it and a quiz built from it asks nothing. Write what the
deck actually scopes the drug to:

```json
"indications": [
  "Unresectable or metastatic melanoma",
  "Adjuvant treatment of resected stage IIB-IV melanoma"
]
```

```json
"indications": [
  "Unresectable or metastatic melanoma, BRAF V600E or V600K positive"
]
```

The biomarker belongs in the indication when it is what *selects* the drug. That is the same fact
the dosing flow turns on, and saying it twice in two places is correct: one is what the drug is
for, the other is how you choose it.

### `fields` — the field set

Keys the app ships with. Use these before declaring anything new.

| Key | Type | What goes in it | Blank means |
|---|---|---|---|
| `dosing` | markdown | How **this drug** is dosed, with route and frequency | nothing recorded |
| `moa` | markdown | How it works | nothing recorded |
| `bbw` | markdown | Black box warning | **none** — `null` is a real answer here |
| `regimen` | markdown | Named protocols it belongs to, and how the choice is made | **none** |
| `route` | list | How it is given. One route as `"IV"`, several as `["IV", "PO"]` | nothing recorded |
| `controlled` | enum | Use the drug-level `schedule` instead | not controlled |

Four ways to write a value:

```json
"fields": {
  "moa": "PD-1 inhibitor. Blocks PD-1 on T cells from binding PD-L1 on the tumour, restoring T cell recognition and attack.",
  "route": ["IV", "PO"],
  "bbw": null,
  "dosing": { "value": "240 mg IV every 2 weeks or 480 mg IV every 4 weeks", "status": "flagged" }
}
```

- a **string** is the value,
- a **list of strings** is a value with several items, for a `list` field like `route`,
- `null` says this drug has **none** of that thing,
- an **object** carries `value`, and optionally `status` and `source`. Its `value` may itself be a
  string or a list — `{ "value": ["IV", "PO"], "status": "flagged" }` is a flagged pair of routes.

**A drug given more than one way:** write the routes as a list — `"route": ["PO", "IV"]` for
dexamethasone, `["IV", "PO", "SL"]` for ondansetron. One route may be written either way:
`"route": "IV"` and `"route": ["IV"]` are the same value, stored identically, so a file may be
rewritten from one spelling to the other without the next import seeing a change.

The list form is the one to reach for, because a single string has to carry its own separator and
only two are read back: one item per line, or items separated by semicolons. `["IV", "PO"]` and
`"IV; PO"` land on the same two items, but the list cannot be got subtly wrong — and a comma does
not separate anything, so `"IV, PO"` is **one** route named "IV, PO".

A type that is neither of these — a number, `true`, an empty list — is **refused**, naming the drug
and the field: `drugs[3] (dabrafenib).fields.route`. Nothing is written until it is fixed, so a
mistyped route can never leave an import that looks clean with the route missing from every drug.

`"status": "flagged"` means *I am not sure of this*. It puts the value in the admin **Flagged**
queue, where a person sees it beside the others and either fixes it or clears the flag. Flagging is
always better than guessing, and better than omitting something the deck clearly said but said
ambiguously.

### Declaring a field

If the lecture needs a field the app has not got — adverse effects, monitoring, interactions — ask
for it:

```json
"declare": [
  { "key": "ae", "label": "Adverse effects", "type": "markdown", "group": "Clinical",
    "prompt": "What are the notable adverse effects of {{generic}}?" }
]
```

| Key | Required | What it is |
|---|---|---|
| `key` | **yes** | `snake_case`, permanent, keys the stored values |
| `label` | **yes** | What a reader sees |
| `type` | **yes** | `text`, `markdown`, `list`, `enum`, `number` or `bool`. A `list` field's values follow the same string-or-list rule as `route` |
| `group` | no | Where it sits on the profile |
| `prompt` | no | The question a flashcard asks. `{{generic}}` is the drug's name |

**Declaring a field is a request, not a decision.** You have read a slide deck; you have no way to
know what this database already calls things. So the import screen shows each field you ask for
beside the existing field set, and the person importing either creates it or **sends your values to
a field that already means that** — your `ae` into their `adverse_effects`, with no new field and no
duplicate. The screen suggests the match where the names look alike, and they confirm it.

That means you do not have to agonise over whether a name is already taken. But it does not let you
off the two things that still matter:

- **Reuse a key you can see in the field table above.** If the lecture's adverse effects belong in a
  field this app already has, use that key and do not declare anything.
- **Ask for one idea once.** Do not declare `ae` *and* `toxicity` for the same kind of fact. Two of
  your fields cannot be sent to one of theirs — one would overwrite the other, so the import refuses
  it rather than losing half your work.

A key that already exists is left exactly as it is: an import never renames a field, never changes
its type, and never revives a deleted one.

## `regimens` — the combinations

Oncology is where a dose stops being a property of one drug. Oxaliplatin is 85 mg/m² *in FOLFOX*;
nivolumab is 1 mg/kg beside ipilimumab and 240 mg alone. So a combination is written once, at file
level, and the app composes it onto the `regimen` field of **every drug in it**.

```json
"regimens": [
  {
    "name": "Ipilimumab + nivolumab",
    "when": "Stage IV initial therapy, NCCN preferred. Any PD-L1 expression, any BRAF status.",
    "components": [
      { "drug": "ipilimumab", "dose": "3 mg/kg IV every 3 weeks x 4 cycles" },
      { "drug": "nivolumab", "dose": "1 mg/kg IV every 3 weeks x 4 cycles, then 240 mg IV every 2 weeks or 480 mg IV every 4 weeks until progression or toxicity" }
    ],
    "flow": "- High-volume symptomatic disease?\n  - Yes -> consider BRAF/MEK first if BRAF V600 positive\n  - No -> combination ICI first\n- Tolerating it?\n  - Grade 3 irAE -> hold, high-dose corticosteroid\n  - Grade 4 irAE -> stop permanently",
    "notes": "72.1 month median OS in CheckMate 067, against 36.9 for nivolumab alone. Highest irAE rate of the ICI options."
  }
]
```

| Key | Required | What it is |
|---|---|---|
| `name` | **yes** | What clinicians call it: `"FOLFOX"`, `"Ipilimumab + nivolumab"`, `"Dabrafenib + trametinib"` |
| `when` | no | What selects it: stage, biomarker, line of therapy, preference |
| `components` | **yes** | The drugs in it, two or more |
| `components[].drug` | **yes** | A `generic` or `alias` from this file, or a drug the app already holds |
| `components[].dose` | no | **This drug's dose in this regimen**, which is the whole reason the entry exists |
| `components[].role` | no | `component` (default), `alternative`, `premedication`, `lymphodepletion`, `supportive`, `rescue` |
| `flow` | no | The decision that chooses or adjusts it. Nested list; see below |
| `notes` | no | Outcomes, trial names, comparative toxicity |
| `source` | no | Overrides the file's `source` |

**A component naming a drug that is neither in this file nor in the database is refused**, not
invented. If the deck's regimen includes a drug it never teaches, add that drug to `drugs` with
just its `generic` — an entry with a name and nothing else is a perfectly good statement that the
drug exists.

**A single-drug "regimen" is refused too.** Monotherapy is the drug's own `dosing` field.

---

## Markdown, and the three things it may contain

Every markdown field — `dosing`, `moa`, `regimen`, `flow`, anything you declare — is rendered by
`lib/fields/prose.ts`, which understands exactly three constructs:

1. **Paragraphs.** Blank line between them.
2. **Nested bullets.** `- ` for each, **two spaces per level**, three levels deep at most.
3. **Numbered steps.** `1. `, `2. ` — for a sequence, like a taper or a cell therapy protocol.
4. **Headings.** `### A heading`, where one field holds two distinct things.

Nothing else. No tables, no bold, no links, no images, and **no mermaid**: a `graph TD` block needs
a renderer this app does not ship, and a nested list *is* the flowchart when the flowchart is six
nodes deep. Anything unsupported is shown as the plain text it is, which is why a table degrades
into an unreadable run of pipes — so turn a table into a list, one bullet per row.

A dosing flow, written the way it renders:

```
- BRAF V600E or V600K mutation?
  - No -> immune checkpoint inhibitor
    - Ipilimumab + nivolumab, or nivolumab + relatlimab
  - Yes -> either, and sequence matters
    - High-volume symptomatic disease -> BRAF/MEK inhibitor first
    - Otherwise -> ICI first, BRAF/MEK on progression
- Renal or hepatic impairment -> no dose adjustment established
```

---

## What gets refused

The importer refuses rather than guesses, and a refusal names the entry. Nothing is written until
every refusal is cleared.

| Refused | Why |
|---|---|
| a `format` other than `enkephalin.drugs/1` | the shape would be guessed at |
| a file with no `scope` | the values would have nowhere to land and nothing to be filtered by |
| a `topic` in `scope` | what a lecture is about is an indication, and that is a field |
| a drug with no `generic` | there is nothing to match or create |
| two drugs with the same `generic` | one of them would silently win |
| an empty string as a field value | it says neither *none* nor *not said*; use `null` or omit |
| a field key that is neither in the app nor in `declare` | a typo would become a new field |
| two declared fields sent to one existing field | one would overwrite the other |
| a core field inside `fields` (`generic`, `brand`, `indication`, `drug_class`) | they have their own keys on the drug entry |
| a regimen with fewer than two components | monotherapy is the drug's `dosing` |
| a regimen component naming an unknown drug | a drug would be invented from a dose line |
| a declared `key` that is not `snake_case` | keys are permanent and key the stored values |

---

## Before you hand it over

- [ ] Every drug in the file is a **drug**, not a class, a target or a pathway.
- [ ] Nothing in the file is a disease fact that happened to share a slide with a drug.
- [ ] Each fact is in the field that is *about* that kind of fact — toxicity is not mechanism.
- [ ] Indications say what the deck scopes the drug to, biomarker included where it selects it.
- [ ] `null` only where the deck says there is none. Nothing you merely did not find.
- [ ] Anything ambiguous is `"status": "flagged"` rather than omitted or guessed.
- [ ] Nothing is declared twice for one idea, and nothing is declared that the field table already has.
- [ ] Every markdown value uses only paragraphs, nested bullets, numbered steps and headings.
- [ ] Every regimen component names a drug that is in `drugs` or already in the app.
- [ ] `scope` is spelled the way every other file for this course spells it, and names no `topic`.
- [ ] What the lecture is *about* is in each drug's `indications`, not in the scope.
- [ ] It is valid JSON. No comments, no trailing commas.
- [ ] Anything you could not resolve is in `issues`, in a sentence a person can act on.

---

## Worked example

Trimmed from `16.Melanoma.pdf` — four drugs of the eleven in the deck, two regimens.

```json
{
  "format": "enkephalin.drugs/1",

  "scope": { "course": "PHRM 535", "exam": "Heme/Onc Exam 3" },
  "source": {
    "file": "16.Melanoma.pdf",
    "deck": "PHRM 535 - Melanoma - Student.pdf",
    "accessed": "2026-11-09"
  },
  "write": "fill",

  "declare": [
    { "key": "ae", "label": "Adverse effects", "type": "markdown", "group": "Clinical",
      "prompt": "What are the notable adverse effects of {{generic}}?" },
    { "key": "pearl", "label": "Clinical pearls", "type": "markdown", "group": "Clinical",
      "prompt": "What is worth knowing about using {{generic}} that the other fields do not say?" }
  ],

  "drugs": [
    {
      "generic": "nivolumab",
      "brands": ["Opdivo"],
      "indications": [
        "Unresectable or metastatic melanoma",
        "Adjuvant treatment of resected stage IIB-IV melanoma"
      ],
      "class": "PD-1 blocking antibody",
      "fields": {
        "moa": "PD-1 inhibitor. PD-1 on T cells binds PD-L1 on the tumour and switches the T cell off late in the immune response; blocking it restores T cell activation, recognition and attack.",
        "dosing": "240 mg IV every 2 weeks, or 480 mg IV every 4 weeks, until progression or toxicity.\n\nIn combination with ipilimumab the dose is lower — see Regimens.",
        "route": "IV",
        "ae": "- Diarrhoea 19%, grade 3-4 2%\n- Rash 26%\n- Hypothyroidism 9%\n- Raised ALT/AST 4%\n- Colitis 1%\n\nirAEs are fewer and milder than on the ipilimumab combination.",
        "bbw": null
      }
    },
    {
      "generic": "ipilimumab",
      "brands": ["Yervoy"],
      "indications": ["Unresectable or metastatic melanoma"],
      "class": "CTLA-4 blocking antibody",
      "fields": {
        "moa": "CTLA-4 inhibitor. CTLA-4 on regulatory T cells limits T cell activity early in the immune response; blocking it lets the response get started.",
        "route": "IV",
        "ae": "- Diarrhoea 33%, grade 3-4 6%\n- Colitis 12%, grade 3-4 9%\n- Rash 33%\n\nColitis is the characteristic one, and the largest on the CTLA-4 body map."
      }
    },
    {
      "generic": "dabrafenib",
      "brands": ["Tafinlar"],
      "indications": ["Unresectable or metastatic melanoma, BRAF V600E positive"],
      "class": "BRAF kinase inhibitor",
      "fields": {
        "moa": "BRAF inhibitor. BRAF V600E holds the MAPK pathway (RAS-BRAF-MEK-ERK) always on; inhibiting it stops the signal. Resistance develops through MEK, which is why it is given with a MEK inhibitor.",
        "dosing": "150 mg PO twice daily. Take with meals.",
        "route": "PO",
        "ae": "- Pyrexia — the greatest risk of the three BRAF/MEK pairs. Onset 2-4 weeks, median 9 days; hold until it resolves then restart at full dose, and add prednisone 10 mg PO daily if it does not settle\n- Cutaneous squamous cell carcinoma, 12%\n- Rash, photosensitivity, arthralgia, fatigue\n- Reduced ejection fraction, ocular toxicity",
        "pearl": "Crosses the blood-brain barrier, so it is the pair to reach for with CNS metastases. Metabolised by CYP2C8 and CYP3A4."
      }
    },
    {
      "generic": "trametinib",
      "brands": ["Mekinist"],
      "indications": ["Unresectable or metastatic melanoma, BRAF V600E positive"],
      "class": "MEK inhibitor",
      "fields": {
        "moa": "MEK inhibitor. Given with a BRAF inhibitor to delay the MEK-mediated resistance that BRAF inhibition alone runs into, which also increases efficacy.",
        "dosing": "2 mg PO once daily.",
        "route": "PO"
      }
    }
  ],

  "regimens": [
    {
      "name": "Ipilimumab + nivolumab",
      "when": "Stage IV initial therapy, NCCN preferred. Used regardless of PD-L1 expression and regardless of BRAF status.",
      "components": [
        { "drug": "ipilimumab", "dose": "3 mg/kg IV every 3 weeks x 4 cycles" },
        { "drug": "nivolumab", "dose": "1 mg/kg IV every 3 weeks x 4 cycles, then 240 mg IV every 2 weeks or 480 mg IV every 4 weeks until progression or toxicity" }
      ],
      "notes": "Median OS 72.1 months in CheckMate 067, against 36.9 for nivolumab alone and 19.9 for ipilimumab alone. The highest irAE burden of the first-line options."
    },
    {
      "name": "Dabrafenib + trametinib",
      "when": "BRAF V600E positive stage III adjuvant or stage IV disease. Consider first when disease is high-volume and symptomatic; otherwise ICI first, since the ICI-then-BRAF/MEK sequence gives longer response and overall survival.",
      "components": [
        { "drug": "dabrafenib", "dose": "150 mg PO twice daily, with meals" },
        { "drug": "trametinib", "dose": "2 mg PO once daily" }
      ],
      "flow": "- BRAF V600E or V600K mutation?\n  - No -> immune checkpoint inhibitor, not this\n  - Yes -> either, and the sequence matters\n    - High-volume symptomatic disease -> BRAF/MEK first\n    - Otherwise -> ICI first, BRAF/MEK on progression\n- Pyrexia during treatment?\n  - Hold until it resolves, then restart at full dose\n  - Not resolving -> prednisone 10 mg PO daily, antipyretics, fluids",
      "notes": "Of the three BRAF/MEK pairs: this one crosses the blood-brain barrier and carries the greatest pyrexia risk; vemurafenib + cobimetinib has the highest overall AE rate; encorafenib + binimetinib has the least pyrexia. All three prolong QTc except dabrafenib + trametinib."
    }
  ],

  "issues": [
    "The ABCDE slide writes E as 'Enlargement' in the table and 'evolving' in the sentence under it. Recorded as neither — it is not a drug fact.",
    "Nivolumab + relatlimab is one formulation (Opdualag) dosed as nivolumab 480 mg / relatlimab 160 mg IV every 4 weeks. Relatlimab is not separately available, so it is entered as a drug but has no monotherapy dosing."
  ]
}
```
