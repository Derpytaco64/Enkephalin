# `enkephalin.drugs/1` — authoring guide

This is the import format for **drug profiles**: what Enkephalin stores about a drug, and what a
lecture adds to it.

You are probably reading this because somebody handed you this file plus a lecture — notes, a slide
deck, or both — and asked for a drug file. Everything you need is here. Output **one strict JSON
file per lecture**: no comments, no trailing commas, UTF-8. Handed several lectures that sit on the
same exam, output **one file for all of them** — see *Several lectures, one exam* below, because that
is the one case where two files fight over the same place.

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

## The third rule: a picture is part of the deck

**A slide's figures are the deck talking.** Read them the way you read its sentences.

This matters more here than it would in most imports, because a pharmacy lecture puts the facts
this app most wants into pictures rather than prose. The sentences carry the disease; the dose
lives in a drawn grid. What you are looking for inside a figure:

- **A dose or dose-adjustment table** — the renal rows, the weight bands, the hepatic reduction.
- **A taper or a cycle**, drawn as a calendar or a schedule.
- **A treatment algorithm** — first line, then what you do when it fails. This is what a regimen's
  `flow` is for.
- **A management grid** — the irAE table that pairs a grade with hold, steroid, discontinue.
- **A table of agents**, where the drug's class, route or place in therapy is in a column heading
  and nowhere in the body text.

Read the figure, then write what it says in the three constructs the prose renderer understands: a
table becomes **one bullet per row**, an algorithm becomes **nested bullets**, a schedule becomes
**numbered steps**. See *Markdown, and the four things it may contain* — the rule against tables
there is a rule about the **output**, not permission to skip the input. Do not transcribe a grid as
pipes and do not try to reproduce its shape; carry the facts across and let the list be the shape.

And the converse, which is the one rule again: **a picture that is not a drug fact stays out**, even
when it is beautiful and clearly the point of the slide. A structural formula, a receptor cartoon, a
signalling pathway, a body map, a Kaplan-Meier curve, a histology photo, the ABCDE panel — there is
nowhere in a drug profile for any of them. A pathway diagram is not a mechanism you may narrate into
`moa` beyond what the deck's own words say about *this drug*.

### When you cannot see them

Sometimes you are working from extracted text and the figures did not come with it — a slide arrives
as an empty frame, a caption with nothing under it, or a run of orphaned numbers.

**That is not a deck that says there is none.** Per the second rule, a `null` asserts that the
lecture addressed this and the answer is nothing; a figure you could not read asserts nothing at
all. So:

- **Omit the key.** The app keeps what it already knows, which is the right outcome.
- Or, if you can tell what the figure was about but not what it said, `"status": "flagged"` with
  your best reading, so it lands in the admin **Flagged** list for a human with the slide open.
- Say so in `notes` at the end of the file — *slide 23's renal dosing table did not extract* — the
  same way you would record any judgement call.

Never fill a gap a picture left with a dose from memory or from a package insert. The file is what
**this lecture** says.

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
| `scope` | **yes** | Where this lecture sits: `course` and/or `exam`. At least one. An exam carries its year |
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
{ "generic": "Nivolumab", "indications": ["Unresectable or metastatic melanoma"] }
```

Write them the way the course writes them. The slug is derived, and **same words, same digits, same
tag**:

| Written | Slug |
|---|---|
| `"Exam 3"` | `exam-3` |
| `"exam 3"` | `exam-3` |
| `"Exam #3"` | `exam-3` |
| `"Heme/Onc Exam 3"` | `heme-onc-exam-3` |
| `"Heme/Onc Exam 3 2026"` | `heme-onc-exam-3-2026` |

**An exam ends with its year**, the way *Top Drugs 2026* does: `"Infectious Disease Exam 3 2026"`.
Exam 3 comes round again next year with different slides, and a tag is what a version of a profile
is named after — so a tag called *Infectious Disease Exam 3* would end up holding two years of
wording with no way to tell them apart, and the version switcher would show the same name twice.
The year in the label is also the year in the slug, which is what keeps them separate tags. A
course is numbered rather than dated, so `"PHRM 532"` stays as it is.

And these are **different** tags, so pick one spelling and keep it across every file for the same
course:

| Written | Slug | Why it splits |
|---|---|---|
| `"Exam III"` | `exam-iii` | Roman numerals are different words |
| `"Exam 03"` | `exam-03` | `03` and `3` are different digits |
| `"PHRM535"` | `phrm535` | No separator, so no `-` |

### Several lectures, one exam — one file

**One file per lecture, unless the lectures share an exam. Then one file for all of them.**

An exam's drugs often arrive as several decks: pneumonia split into community-acquired and
hospital-acquired, skin infections split across two lecturers. Every one of those files names the
same `exam`, and that tag holds **one version** of each drug — so the same drug in three files means
three files writing to one place.

The app no longer lets the third one overwrite the second: a value the version already holds, put
there by another lecture, is **left out and reported** rather than replaced. That is the safe
outcome, not the right one. The right one is a file where each drug appears **once**, holding what
every deck said about it:

```json
{ "generic": "Vancomycin",
  "indications": ["Community-acquired pneumonia, MRSA risk", "Hospital-acquired pneumonia",
                  "Purulent skin and soft tissue infection"],
  "fields": {
    "dosing": "- Community-acquired pneumonia with methicillin-resistant S. aureus (MRSA) risk: 15 mg/kg every 12 hours, added to the standard regimen\n- Hospital-acquired or ventilator-associated pneumonia: 15 mg/kg IV q8-12h\n  - Consider a 25-30 mg/kg x1 loading dose in severe illness\n- Purulent infection: 5 days outpatient, 5-7 days inpatient" } }
```

Three decks, one entry, one bullet per indication — and each deck's qualifier nested under the dose
it qualifies rather than standing beside it. The rules for doing this by hand:

- **One bullet per indication**, named the way its deck named the infection. A dose and a *duration*
  are not rivals: one deck giving `15 mg/kg q8-12h` and another giving `5 days` are answering
  different questions about different infections, and both belong.
- **Where every line is `Indication: dose` with nothing nested under it, leave the bullets off.**
  Plain lines in that form are read into one dosing row *per indication*, which is what makes a
  drug with four indications four rows rather than one block of text. A `- ` in front stops that
  reading. Keep the bullets only where something has to nest.
- **Union the lists.** `indications`, `brands` and `route` are sets: `PO` from one deck and
  `Topical` from another means the drug has both.
- **Say each fact once.** Two decks often repeat a sentence word for word; the merged value says it
  once.
- **A combination keeps both readings where they differ.** Two decks describing *vancomycin +
  piperacillin/tazobactam* with different `when` text are two readings of one protocol, and a
  regimen's `name` is what the drug's own regimen text is keyed on — so give them distinct names
  rather than silently dropping one.

If the files are already written, `npx tsx scripts/merge-drug-imports.ts out.json a.json b.json …`
does all of the above and prints every value it joined for review. It refuses files that do not name
the same scope, because merging across scopes would put one class's wording into another's.

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

**Nor does any of the three write over another lecture's wording.** A version holds one value per
field, and an exam's drugs often arrive as several files. Where the version already says something
else about a field — because an earlier file in the same scope said it — this file's value is **left
out and reported**, naming the lecture that got there first. `fill` and `variant` both behave that
way; the way through is `base` aimed at that version, which is the mode that exists to say *this
wording is wrong*. The real answer is usually *Several lectures, one exam* above: one entry per drug
holding what every deck said.

None of the three ever clears a field the file does not mention: a value is overwritten by a value,
and a lecture silent about a field says nothing about it. To undo an import outright — the drugs it
created, or a version's wording it wrote over drugs that were fine — use **Admin → Remove drugs**,
which lists every drug and every version with a tick box each.

**`base` can be aimed at a version instead of the drug.** A drug with versions has more than one
thing that can be wrong, and *Correct the drug itself* used to assume it was the drug: it wrote over
the drug's own profile while a class's own wording went on outranking the correction wherever it had
any, so the profile looked fixed and studying that class still taught the old value. The import
screen now asks **what to correct** — the drug's own profile, or what one of this file's scopes says.
Aimed at a version, that version's layer is overwritten and the drug is left alone; the drug's class
and schedule are never corrected that way, because a class cannot differ about what a drug *is*. The
target has to be one of the file's own scopes, since a layer for a class these drugs are not tagged
with is a layer no reader would apply.

**And it is not defaulted.** Where `base` would overwrite drugs the app already has, *Import it*
stays off until what to correct has been picked: the mode that destroys somebody's wording is the
one mode where a guess is expensive, so it asks rather than assuming. Checking the file still works
and still shows the preview — that is where the versions in play are listed, so it is how the
choice gets made. Nothing to replace means nothing to ask: a file whose drugs are all new takes
everything as its own whatever is picked, and imports without the question.

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
| `generic` | **yes** | The generic name, **capitalised**: `"Nivolumab"`, `"Iron sucrose"` |
| `aliases` | no | Other names the deck uses: `["T-VEC", "Talimogene"]`. Matching only, so case changes nothing — capitalise them the same way regardless |
| `brands` | no | Trade names: `["Opdivo"]`. Only ones the deck names |
| `indications` | no | What it is used for, **as specifically as the deck says it** |
| `class` | no | Usually leave it out — a drug created without one gets its FDA class looked up. Write one only to override that, **capitalised**: `"Cephalosporin Antibacterial"` |
| `schedule` | no | `CI`–`CV`, and only for a controlled substance |
| `fields` | no | Everything else. See the field set below |
| `source` | no | Overrides the file's `source` for this drug |
| `note` | no | One line for the importer's eyes. Stored nowhere |

**Capitalise the generic name.** The app stores it and shows it exactly as the file writes it — it
does not tidy the case — and every drug already in the library carries a leading capital, so a
lowercase name sits visibly wrong in the list beside them. Capitalise the first word and leave the
rest as the deck writes it: `"Iron sucrose"`, `"Talimogene laherparepvec"`, `"Interleukin-2"`. Keep
the capitals a name has earned — `"Fentanyl Transdermal Patch"`, a brand like `"Opdivo"`, an alias
like `"T-VEC"` — and do not invent any: `"Mycophenolate mofetil"` has one word capitalised because
only the first is a word that takes one. Matching ignores case, so getting this wrong does not create
a duplicate drug; it only looks careless on the page.

**In a combination product, every component is capitalised.** One rule, applied after each `/`:

```json
"generic": "Amoxicillin/Clavulanate"
"generic": "Piperacillin/Tazobactam"
"generic": "Imipenem/Cilastatin/Relebactam"
```

Short forms the same way, wherever they appear — in `aliases`, and in a regimen component's
`drug`: `"Amox/Clav"`, `"Pip/Tazo"`, `"TMP/SMX"`. **Only the first letter of each part changes** and
the rest stays as the deck writes it, so `"Norethindrone/Ethinyl estradiol"` capitalises *Ethinyl*
and leaves *estradiol* where it is. The rule is about names — a generic, an alias, a component's
drug — and not about prose that happens to contain a slash: a dose written *nivolumab 480 mg /
relatlimab 160 mg* is a sentence, not a name.

Matching ignores case here too, so a file spelling a component in lower case still finds the drug and
still creates no duplicate. And **an import never renames a drug it matched**: the name on the page
stays whatever the app already holds, so a file cannot tidy the library's spelling and does not need
to try. Fixing a stored name is an edit, not an import.

**Capitalise the class the way the library writes it.** `class` holds an FDA Established
Pharmacologic Class name — the one class vocabulary this project trusts — and every class the
library came with is RxNorm's own spelling of one: `Xanthine Oxidase Inhibitor`, `Proton Pump
Inhibitor`, `Cephalosporin Antibacterial`. A deck writes the same class as lecture prose, and beside
those a `"second-generation cephalosporin"` reads as a mistake. So **capitalise every word**:

| the deck says | write |
|---|---|
| `second-generation cephalosporin` | `"Second-generation Cephalosporin"` |
| `BRAF kinase inhibitor` | `"BRAF Kinase Inhibitor"` |
| `proton pump inhibitor` | `"Proton Pump Inhibitor"` |

Four details, each of them a value the library already holds:

- **A joining word stays lowercase**: `"Serotonin and Norepinephrine Reuptake Inhibitor"`.
- **After a hyphen, a qualifier stays lowercase** — `"Anti-epileptic Agent"`, `"Non-narcotic
  Antitussive"`, `"Thiazide-like Diuretic"`, `"Potassium-sparing Diuretic"`, and so
  `"Second-generation Cephalosporin"`. Two nouns hyphenated together both take a capital:
  `"Sodium-Glucose Cotransporter 2 Inhibitor"`.
- **A Greek letter or a stereochemical prefix stays lowercase, first word or not**:
  `"beta-Adrenergic Blocker"`, `"alpha-1 Adrenergic Agonist"`, `"5-alpha Reductase Inhibitor"`,
  `"l-Thyroxine"`, `"gamma-Aminobutyric Acid A Receptor Positive Modulator"`.
- **An acronym keeps its own case, and is never spelled out here**: `"GLP-1 Receptor Agonist"`,
  `"PCSK9 Inhibitor"`, `"P2Y12 Platelet Inhibitor"`, `"HMG-CoA Reductase Inhibitor"`. The acronym
  rule further down is about fields that are read as prose; a class is a name, and `"Glucagon-Like
  Peptide-1 (GLP-1) Receptor Agonist"` is not the name of anything.

**It matters more than it looks.** The class is stored as written and compared as a whole string, so
the browse rail's class filter, the colour-by-class axis and the quiz's same-class distractors all
group by the exact value. `Second-generation Cephalosporin` and `second-generation cephalosporin`
would be two classes with one name, each a smaller group than the lecture meant — and the colour
coding would give the same class two colours.

**And the class is filled, never corrected** — see `write` above. Where the app already holds a
class, the file's value is ignored outside `base` mode, so the capitals that stick are the ones a
drug is created with. There is no pass that tidies them later.

**Matching, first by name.** A drug is matched by `generic`, then by each of its `aliases`, against
the generic names **and the brand names** of every drug the app holds. The comparison is the whole
string, trimmed and lower-cased: `"ipilimumab"` finds `Ipilimumab`, and `"Opdivo"` finds nivolumab.
A near-match is **not** guessed at — if the deck says "nivolumab-relatlimab", that is a new drug.

**Then by address.** Where no name in the entry matches one the app holds, each is reduced to a slug
and compared again: lower-cased, with every run of anything that is not a letter or a digit turned
into a single `-`, and any leading or trailing dash dropped. Capitals disappear, and `/`, `+`,
spaces and existing dashes all become the same single dash. So these four spellings are four
different names and one address, and all four find the drug that lives at it:

| written as | compared as | address |
|---|---|---|
| `"Amoxicillin/Clavulanate"` | `amoxicillin/clavulanate` | `amoxicillin-clavulanate` |
| `"Amoxicillin-Clavulanate"` | `amoxicillin-clavulanate` | `amoxicillin-clavulanate` |
| `"Amoxicillin + Clavulanate"` | `amoxicillin + clavulanate` | `amoxicillin-clavulanate` |
| `"Amoxicillin/ Clavulanate"` | `amoxicillin/ clavulanate` | `amoxicillin-clavulanate` |

This is what a combination product needs, because the library is not consistent about the
separator: it holds `Piperacillin/Tazobactam` with no space and `Amoxicillin/ Clavulanate` and
`Ampicillin/ Sulbactam` with one, so there is no style a file could follow. It is safe to match on
because the app cannot hold two drugs at one address, so a name whose address is taken is a name for
the drug that holds it. **Punctuation is forgiven; a different name is not** — `"Amox/Clav"` reduces
to `amox-clav` and matches nothing, so a short form the deck uses belongs in `aliases`, where the
brand name (`"Augmentin"`) works too.

A name the app holds **exactly** always wins over one that merely reduces to the same address: every
name in the entry gets its exact try before any of them falls back. An entry whose `generic` reduces
onto one drug while an alias names another outright means the one it names.

**No match either way means a new drug is created**, at the address its `generic` reduces to — which
is normal for an oncology lecture, where most of the drugs are not on a top-200 list.

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

### The class is looked up, so you can leave it out

**Leave `class` out unless the deck's own name is the one you want kept.** A drug created without one
gets its class looked up — RxNav's **Established Pharmacologic Class**, the FDA's own, which is the
vocabulary every class the library came with is spelled in. It is the same source
`scripts/fetch-drug-classes.py` classed the first 236 from, ported into the app so a drug added by a
lecture is classed the same way as a drug that came off the sheet. The RxCUI it resolves is stored
too, and a drug the FDA gives no EPC stays **Uncategorized**, which is a real answer and not a gap.

So a lecture that says *a BRAF inhibitor* in passing is better served by saying nothing: write
`class` only where you mean *this name, not whatever the lookup finds* — and then the capitalisation
rule above is yours to follow, because **what you write wins**. The class is filled and never
corrected, so a value in the file is the one that sticks.

The rest of this section is what the lookup does, which is worth knowing because it is what your
drug's class will be. To see it for one drug before you hand the file over:

```bash
curl -s "https://rxnav.nlm.nih.gov/REST/rxclass/class/byDrugName.json?drugName=dabrafenib&relaSource=FDASPL"
```

In the response, take the entry whose `classType` is `EPC` (equivalently, `rela` is `has_epc`) and
copy its `className` **verbatim**:

```json
{
  "minConcept": { "rxcui": "1424911", "name": "dabrafenib", "tty": "IN" },
  "rxclassMinConceptItem": { "className": "Kinase Inhibitor", "classType": "EPC" },
  "rela": "has_epc",
  "relaSource": "FDASPL"
}
```

So dabrafenib becomes `Kinase Inhibitor`, not *BRAF Inhibitor*, and ipilimumab
`CTLA-4-directed Blocking Antibody`, not *CTLA-4 Inhibitor*. Those names arrive already spelled the
way the rule above asks for — the lowercase *directed* after the hyphen is the FDA's own — which is
the other reason to let the lookup write it: a name nobody retyped cannot be miscapitalised.

Without `curl`, two browser routes give the same answer: **RxClass**
(<https://mor.nlm.nih.gov/RxClass/>, search the drug and read the *EPC* rows) and the drug's
**DailyMed** label, which prints its established pharmacologic class.

Four things the lookup already handles, and that you would have to handle by hand:

- **`MOA` and `VA` rows are not classes.** The same response offers dabrafenib `Protein Kinase
  Inhibitors` (MOA) and `ANTINEOPLASTIC,OTHER` (VA), and `BRAF Serine/Threonine Kinase Inhibitors`
  from MEDRT — which is the slide's own wording and the tempting one to take. **EPC only, from
  `FDASPL` or `DAILYMED`.** Mixing vocabularies on this axis puts two spellings of one idea in the
  filter, colours them differently, and makes same-class distractors compare across systems.
- **A combination has to be asked ingredient by ingredient.** The product name usually returns
  nothing at all — `piperacillin and tazobactam` gives `{}` — while `piperacillin` gives
  `Penicillin-class Antibacterial` and `tazobactam` gives `beta Lactamase Inhibitor`.
- **An adjuvant must not lead.** Of those two, the one to write is the penicillin: the beta
  lactamase inhibitor protects it and is not what the drug is for. Same for carbidopa beside
  levodopa. Where a product's ingredients have different classes, the one the product is **named
  for first** is the class.
- **Strip the salt and the release qualifier first.** The EPC belongs to the active moiety, so
  *Metoprolol Succinate ER* is looked up as `metoprolol`. A salt is a different RxCUI and often
  carries no EPC of its own.

**Where there is no EPC, the drug stays uncategorized** — and that is the answer, not a gap to fill
from somewhere else. 20 drugs in the library have none; buspirone offers only a MEDRT mechanism and a
VA category, and both are recorded as candidates against the drug for whoever wants to decide later.
The profile says *class needs review*, the browse rail groups them under one heading, and nothing
guesses. An invented class is worse than no class, because the colour coding, the browse filter and
the quiz's distractor sampling all treat it as a real group. See `lib/drugs/class-lookup.ts` and
`lib/drugs/drug-class.ts`.

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
  { "key": "ae", "label": "Adverse Effects", "type": "markdown", "group": "Clinical",
    "prompt": "What are the notable adverse effects of {{generic}}?" }
]
```

| Key | Required | What it is |
|---|---|---|
| `key` | **yes** | `snake_case`, permanent, keys the stored values |
| `label` | **yes** | What a reader sees, **in Title Case**: `"Adverse Effects"`, `"Additional Notes"` |
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

**Capitalise the label, every word of it.** `Adverse Effects`, `Additional Notes`, `Clinical
Pearls`, `Pharmacokinetics` — not *Adverse effects*. A label is the name of a section on a profile
and the heading on a flashcard, and it is read next to the labels of every other field, so a
sentence-cased one is the odd one out in a list. The exceptions are the class rule's: a joining word
stays lowercase (`Dosing in Renal Impairment`), an acronym keeps its own case (`CYP Interactions`),
and anything after a hyphen follows the hyphen rule (`Non-renal Clearance`).

The `key` is unaffected and stays `snake_case`: it is the address, never shown, and the two have
different jobs — `adverse_effects` keys the values, *Adverse Effects* is what a reader sees.

A key that already exists is left exactly as it is: an import never renames a field, never changes
its type, and never revives a deleted one — so a field the app already holds keeps whatever label it
was created with, and this rule is about the ones your file creates.

### `pearl` — and what is not one

Declared rather than shipped: this app has a *Clinical Pearls* field because a lecture asked for one.
It is the field most often filled with something that belongs elsewhere, so it has a test of its own.

**A value is a pearl only if one of these is true:**

1. **The slide labels it one** — *Pearls*, *Clinical pearls*, *Practice pearls*.
2. **It is unique and important for that drug**, and no other field is about that kind of fact.

**A slide labelled "pearls" is still sorted by what it says.** The label tells you the lecturer
thought it was worth knowing. It does not tell you which field it belongs in — and where the pearl
is really an interaction, a monitoring step or a dose, it goes in that field and **not in `pearl` as
well**:

| the slide | the field |
|---|---|
| *Macrolides Drug Interaction/Pearls*, listing CYP3A4 interactions | `interactions` |
| vancomycin *General practice pearls*, on when to draw a trough | `monitoring` |

Neither of those ships with the app, so a file that needs one declares it, exactly as above.

**Not a pearl:**

- **A class fact repeated on every drug in the class.** Allergy cross-reactivity across the
  cephalosporins is a fact about the class; copying it onto each of them teaches it once and pads
  the rest. Where it is worth saying per drug, `notes` is the field — below.
- **Anything another field already says** — the indication, the class, the route, the spectrum. A
  pearl that repeats another field is one more place for the two of them to disagree later.
- **Trivia that goes stale.** An approval year, *approval being sought*, *new for 2026*. A file is
  read for years and nobody comes back to date-check a pearl.

**Good pearls**, for calibration:

- *Inactivated by lung surfactant, so not for pneumonia* — daptomycin
- *Not for neonates* — ceftriaxone
- *Reserved for gentamicin- or tobramycin-resistant bugs* — amikacin

Each one would change what you do, is true of that drug rather than its class, and is in no other
field. The worked example at the end of this guide shows the trim: dabrafenib's pearl is *crosses
the blood-brain barrier, so it is the pair to reach for with CNS metastases*, and the *metabolised by
CYP2C8 and CYP3A4* it used to carry alongside has moved to a declared `pk` field, where it is one
fact rather than half of two. Where the drug goes is a pearl; what the liver does to it is
pharmacokinetics.

**Leave `pearl` out when nothing qualifies**, which is most drugs in most lectures. No `pearl` key
says nothing about the drug, and saying nothing is correct — see *absent, blank and none* at the top.

### `notes` — Additional Notes

Declared rather than shipped, like `pearl`:

```json
{ "key": "notes", "label": "Additional Notes", "type": "markdown", "group": "Clinical",
  "prompt": "What else is worth knowing about {{generic}}?" }
```

The field for a useful fact that **fits no other field and is not a pearl**. Three things that
belong in it:

- **Cross-reactivity**, as a plain statement with no percentages: `Cross-reactivity with
  penicillins`, `Cross-reactivity with ceftazidime only`. The percentage moves with the study and
  with what counted as a reaction; the statement is the part that gets used.
- **Resistance that changes which drug you pick** — a positive D-zone test means macrolide
  resistance carries over to clindamycin, so clindamycin is out.
- **Which brand is which formulation or route** — `Ceftin is PO, Zinacef is IV`.

That last one is here for a reason worth knowing: a brand row in this app *can* carry a route and a
form, but the import format has no way to set them — `brands` is a list of names — so until it has,
`notes` is where that reads.

## `regimens` — the combinations

Oncology is where a dose stops being a property of one drug. Oxaliplatin is 85 mg/m² *in FOLFOX*;
nivolumab is 1 mg/kg beside ipilimumab and 240 mg alone. So a combination is written once, at file
level, and the app composes it onto the `regimen` field of **every drug in it**.

```json
"regimens": [
  {
    "name": "Ipilimumab + nivolumab",
    "when": "Stage IV initial therapy, National Comprehensive Cancer Network (NCCN) preferred. Any PD-L1 expression, any BRAF status.",
    "components": [
      { "drug": "Ipilimumab", "dose": "3 mg/kg IV every 3 weeks x 4 cycles" },
      { "drug": "Nivolumab", "dose": "1 mg/kg IV every 3 weeks x 4 cycles, then 240 mg IV every 2 weeks or 480 mg IV every 4 weeks until progression or toxicity" }
    ],
    "flow": "- High-volume symptomatic disease?\n  - Yes -> consider BRAF/MEK first if BRAF V600 positive\n  - No -> combination immune checkpoint inhibitor (ICI) first\n- Tolerating it?\n  - Grade 3 immune-related adverse effect (irAE) -> hold, high-dose corticosteroid\n  - Grade 4 irAE -> stop permanently",
    "notes": "72.1 month median overall survival (OS) in CheckMate 067, against 36.9 for nivolumab alone. The highest immune-related adverse effect (irAE) rate of the immune checkpoint inhibitor (ICI) options."
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

**Capitalise a component's name too**, combination products included — `"TMP/SMX"`, not
`"TMP/smx"`. It is matched case-insensitively but **printed verbatim** into the Regimens field of
every drug in the protocol, so a lowercase `"drug": "ipilimumab"` reads as
`- ipilimumab — 3 mg/kg IV…` on four profiles.

**A component naming a drug that is neither in this file nor in the database is refused**, not
invented. If the deck's regimen includes a drug it never teaches, add that drug to `drugs` with
just its `generic` — an entry with a name and nothing else is a perfectly good statement that the
drug exists.

**A single-drug "regimen" is refused too.** Monotherapy is the drug's own `dosing` field.

**The `name` is a flashcard.** Each protocol becomes its own study card -- *FOLFOX: what is it for,
and what is bevacizumab's part in it?* -- rather than one card holding all nineteen of carboplatin's.
Two consequences for whoever writes the file. The name is the question, so it has to be the one a
clinician would recognise and not a description of it. And the name is what the card's schedule is
filed under, so renaming a protocol in a later import starts that card's history over -- reordering
them does not.

---

## Markdown, and the four things it may contain

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

### No semicolons

**A markdown value does not use a semicolon to join two ideas.** Every markdown field — `dosing`,
`moa`, `bbw`, `regimen`, a regimen's `flow`, `when` and `notes`, and every markdown field you
declare — is read by the three constructs above, and a semicolon is none of them. It splits
nothing, so both ideas arrive on one line and the second is the one nobody reads.

**Each idea gets its own line**, as a bullet or as a sub-bullet under the one it qualifies:

```json
"bbw": "- Tendonitis and tendon rupture; risk factors age over 60, steroids"
```

becomes

```json
"bbw": "- Tendonitis and tendon rupture\n  - Risk factors: age over 60, steroids"
```

A sub-bullet is the right shape whenever the second half is *about* the first — a risk factor, a
threshold, what to do about it. Two independent facts are two bullets at the same level. A run of
items is a list and never a sentence:

```json
"ae": "Nausea; vomiting; rash; hepatotoxicity; QTc prolongation; infusion reactions"
```

```json
"ae": "- Nausea\n- Vomiting\n- Rash\n- Hepatotoxicity\n- QTc prolongation\n- Infusion reactions"
```

**The importer warns rather than refuses.** A semicolon in a markdown value is named in the preview
the way a refusal is — `drugs[3] (Ciprofloxacin).fields.bbw` — and the import goes ahead and stores
the value exactly as written. It is a reading problem, not a correctness one, so it is worth saying
and not worth blocking a lecture over. Tidy it in the file and check again.

**A `list` field is the exception, and it is not changed by this.** There a semicolon separates two
items and is read as doing so: `"IV; PO"` is two routes, as documented above. Even so the list form
is the one to reach for — `["IV", "PO", "SL"]`, or one item per line.

A dosing flow, written the way it renders:

```
- BRAF V600E or V600K mutation?
  - No -> immune checkpoint inhibitor (ICI)
    - Ipilimumab + nivolumab, or nivolumab + relatlimab
  - Yes -> either, and sequence matters
    - High-volume symptomatic disease -> BRAF/MEK inhibitor first
    - Otherwise -> ICI first, BRAF/MEK on progression
- Renal or hepatic impairment -> no dose adjustment established
```

---

## Acronyms

**The first time an acronym appears in a field, write the full term with the acronym in brackets.**
Later uses in that field stay short.

```json
"moa": "Binds penicillin-binding proteins (PBPs) and blocks peptidoglycan cross-linking. The PBPs a drug reaches are what set its spectrum."
```

**Every field explains its own acronyms.** A flashcard shows one field at a time — a card asking for
the mechanism prints the mechanism and nothing else — so an acronym spelled out in `pearl` is an
acronym nobody has met in `moa`. Spelling it out once per file is not enough; spell it out once per
field. The same goes for an **indication**, which is read on its own in the drug list, in a filter
and in a quiz stem.

**Capitalise the full term only where it starts a line, a bullet or a heading**, and leave it
lowercase mid-sentence:

| | |
|---|---|
| start of a bullet | `- Methicillin-resistant S. aureus (MRSA)` |
| mid-line | `Staph, methicillin-resistant S. aureus (MRSA)` |

**Brackets never nest.** Where the acronym falls inside round brackets, put it in square ones:

```
(including methicillin-resistant S. aureus [MRSA])
```

**And never two bracket groups back to back.** `(MRSA) (bacteremia)` is two fragments the reader has
to join up themselves. Reword it into the sentence:

```
Preferred for serious MRSA infections: bacteremia, endocarditis
```

### Short forms that stay short

Nobody needs *twice daily (BID)*. These are read as words, and spelling them out makes a field
longer without making it clearer:

| | |
|---|---|
| Routes and frequency | `IV`, `PO`, `IM`, `BID`, `QID`, `q8h` and the like |
| Everyday terms | `GI`, `CNS`, `DNA`, `RNA`, `HIV`, `FDA`, `QT`, `QTc` |
| Body weights | `ABW`, `IBW`, `CBW` |
| Pharmacodynamics | `AUC`, `MIC`, `AUC/MIC`, `AUC:MIC`, `T>MIC` |
| Electrolytes and minerals | `Ca`, `Mg`, `Fe` |
| Enzymes, genes and targets | `CYP3A4` and the other CYPs, `MT-RNR1` — and the same for a target, gene or pathway the deck names as such: `PD-1`, `PD-L1`, `CTLA-4`, `BRAF`, `MEK`, `MAPK` |

A name on that last row is the drug's actual subject, not a shorthand for one: *B-Raf
proto-oncogene serine/threonine kinase* teaches nobody anything the deck meant.

### Short forms that are always written out

No acronym kept, because the short form is an abbreviation of convenience rather than a name:

| written as | write |
|---|---|
| `C. diff` | `C. difficile` |
| `incl.` | `including` |
| `FQ` | `fluoroquinolone` |
| `2x/week` | `2 times/week` |

### Coverage mnemonics

A coverage mnemonic is followed **directly** by its letters in brackets, every time, because the
mnemonic is only an aid to somebody who already has the list:

```
PEK (Proteus, E. coli, Klebsiella)
HNPEK (Haemophilus, Neisseria, Proteus, E. coli, Klebsiella)
HENPECKS (Haemophilus, Enterobacter, Neisseria, Proteus, E. coli, Citrobacter, Klebsiella, Serratia)
APE (Acinetobacter, Pseudomonas, Enterococcus)
```

---

## Keep every fact, and keep it short

**A field value is a bullet fragment, not a sentence.** It is read on a profile beside thirty others
and on a flashcard with nothing around it, and in both places the full stop and the run-up to it are
noise:

| not this | this |
|---|---|
| `"Adjust for renal function."` | `Renally adjust` |
| a paragraph explaining side chains and which cephalosporins share them | `Cross-reactivity with penicillins` |

**Shorter wording, not less content.** Every organism, dose, level, adverse effect and interaction
the slide gives stays in the file — the trimming is of the words around them, never of the facts.
A lecture's numbers are the whole reason it is worth importing.

The rule bites hardest on the fields that are really lists: adverse effects, interactions,
monitoring, cross-reactivity, pearls. A mechanism or a dosing paragraph may stay prose where the
explanation *is* the content — `moa` earns its sentences — but it earns them by explaining
something, not by working up to it.

**And one fact in one field.** Do not repeat a fact across fields on the same drug: pick the field
that is *about* it and leave the others alone. Two copies are not twice as memorable, they are two
things to keep in step, and a quiz asking two fields gets the same answer twice.

---

## What gets refused

The importer refuses rather than guesses, and a refusal names the entry. Nothing is written until
every refusal is cleared.

The last row is the one exception to that, and worth knowing before it happens. Matching is against
everything the app held when the file was read, so two entries in one file that reduce to one
address cannot see each other: the first creates the drug and the second asks for an address that
was free when it was checked and is taken by the time it is written. It is found while writing, so
the rest of the file lands and that one entry is skipped and named in the report — which says *that
entry was not written, everything else in the file was*. If a file half-landed, this is the row to
look for.

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
| two entries in one file reaching one address | the second is a new drug standing where the first one just landed, and two drugs a slug apart is a duplicate nobody can tell apart |

---

## Before you hand it over

- [ ] Every drug in the file is a **drug**, not a class, a target or a pathway.
- [ ] Nothing in the file is a disease fact that happened to share a slide with a drug.
- [ ] **The slides' figures were read**, and every table, taper and algorithm in them arrived as
      bullets, steps or a `flow` — not as pipes, and not left behind.
- [ ] **Nothing is `null` because it was only in a picture.** A figure you could not read is an
      omitted key or a `flagged` value, never an assertion that the deck said none.
- [ ] Each fact is in the field that is *about* that kind of fact — toxicity is not mechanism.
- [ ] Indications say what the deck scopes the drug to, biomarker included where it selects it.
- [ ] `null` only where the deck says there is none. Nothing you merely did not find.
- [ ] Anything ambiguous is `"status": "flagged"` rather than omitted or guessed.
- [ ] Nothing is declared twice for one idea, and nothing is declared that the field table already has.
- [ ] **Each drug appears once in the file**, holding what every deck in scope said about it — not
      once per lecture, which is two entries fighting over one version.
- [ ] **Every declared `label` is in Title Case** — `"Additional Notes"`, not *Additional notes* —
      with joining words, acronyms and hyphens as the `class` rule has them. The `key` stays
      `snake_case`.
- [ ] Every markdown value uses only paragraphs, nested bullets, numbered steps and headings.
- [ ] **No markdown value contains a semicolon.** Each idea is on its own line — a bullet, or a
      sub-bullet under the one it qualifies. (A `list` field may still use `;` between items.)
- [ ] **Every acronym is spelled out at its first use in each field**, and in each indication,
      unless it is on the keep-short list — brackets never nested, never two groups back to back,
      and every coverage mnemonic followed by its letters.
- [ ] **Every `pearl` is a pearl**: the slide labelled it one, or it is unique to that drug and no
      other field is about it. Nothing that another field already says, nothing true of the whole
      class, and no approval years. Most drugs have none — leave the key out.
- [ ] **Every value is a short fragment, and each fact is in exactly one field.** Shorter wording,
      never fewer facts.
- [ ] Every regimen component names a drug that is in `drugs` or already in the app.
- [ ] **`class` is left out unless the deck's own name must win.** A new drug's class is looked up
      from the FDA's own vocabulary; a paraphrase written here overrides that and sticks.
- [ ] **Every `class` is capitalised the way the library writes it** — `"Cephalosporin
      Antibacterial"`, `"Second-generation Cephalosporin"`. Every word takes a capital, except a
      joining word and a qualifier after a hyphen; an acronym keeps its own case.
- [ ] Every combination product is written out in full, with **every component capitalised** —
      `"Amoxicillin/Clavulanate"`. The separator and the spacing do not matter to matching; a
      different name does, so any short form the deck uses (`"Amox/Clav"`) is in `aliases`, with
      the brand name beside it.
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

  "scope": { "course": "PHRM 535", "exam": "Heme/Onc Exam 3 2026" },
  "source": {
    "file": "16.Melanoma.pdf",
    "deck": "PHRM 535 - Melanoma - Student.pdf",
    "accessed": "2026-11-09"
  },
  "write": "fill",

  "declare": [
    { "key": "ae", "label": "Adverse Effects", "type": "markdown", "group": "Clinical",
      "prompt": "What are the notable adverse effects of {{generic}}?" },
    { "key": "pearl", "label": "Clinical Pearls", "type": "markdown", "group": "Clinical",
      "prompt": "What is worth knowing about using {{generic}} that the other fields do not say?" },
    { "key": "pk", "label": "Pharmacokinetics", "type": "markdown", "group": "Clinical",
      "prompt": "How is {{generic}} metabolised and eliminated?" }
  ],

  "drugs": [
    {
      "generic": "Nivolumab",
      "brands": ["Opdivo"],
      "indications": [
        "Unresectable or metastatic melanoma",
        "Adjuvant treatment of resected stage IIB-IV melanoma"
      ],
      "class": "PD-1 Blocking Antibody",
      "fields": {
        "moa": "PD-1 inhibitor. PD-1 on T cells binds PD-L1 on the tumour and switches the T cell off late in the immune response. Blocking it restores T cell activation, recognition and attack.",
        "dosing": "240 mg IV every 2 weeks, or 480 mg IV every 4 weeks, until progression or toxicity.\n\nIn combination with ipilimumab the dose is lower — see Regimens.",
        "route": "IV",
        "ae": "- Diarrhoea 19%, grade 3-4 2%\n- Rash 26%\n- Hypothyroidism 9%\n- Raised transaminases (ALT/AST) 4%\n- Colitis 1%\n\nImmune-related adverse effects (irAEs) are fewer and milder than on the ipilimumab combination.",
        "bbw": null
      }
    },
    {
      "generic": "Ipilimumab",
      "brands": ["Yervoy"],
      "indications": ["Unresectable or metastatic melanoma"],
      "class": "CTLA-4 Blocking Antibody",
      "fields": {
        "moa": "CTLA-4 inhibitor. CTLA-4 on regulatory T cells limits T cell activity early in the immune response. Blocking it lets the response get started.",
        "route": "IV",
        "ae": "- Diarrhoea 33%, grade 3-4 6%\n- Colitis 12%, grade 3-4 9%\n- Rash 33%\n\nColitis is the characteristic one, and the largest on the CTLA-4 body map."
      }
    },
    {
      "generic": "Dabrafenib",
      "brands": ["Tafinlar"],
      "indications": ["Unresectable or metastatic melanoma, BRAF V600E positive"],
      "class": "BRAF Kinase Inhibitor",
      "fields": {
        "moa": "BRAF inhibitor. BRAF V600E holds the MAPK pathway (RAS-BRAF-MEK-ERK) always on. Inhibiting it stops the signal. Resistance develops through MEK, which is why it is given with a MEK inhibitor.",
        "dosing": "150 mg PO twice daily. Take with meals.",
        "route": "PO",
        "ae": "- Pyrexia — the greatest risk of the three BRAF/MEK pairs\n  - Onset 2-4 weeks, median 9 days\n  - Hold until it resolves, then restart at full dose\n  - Add prednisone 10 mg PO daily if it does not settle\n- Cutaneous squamous cell carcinoma, 12%\n- Rash, photosensitivity, arthralgia, fatigue\n- Reduced ejection fraction, ocular toxicity",
        "pearl": "Crosses the blood-brain barrier, so it is the pair to reach for with CNS metastases",
        "pk": "Metabolised by CYP2C8 and CYP3A4"
      }
    },
    {
      "generic": "Trametinib",
      "brands": ["Mekinist"],
      "indications": ["Unresectable or metastatic melanoma, BRAF V600E positive"],
      "class": "MEK Inhibitor",
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
      "when": "Stage IV initial therapy, National Comprehensive Cancer Network (NCCN) preferred. Used regardless of PD-L1 expression and regardless of BRAF status.",
      "components": [
        { "drug": "Ipilimumab", "dose": "3 mg/kg IV every 3 weeks x 4 cycles" },
        { "drug": "Nivolumab", "dose": "1 mg/kg IV every 3 weeks x 4 cycles, then 240 mg IV every 2 weeks or 480 mg IV every 4 weeks until progression or toxicity" }
      ],
      "notes": "Median overall survival (OS) 72.1 months in CheckMate 067, against 36.9 for nivolumab alone and 19.9 for ipilimumab alone. The highest immune-related adverse effect (irAE) burden of the first-line options."
    },
    {
      "name": "Dabrafenib + trametinib",
      "when": "BRAF V600E positive stage III adjuvant or stage IV disease.\n- Consider first when disease is high-volume and symptomatic\n- Otherwise an immune checkpoint inhibitor (ICI) first, since the ICI-then-BRAF/MEK sequence gives longer response and overall survival",
      "components": [
        { "drug": "Dabrafenib", "dose": "150 mg PO twice daily, with meals" },
        { "drug": "Trametinib", "dose": "2 mg PO once daily" }
      ],
      "flow": "- BRAF V600E or V600K mutation?\n  - No -> immune checkpoint inhibitor (ICI), not this\n  - Yes -> either, and the sequence matters\n    - High-volume symptomatic disease -> BRAF/MEK first\n    - Otherwise -> ICI first, BRAF/MEK on progression\n- Pyrexia during treatment?\n  - Hold until it resolves, then restart at full dose\n  - Not resolving -> prednisone 10 mg PO daily, antipyretics, fluids",
      "notes": "Of the three BRAF/MEK pairs:\n- This one crosses the blood-brain barrier and carries the greatest pyrexia risk\n- Vemurafenib + cobimetinib has the highest overall rate of adverse effects\n- Encorafenib + binimetinib has the least pyrexia\n\nAll three prolong QTc except dabrafenib + trametinib."
    }
  ],

  "issues": [
    "The ABCDE slide writes E as 'Enlargement' in the table and 'evolving' in the sentence under it. Recorded as neither — it is not a drug fact.",
    "Nivolumab + relatlimab is one formulation (Opdualag) dosed as nivolumab 480 mg / relatlimab 160 mg IV every 4 weeks. Relatlimab is not separately available, so it is entered as a drug but has no monotherapy dosing."
  ]
}
```
