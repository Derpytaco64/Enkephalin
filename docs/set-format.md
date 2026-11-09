# `enkephalin.set/1` — authoring guide

This is the import format for Enkephalin's **Class sets** section: organised course material that
the app turns into flashcards and multiple-choice questions.

Sets **nest**. Each file declares where it sits in the course (`course` / `exam` / `unit` / `topic`),
and the app builds a deck tree out of those four lines: every level is itself studiable, so you can
sit *just hyperthyroidism*, or the whole of *Exam 3*, and an Exam 3 paper draws its wrong answers
from every set under Exam 3. Getting those four lines right — and spelling them the **same way
every time** — is what makes a file you write today join the set you imported last week. See
*Where the set sits* below; it is the part most worth re-reading before you hand a file over.

You are probably reading this because somebody handed you this file plus a set of lecture notes and
asked for a set file. Everything you need is here. Output **one strict JSON file per topic** — no
comments, no trailing commas, UTF-8.

See `PLAN.md` → *A second section: imported sets* for why the format is shaped this way.

---

## The one rule that matters

**You are converting notes into a table, not into cards.**

A card like

> *What is octreotide used for, how is it dosed, and what are its adverse effects?*
> → *Carcinoid syndrome (and acromegaly); 100 mcg SC TID or LAR 20-30 mg IM q4wk; GI effects (~50%),
> gallstones (25%), sinus bradycardia (25%)*

is a good flashcard and an impossible multiple-choice question — four three-part options are told
apart by overlap, not by knowledge. Written as **one row with three columns** (`use`, `dose`,
`adverse_effects`) the same fact makes three real questions plus a combined one.

So: **one row per thing, one column per attribute.** Split every multi-part answer. If a note
answers three questions, that is three columns, not one cell with semicolons.

And where a cell genuinely does hold several parts -- a `recall_only` card, a `notes` column --
**put each part on its own line with `<br>`, never in a `;`-separated run.** A run of semicolons is
a paragraph pretending to be a list: it reads as a wall on a phone, it hides how many parts there
are, and it is the shape that makes somebody think the cell is one answer when it is four. See
*Several lines in one cell*.

The app generates the questions. You never write a question, a prompt or a wrong answer — the wrong
answers are other rows' values in the same column, which is why the table shape is the whole point.

---

## Skeleton

Copy this and fill it. Delete the optional keys you do not need.

```json
{
  "format": "enkephalin.set/1",
  "slug": "",
  "name": "",

  "course": "",
  "exam": "",
  "unit": "",
  "topic": "",
  "source": { "file": "", "pages": "" },

  "identity": { "key": "name", "label": "Name", "kind": "drug" },
  "group": "",
  "kinds": ["drug"],

  "fields": [
    { "key": "", "label": "", "type": "text", "answers": "" }
  ],

  "items": [
    { "name": "" }
  ]
}
```

---

## Keys

### Set level

| Key | Required | What it is |
|---|---|---|
| `format` | **yes** | Always the literal `"enkephalin.set/1"` |
| `slug` | **yes** | Natural key, kebab-case, unique. Re-importing the same slug updates that set in place |
| `name` | **yes** | What a person sees, e.g. `"Thyroid — Drugs to Know"` |
| `course` | no | e.g. `"PSCI 413"` |
| `exam` | no | e.g. `"Exam 3"` |
| `unit` | no | The course's own unit name, e.g. `"Unit 5: Thyroid"` |
| `topic` | no | The narrowest scope, e.g. `"Hyperthyroidism"`. **One set per topic** |
| `source` | no | `{ "file": "14.Thyroid.pdf", "pages": "11-13" }` — where this came from |
| `identity` | **yes** | Which column names the subject. See below |
| `group` | no | Names one of your `fields`. The near-miss axis — see *Wrong answers* |
| `kinds` | **yes** | Every `kind` your items use, declared up front |
| `fields` | **yes** | The columns |
| `items` | **yes** | The rows |

`course` / `exam` / `unit` / `topic` are the set's address in the deck tree. See the next section —
they have to be spelled consistently, and they are the keys that let a later file land in the same
deck as this one.

## Where the set sits — `course` / `exam` / `unit` / `topic`

These four lines put the set in the deck tree. Nothing else does: there is no nesting key, no parent
id, no folder. Two files that spell their scope the same way are in the same deck, and two that do
not, are not.

### How a line becomes a deck

Each value is **slugified** into one URL segment, by exactly this rule:

> lower-case → strip accents → every run of anything that is not a letter or digit becomes a single
> `-` → trim leading and trailing `-`

So a set declaring

```json
"course": "PSCI 413",
"exam":   "Exam 3",
"unit":   "Unit 5: Thyroid",
"topic":  "Hyperthyroidism",
```

is reachable at `/sets/psci-413/exam-3/unit-5-thyroid/hyperthyroidism`, and at every level above it.
The **first spelling imported supplies the label** people see; the slug is what groups.

### The spelling rule: same words, same digits

Because the slug is what groups, **case and punctuation are forgiving and words and digits are
not.** These all land in the same deck:

| Written | Slug |
|---|---|
| `"Exam 3"` | `exam-3` |
| `"exam 3"` | `exam-3` |
| `"EXAM 3"` | `exam-3` |
| `"Exam #3"` | `exam-3` |

and every one of these makes a **separate, half-empty deck** that will quietly not pool with the
others:

| Written | Slug | Why it splits |
|---|---|---|
| `"Exam III"` | `exam-iii` | Roman numerals are different words |
| `"Test 3"` | `test-3` | Different noun |
| `"Exam 3 (Endocrine)"` | `exam-3-endocrine` | The extra word is part of the address |
| `"Exam 3 — Endocrine"` | `exam-3-endocrine` | Same |
| `"Exam3"` | `exam3` | No separator, so no `-` |
| `"Exam 03"` | `exam-03` | `03` and `3` are different digits |

**So: `"Exam 3"`. The word `Exam`, a space, the arabic numeral, nothing else.** Put the endocrine
part in `unit`, where it belongs. The same discipline applies to `course` (`"PSCI 413"`, the
registrar's code, not `"Pharm 2"` one week and `"Pharmacology II"` the next) and to `unit` (the
course's own unit heading, copied — `"Unit 5: Thyroid"`).

### Reproducing it next time

You will be back here: a quiz finds a gap, the lecture gets a second set of slides, and you write
another file for the same exam. Two ways, and the choice is only about whether it is the *same set*:

**Adding rows to the set that already exists** — keep the **same `slug`**, and re-import. The
importer merges by slug: rows it has never seen are inserted, rows it recognises are updated, and
**study history survives** — schedules and quiz answers are keyed on the row, not on the file. Rows
are recognised by the slug of their identity value under the same rule as above, so
`"Levothyroxine"` is `levothyroxine` whatever else changes in the file. Renaming a row is therefore
*not* an edit: `"Levothyroxine"` → `"Levothyroxine (T4)"` is a new row and the old one's history
stays with the old row. Put other names in `aliases` instead.

**Adding a new set beside it** — a new `slug`, the **same four scope lines, character for
character**. It appears as another set under that unit, and the unit and exam decks above it now
quiz over both files at once.

Either way, the scope lines are re-read on every import, so **a wrong exam number is a fix, not a
migration**: correct the line, re-import the same slug, and the set moves to the right deck with
its progress intact. A deck's identity never enters a card's key, so nothing re-starts from zero.

The fastest way to get the strings right is not to retype them: open `/sets`, read the labels off
the tree (the URL segment is in the address bar), and **copy the four lines out of a sibling file
you have already imported.**

### Fill from the top down, no holes

An empty level **collapses** — a set with a `course` and a `unit` but no `exam` hangs directly off
its course, and that is deliberate: a branch called *(no exam)* is a thing nobody filed anything
under. The consequence is that a skipped level is not addressable, so that set will never show up
under any exam. Fill `course`, then `exam`, then `unit`, then `topic`, and stop where the notes stop.

One set per `topic` is still the rule. If the notes for a topic are long, that is more **rows**, not
a second file with the same scope and a different slug.

### Keep `kinds` consistent within an exam

The identity question is worded from the declared kind — *Which drug?*, *Which hormone?*. A deck
whose sets disagree asks *Which one?* instead, which is correct but vaguer. Worth a thought when
you pick `identity.kind` for a file that will sit beside others.

---

### `identity`

The `identity` object:

```json
{ "key": "generic", "label": "Generic", "kind": "drug" }
```

- `key` — the property on each item holding its name. Use the notes' own word: `generic`, `hormone`,
  `receptor`, `term`.
- `label` — how it is shown.
- `kind` — the default `kind` for items that do not state their own.

The identity is **never** asked about as an attribute. It is the stimulus going forwards (*what is
the mechanism of methimazole?*) and the answer going backwards (*which drug inhibits TPO?*).

### `fields` — the columns

| Key | Required | What it is |
|---|---|---|
| `key` | **yes** | Property name on items. snake_case |
| `label` | **yes** | Column heading a person sees |
| `type` | **yes** | `text`, `markdown`, `enum`, `list`, `number`, `bool` |
| `answers` | **yes**, unless `asks` is false | What kind of answer this column holds. **Closed vocabulary — see below** |
| `options` | if `type` is `enum` | The allowed values |
| `prompt` | no | Question wording, with `{{name}}` for the subject: `"What is the mechanism of {{name}}?"` |
| `asks` | no | `false` = context only, never asked. Use for a `notes` column |
| `reversible` | no | Whether the column can be the *clue* instead of the answer. Defaults true for entity-ish `answers` types, false for prose |
| `measured_in` | no | Unit for `number` columns: `"mg"`, `"hours"`, `"aa"` |
| `ordinal` | no | `true` if values can be ranked (half-lives, potencies) |

Use `list` whenever an attribute has several independent values — `["Hyperthyroidism", "Graves
disease"]`, not `"Hyperthyroidism and Graves disease"`. The app then knows each is separately true,
and will never offer one as a wrong answer to the other.

Inside a single `text` or `markdown` cell, break lines with `<br>` rather than running the
parts together with semicolons — see *Several lines in one cell*.

### `items` — the rows

Each item is a flat object: the identity key, plus one property per column you filled, plus any of:

| Key | What it is |
|---|---|
| `kind` | Overrides `identity.kind` for this row |
| `aliases` | Other names for the same thing: `["T4", "Synthroid"]` |
| `sequence` + `order` | This row is step `order` of the named sequence |
| `recall_only` | `true` = flashcard only, never multiple choice |

Leave a column out of an item entirely if the notes do not give it. Do **not** write `""`, `"N/A"`,
`"unknown"` or `"not stated"` — a missing value is handled correctly and a fake one becomes a wrong
answer in somebody's quiz.

---

## `answers` — the closed vocabulary

This is the most important field you will set, and **you may not invent values for it.**

It is how the app pools wrong answers. Two sets that both tag a column `mechanism` can borrow
distractors from each other even if one calls the column *Mechanism*, another *Principle mechanism*
and a third *Target*. A column tagged `mechanisms` or `moa` pools with nothing, and the import is
refused.

| `answers` | Use for |
|---|---|
| `drug_name` | Generic drug names |
| `brand_name` | Trade names |
| `hormone` | Hormones, endogenous signalling molecules |
| `receptor` | Receptors |
| `enzyme` | Enzymes, including P450s |
| `site` | Molecular or cellular site of action |
| `stem` | Drug-name stems (`-olone`, `pred-`) |
| `chemical_class` | Chemical or structural class, subclass |
| `composition` | What a thing is made of — peptide/protein/steroid, chains, residues |
| `mechanism` | How it works, prose |
| `target` | What it acts on, when named as an entity |
| `indication` | Disease or condition treated; clinical use |
| `effect` | Physiological effect or direction of change |
| `function` | Normal biological function of a structure |
| `toxicity` | Adverse effects, warnings, contraindications |
| `population` | Patient group |
| `dose` | Amount + route + frequency |
| `route` | Route alone |
| `half_life` | Half-life |
| `duration_class` | Short/intermediate/long acting |
| `potency_ratio` | Relative potency, e.g. anti-inflammatory : salt-retaining |
| `location` | Anatomical location, tissue |
| `source_tissue` | Where something is made or released from |
| `count` | A plain number — residues, chains, iodines |
| `year` | A year or date |
| `prose` | Explanation that fits nothing above. Use sparingly; it pools weakly |

If an attribute genuinely fits none of these, tag it `prose` and say so in your handover notes.
Do not guess a new name.

## `kinds` — open, but declare them

`kind` keeps the *identity* question sane: asked *which of these is methimazole?*, the options must
be other **drugs**. If the pool mixed in a hormone, a receptor and a site, three options would be
eliminable without knowing anything.

Common kinds: `drug`, `brand`, `hormone`, `receptor`, `enzyme`, `condition`, `class`, `site`, `step`,
`stem`, `concept`.

Unlike `answers`, you may add your own — a respiratory unit will want `organ` or `pathogen`. Just
list every one you use in the set's `kinds` array, or the import is refused.

---

## Wrong answers, and the three things you control

You never write wrong answers. The app draws them from the **deck being studied** — one set, or
every set under the exam or unit you opened — trying hardest first:

1. Same column, same `group` value
2. Same column, same scope — a set sharing this one's unit or exam ranks above an unrelated one
3. Same column, anywhere in the deck
4. Any answer in the deck, at random — last resort

Note what step 1 and step 3 mean together: **columns pool across sets by their `key`.** Three sets
under Exam 3 that all call a column `mechanism` give that exam's paper one pool of mechanisms over
all their rows, which is the reason to sit the exam rather than the set. A column one file calls
`mechanism` and another calls `moa` is two pools. **Reuse the key.**

So three of your choices decide question quality:

- **`group`** gets you step 1. Point it at the column that sorts rows into families — `subclass`,
  `class`, `mechanism_type`. Without it, the best near miss is unavailable.
- **The column `key`, spelled the same across sibling sets**, gets you the cross-set pool.
- **`list` and `aliases`** stop a *true* answer being offered as a wrong one.

`answers` is still required and still checked, and it is what a later version will use to pool two
*differently named* columns of the same type. It does not draw anything today.

A question with fewer than three usable distractors is not asked at all, so a set with four rows in
a column makes flashcards and no multiple choice — though the unit above it may well have enough
rows to ask what the set alone cannot. That is fine and expected; the import report will
tell the user which columns are quizzable.

---

## Special cases

### A fact that will not decompose

Deck 19's *Stem / Meaning* table is nine stems matched at once. An ordering fact — *order these
hormones by half-life* — is likewise one idea. Keep it, mark it:

```json
{ "generic": "Drug stems", "recall_only": true,
  "notes": "-olone — steroids<br>bol- — anabolic<br>-cort- — cortisone derivatives<br>pred- — prednisone" }
```

It becomes a flashcard and is never offered as multiple choice. **Prefer decomposing** — nine stems
as nine rows of kind `stem` with a `meaning` column makes nine real questions. Use `recall_only`
when decomposing would distort the fact, not when it is merely more work.

### Several lines in one cell

Any `text` or `markdown` cell may hold `<br>` to break a line. Use it for the cells that are
genuinely several parts — the `recall_only` cards above, a `notes` column, a mechanism with two
distinct steps:

```json
{ "generic": "Methimazole", "kind": "drug",
  "mechanism": "Inhibits thyroid peroxidase<br>Blocks organification of iodide",
  "notes": "Preferred over PTU except in the first trimester<br>Once-daily dosing" }
```

Three things about it:

- **It is a line break, not a separator.** The importer renders it as one, and never splits a cell
  on it to make several answers. A cell that should become several *values* is a `list`; a cell
  that should become several *questions* is several columns. `<br>` is for when the parts belong to
  one answer and still need to be read apart.
- **A real newline in the JSON string works too** (`"...peroxidase\nBlocks..."`),
  and is treated identically. `<br>` is the one to prefer: it survives a copy-paste that eats
  newlines, and it is visible when you proofread the file.
- **It is never used as a clue or a wrong answer.** Distractors are drawn from other rows' values
  in the same column, whole.

Do not reach for it to avoid decomposing. A mechanism with two steps is one answer on two lines; a
cell holding a mechanism *and* a dose is two columns, and `<br>` between them is the same mistake
the semicolon was.

### A sequence

A pathway or cascade where the order *is* the content:

```json
{ "step": "Organification", "kind": "step", "sequence": "t4-synthesis", "order": 2,
  "notes": "Iodine attached to tyrosine residues on thyroglobulin" }
```

Both keys, always. One set can hold more than one sequence, and a bare `order` would interleave
them. Gaps are fine; two rows at the same position in one sequence are refused. A sequence's wrong
answers are only ever the other steps of that sequence.

### Aliases

T4, thyroxine and levothyroxine are one thing. Declare them, or two of them can end up as two
options in one question — two right answers.

```json
{ "generic": "Levothyroxine", "aliases": ["T4", "Thyroxine", "Synthroid"] }
```

An alias claimed by two different rows is refused.

### Numbers

Use `type: "number"` with `measured_in`, and put the bare number in the cell: `"residues": 191`, not
`"191 amino acids"`. Distractors then come from other rows' real values.

---

## What gets refused

The whole file, with the row and column named. Nothing is half-imported.

- `format` not `"enkephalin.set/1"`
- An item with no identity value
- Two items with the same identity value
- An `answers` value outside the vocabulary above
- A `kind` not listed in `kinds`
- `group` naming a column that is not in `fields`
- An `enum` cell that is not one of that column's `options`
- The same alias on two items
- `order` without `sequence`, or two items at the same position in one sequence
- A column with no `answers` and no `asks: false`

---

## Before you hand it over

1. **Valid strict JSON** — no comments, no trailing commas.
2. **Every `answers` value is from the table above.** Check each one.
3. **Every `kind` used is in `kinds`.**
4. **The scope lines match the set they belong beside, character for character** — `"Exam 3"`, not
   `"Exam III"` or `"Exam 3 (Endocrine)"`. Copy them from a sibling file rather than retyping, and
   say in your handover which deck this lands in: `/sets/<course>/<exam>/<unit>`.
5. **Column keys match the sibling sets' keys** where they mean the same thing, so the exam's
   questions pool.
6. **No fabricated content.** Every cell traceable to the notes. Omit rather than infer — this is
   pharmacy study material and a plausible invention is worse than a gap.
7. **No multi-fact cells.** Scan for `;` and ` and ` in values; each is probably two columns or a
   `list`. If the parts really do belong to one answer, break them with `<br>` — no value should
   be a long single line of semicolon-separated parts.
8. **`group` is set** if the rows have any natural family.
9. **Count rows per column.** Say in your handover which columns have four or more distinct values
   (quizzable) and which do not (flashcard only).

Report anything the notes were ambiguous about rather than resolving it silently.

---

## Worked example

Shape-illustrative. The content comes from deck 14's *Drugs to Know* table; **anything you reuse
must be re-checked against the slides.**

```json
{
  "format": "enkephalin.set/1",
  "slug": "ergi-pd-hyperthyroidism-drugs",
  "name": "Hyperthyroidism — Drugs to Know",

  "course": "PSCI 413",
  "exam": "Exam 3",
  "unit": "Unit 5: Thyroid",
  "topic": "Hyperthyroidism",
  "source": { "file": "14.Thyroid.pdf", "pages": "11-13" },

  "identity": { "key": "generic", "label": "Generic", "kind": "drug" },
  "group": "subclass",
  "kinds": ["drug"],

  "fields": [
    { "key": "subclass", "label": "Subclass", "type": "enum",
      "answers": "chemical_class",
      "options": ["Iodide", "Radioactive iodide"] },

    { "key": "composition", "label": "Composition", "type": "text",
      "answers": "composition" },

    { "key": "mechanism", "label": "Mechanism", "type": "markdown",
      "answers": "mechanism",
      "prompt": "What is the mechanism of {{name}}?" },

    { "key": "effect", "label": "Effect", "type": "text",
      "answers": "effect" },

    { "key": "use", "label": "Clinical use", "type": "list",
      "answers": "indication" }
  ],

  "items": [
    {
      "generic": "Iodide solutions",
      "aliases": ["Lugol's solution"],
      "subclass": "Iodide",
      "composition": "Iodide/iodine",
      "mechanism": "Inhibit organification and hormone release",
      "effect": "Decrease thyroid hormone levels",
      "use": ["Hyperthyroidism", "Pre-surgery preparation"]
    },
    {
      "generic": "Radioactive iodide",
      "aliases": ["131-I", "Sodium iodide I-131"],
      "subclass": "Radioactive iodide",
      "composition": "Iodide Na/K salt, 131-I beta-emitter",
      "mechanism": "Accumulates in the thyroid",
      "effect": "Tissue destruction",
      "use": ["Radiotherapy"]
    }
  ]
}
```

Two rows is below the four distinct values a four-option question needs, so this set would import as
flashcards and the report would say so. A real topic set should carry every drug in the table.
