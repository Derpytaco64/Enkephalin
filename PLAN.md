# Enkephalin — Pharmacy Drug Study Site

> Working plan. This file is the canonical record — update it as decisions change.
> Last revised: 2026-11-04

## Context

A self-hosted site for studying drugs for pharmacy school. The origin is a handwritten note,
photographed at `PXL_20261028_223347704.jpg` in this directory, laying out the fields a drug profile
carries, a tagging scheme, and two study modes.

Transcription of the note:

| Drug profile fields | Tags | Formatting | Study styles |
|---|---|---|---|
| Brand / Generic | Top Drug Year | Light | Flashcard (T/F) |
| Schedule | Top Drug Class | Dark | Quiz (multiple choice) |
| MOA | | Color coding? | |
| Dosing | | | |
| Indication | | | |
| Drug Class | | | |
| Adverse Effects | | | |
| → Drug Profile page | | | |

### Decisions

- **Content source is the class sheet** — `2026 - top-drugs-master-doc-blackboard-posting.pdf`,
  237 drugs, extracted to `data/top-drugs-2026.json`. No bulk third-party import.
- **The database is the content now; the sheet was the baseline** (2026-11-04, owner's call). The
  extract was how the content got here and is still the reference for what the class is examined
  on, but it is no longer re-run and no longer a thing the app is rebuilt from. The database is the
  authority, and the way content moves or comes back is `npm run export` / restore — not re-seeding.
  See [The sheet is a baseline, not a source of
  truth](#the-sheet-is-a-baseline-not-a-source-of-truth-2026-11-04) for what that changes.
- **The sheet assigns fields to program years.** Its header makes each column the responsibility of
  P1, P2, or P3. This is a property of the *field*, not the drug, and it drives study scoping.
- **Only the sheet's own columns are study material** (2026-11-01). Generic, brand, indication,
  dosing, controlled schedule, mechanism of action and black box warning are asked; nothing else
  is. The two fields that are not sheet columns -- `drug_class`, resolved from RxNorm, and `route`,
  read out of the drug's name and dosing text -- carry `isQuizzable: false`. They are not
  second-class: class drives colour coding, the browse filter and same-class distractor sampling,
  route drives the study scope filter and the per-route dosing subsystem to come, and the route
  appears inside a dosing answer, which *is* asked. `tests/fields.test.ts` pins the set, because a
  re-seed or a stray checkbox in the admin field editor would otherwise put an untaught field into
  a deck quietly.
- **Public drug APIs are an on-demand lookup, not a seeding step.** When adding or editing a drug,
  a lookup panel queries DailyMed / RxNorm / openFDA and lets you pull individual values into
  individual fields, one at a time, with the citation recorded. Nothing is ever auto-filled in bulk.
- **Fields are not fixed.** The note's seven fields are a starting set, not the schema. More will be
  added (half-life, pregnancy category, renal dosing, boxed warning, kinetics, counseling points…),
  so fields are **data, defined and edited in the admin UI**, not columns in a migration.
- **Stack** — full app with accounts, Docker on a personal server.
- **Scope** — everything on the note in v1: browse, profiles, flashcards, multiple-choice quiz.
- **Users** — owner plus invited classmates, public HTTPS, invite-code registration only.
- **Devices** — phone and laptop treated equally.
- **Study config** — testing lets you pick *which* fields are in play, in two modes: **inclusive**
  (selected fields share one card/question) and **exclusive** (each field becomes its own
  card/question).
- **Therapeutic categories are what you study by, not the FDA class** (2026-11-01). The class is
  too fine to be a category: 119 values over 216 drugs, 80 of them naming a single drug, and no
  *Anticonvulsants* at all -- the sheet's nine anticonvulsants scatter across *Mood Stabilizer*,
  *Anti-epileptic Agent*, and five with no class. So `scripts/seed-categories.ts` groups the class
  axis into 65 course-level categories held as tags of kind `system`, and the class stays what it
  was: colour coding, the browse filter, and the axis same-class distractors are drawn along.

  Categories are tags because `drug_tags` is many-to-many, which a class column is not:
  carbamazepine is an anticonvulsant *and* a mood stabiliser, and both are true. They are a
  separate study scope axis from drug lists (`scope.categories`, not more entries in `scope.tags`)
  because the two combine differently -- two lists mean *either* list, while a list and a category
  mean the drugs in *both*. "Top Drugs 2026 + Anticonvulsants" is the anticonvulsants within that
  list, which one OR-ed array cannot express.

  The map is curated judgement, not a lookup, so it is one table to read and argue with. Its
  per-drug overrides exist for where a mechanism class and a therapeutic category part company:
  carvedilol's class says alpha blocker but it is taught as a beta blocker, sotalol is a beta
  blocker as well as a class III antiarrhythmic, tamsulosin is uroselective and not a blood
  pressure drug, and dexmedetomidine, tizanidine and guanfacine share clonidine's class without
  sharing its indication.
- **Indications are a third scope axis, and need no curated map** (2026-11-01). The sheet's
  indication column is already a short controlled vocabulary -- 95 distinct strings over 249 rows,
  *Hypertension* sixteen times and *Depression* fifteen -- so the texts group themselves and
  `scope.indications` filters on them directly. It is its own axis for the same reason categories
  are: "the antihypertensives" and "the drugs used for hypertension" overlap without being the
  same question, and a drug has several indications the way it has several categories. Several
  indications mean *any* of them; a list or a category still applies on top.

  What the column does not do is agree with itself about plurals and abbreviations, and that bites
  twice: picking *Seizure* and silently missing the two drugs written up as *Seizures* is a wrong
  deck, and a quiz offering one as the wrong answer to the other is offering a right answer.

  **One wording per indication, fixed in the data** (2026-11-02). `lib/drugs/indications.ts` holds
  a three-entry table -- *Seizure* -> *Seizures*, *Bacterial infection* -> *Bacterial infections*,
  *BPH* -> *Benign prostatic hypertrophy (BPH)* -- and it is not only a comparison: migration 0004
  rewrote the stored rows, and **every writer canonicalises through it**, the importer and the drug
  editor included. So the database holds one spelling and a profile, a filter and a quiz option
  read the same words. The table has to stay because the sheet does not change: a re-import would
  otherwise put the old spelling back beside the new one -- verified by re-running `npm run seed`
  after the migration, which reported *0 new indications*.

  Plural wins where the sheet disagrees with itself, which is the owner's call; BPH is not a plural
  question, and the expansion wins there because it teaches what the abbreviation stands for. The
  rows were updated in place, so the 24 brand↔indication pairings that point at them survived.
  95 wordings became 92, which is now exactly the number of filter options -- the two were out of
  step by three before, and that gap *was* the bug.

  Anything needing a judgement about what a phrase *means* is still left alone: *Chronic pain*
  stays apart from *Pain*, *Acute ischemic stroke* from *Ischemic stroke prevention*, because those
  are clinical claims and an alias table is not where one gets made.

  One consequence, taken deliberately while the feature was a day old: the slug follows the label,
  so `ind=seizure` became `ind=seizures` and a link saved before today no longer matches. Nothing
  in the app generates the old one. From here the slugs are addresses and should not move; the
  alias table is where a future rename would keep an old one working.

  Both of the big axes are collapsed by default in session settings (`ScopePicker`), because 65
  categories plus 92 indications would otherwise be the whole panel. A closed `<details>` only
  hides its contents, so the boxes inside still submit -- and the summary keeps name, description
  and tick count visible, so a collapsed axis can never be a filter you cannot see.
- **The editor writes; the importer only adds** (2026-11-02). `/drugs/[slug]/edit` makes the whole
  profile editable and `/drugs/new` adds a drug by hand, both through `lib/drugs/mutations.ts`.
  Four rules fell out of building it, each because the alternative loses something:

  - **The slug never changes.** Renaming a drug rewrites `generic_name` and nothing else: the slug
    is in saved session links and is how a `study_cards` row finds its way back to the drug, so
    changing it would break both to no purpose.
  - **Brands and indications are diffed, not rewritten.** Other rows point at their ids --
    `brand_indications` pairs them, and a brand carries its own `dosing_override` and pairing
    review state. Delete-and-reinsert would throw all of that away every time someone fixed a typo
    elsewhere in the list. Editing a line keeps the row; removing it deletes it, pairings included.
  - **Saving is what records a value.** (This replaced an "editing un-verifies it" rule when
    verification was removed later the same day -- see *Accuracy guard*.) A field carries `ok`,
    `flagged` or `none`, the editor writes itself into `updatedBy`, and a dosing edit re-parses
    `dosing_regimens` outright, since nothing hand-edits those rows.
  - **Categories are not editable here.** They are `system` tags and `scripts/seed-categories.ts`
    rebuilds every system link on each run, so a hand-made category assignment would last until the
    next run and then vanish. The editor assigns lists, courses and custom tags; category membership
    is a change to the map. The editor says so rather than offering a control that does not hold.

  The importer is the other writer, and it only ever adds. A brand or indication deleted in the
  editor comes back on the next `npm run seed` if the sheet still lists it; the editor warns about
  that inline. An exclusion list is the fix if that becomes a nuisance -- deliberately not built
  yet, since nothing has needed it.
- **Dosing prose carries a live readback** (2026-11-02). The parser is pure and client-safe, so the
  editor shows the same reading the save will store: the sig, the sig turned back into English, the
  parser's notes, and anything it could not account for. A mis-filed component shows up as a
  sentence that does not mean what you typed, which is the fault a token-coverage guard cannot
  catch -- and until this existed, the only way to see it was to save and re-run a script.
- **A session can be capped, and the cap samples** (2026-11-02). `maxCards` is the most cards a
  session will hand you; 0 means the whole deck and is what the control shows when untouched -- the
  field reads *236* against the current scope rather than "unlimited", so lowering it is an obvious
  move rather than a discovered feature.

  Above the cap the deck is **sampled at random**, not truncated. The deck arrives in alphabetical
  order, so taking the first 50 of 236 would teach the A's and never reach the Z's; a fresh random
  draw each session means a run of short sittings still covers the list. The cap applies to what
  survives the due filter, so "max 50" in review mode means fifty cards in front of you rather than
  fifty drawn and then thinned down to nine by the schedule.
- **Tags are edited as a roster, not a search box** (2026-11-02). `/admin/tags/[slug]` lists every
  drug in the database with a checkbox each, three columns, filterable. The whole roster because the
  question being answered is "is this list right?", and that is only visible against the drugs that
  are *not* on it. Filtering never hides a ticked drug, so what the form will submit is always on
  screen, and the save replaces membership with exactly what is ticked. Creating a list drops you
  straight into that checklist, since a list with nothing on it is not finished.
- **A backup is one JSON file, keyed by slug, carrying no credentials** (2026-11-02).
  `lib/data/backup.ts` holds export and restore together so the two cannot drift, and the file uses
  natural keys throughout -- a drug by slug, a tag by slug, a brand by name, a person by email --
  with no UUIDs at all. That is what lets a dump restore into a database it did not come from,
  which is the only kind of backup worth having. It also means the file is readable and diffable.

  It carries the content, tags, field definitions, site settings and each person's study progress.
  It deliberately carries no password hashes, no sessions, no invite codes and no audit log: a
  backup should be a file you can keep anywhere without it being a way to log in as you. Progress
  is matched to accounts by email on restore, and a person with no account here is *reported*
  rather than created -- a restore must not be able to mint a login.

  Two modes, as separate words rather than a flag: `merge` writes what the file contains and leaves
  anything it does not mention alone (for getting work back after an accident), while `replace`
  also deletes the drugs the file lacks (for moving a database, or undoing a bad bulk edit) and
  takes a typed REPLACE to confirm. A drug's children -- brands, indications, dosing rows, tag
  links -- are taken wholesale from the file in both modes: the file is the authority on that one
  drug, and merging them row by row would silently resurrect a brand you had deleted.

  Surfaces: `/admin/data` to download and to restore, and `npm run export` / `npm run restore` for
  a scheduled task. The scripts need to reach Postgres from the host, so compose now publishes it
  on `127.0.0.1:5432` and `DATABASE_URL_HOST` in `.env` is what the scripts read -- the app's own
  `DATABASE_URL` names the compose host `db`, which resolves nowhere else.
- **The dosing box is coloured by how the parser read it** (2026-11-02). Green when every token was
  accounted for, amber when it parsed but wants a human, red when the parser refused -- with the
  readback underneath saying the same thing in words, since colour is never the only signal here.
  It is the one field whose wording has to survive being decoded, so seeing that at the moment of
  typing is the difference between catching a mangled dose and discovering it in a quiz.
- **A quiz question is the answer, one near miss, and two strangers** (2026-11-02). Four options,
  and the composition is the whole design. Exactly one distractor comes from the same class (the
  categories are the fallback for a class of one), and the rest from anywhere -- four statins'
  doses side by side is a memory test for digits rather than a question about statins, while four
  unrelated options are answerable by elimination without knowing anything.

  **The scope decides what is asked; distractors come from the whole database.** This matters at
  both ends: a paper narrowed to the four statins can still fill four options, and "an indication
  of atorvastatin" inside a statins-only scope would otherwise have no wrong answer available and
  the question would silently vanish. Measured on the real data: a statins + dosing paper gives
  four questions, each one correct answer plus exactly one class-mate plus two from elsewhere.

  **Two answers count as the same answer by meaning, not spelling** -- `answerKey` in
  `lib/study/quiz.ts`, and the first version of this got it wrong by comparing lowercased text:

  - *Indications* go through the alias table that `lib/drugs/indications.ts` already holds, because
    the sheet writes one indication two ways. Three real pairs: *Seizure* / *Seizures*, *Bacterial
    infection* / *Bacterial infections*, *BPH* / *Benign prostatic hypertrophy (BPH)*. Offering one
    as the wrong answer to the other is offering a right answer.
  - *Dosing* compares the **printed sig**, which is exactly what the structured components are for.
    Measured on the real data: 200 of 236 drugs have a comparable sig and **56 of them share a dose
    with at least one other drug** -- eight drugs are *20 mg PO QD*, six are *10 mg PO QD*. Text
    comparison catches the identically-worded ones and misses the rest: sertraline's "50 mg by
    mouth once a day" and nortriptyline's "50 mg by mouth daily in single or divided doses" are the
    same dose in different words.
  - Everything else falls back to trimmed, lowercased text, which is the most that can be claimed
    about prose nobody has decoded.

  On top of that, every value the question would *also* accept is excluded from the distractors and
  shown after answering: asked "which drug is dosed 20 mg PO QD?" the sheet makes **eight** drugs
  right, so seven cannot be offered as wrong. Asked "which drug treats dyslipidemia?", ten are.

  Swept over the real database to check rather than assume: 66,080 generated questions across
  dosing and indication in both directions and mechanism reversed -- no option repeated, no
  also-right answer offered as wrong, and no dosing option drawn from a drug with the same sig.

  A sig marked *unique/complicated* is quizzed as multiple choice like anything else. Its wording
  is distinctive enough that no other option could accidentally be right, which is the owner's
  call and replaces the earlier plan to hold component-less dosing back from multiple choice. The
  strict component-level distractor check is therefore not built, and the structured components
  are not what makes the quiz safe -- the two string guards above are.

  **Direction is mixed by default, decided per question.** Recognising a mechanism when shown the
  drug and naming the drug when shown the mechanism are two different recalls, and a paper that
  only ever asks one way quietly trains one of them. It is a quiz-only setting: a flashcard's
  schedule keys a card by its direction, so a card whose direction changed every session would look
  like a new card every session. Measured on a real 40-question paper: 26 one way, 15 the other.

  The question count starts at everything the current filters can ask -- 236 on mechanism alone,
  472 on mechanism plus dosing, 4 on the statins -- rather than at an arbitrary twenty, for the same
  reason the flashcard cap does: the control should show what is there, and lowering it should be an
  obvious move rather than a discovered feature.

  Feedback is immediate, because this is studying: being told at the end that question 9 of 40 was
  wrong teaches less than being told while the drug is still in your head. The paper is fixed when
  the page renders, and the whole attempt is written once at the finish -- `quiz_answers` stores
  the options *as shown* rather than recomputing them, since a review screen that re-rolled them
  would show a question nobody sat.
- **Color coding is per user**, editable, not a fixed palette.
- **Admin** gets full site and user management.

Assumption, not blocking: "Top Drug Year" is a tag with a `kind` discriminator, so *Top 200 — 2024*
(list edition) and *P1 / Pharmacology I* (school year/course) both work and filter independently.

Greenfield — directory is empty apart from the photo, not a git repo.

---

## Drug data sourcing

### The class sheet (primary source)

`2026 - top-drugs-master-doc-blackboard-posting.pdf` — 23 pages, one ruled table, revision 4/28/2026.
Extracted by `scripts/extract-top-drugs.py` into `data/top-drugs-2026.json`: **237 drugs**.

The PDF is reissued per edition, so extraction is a one-shot tool re-run annually, not app runtime.
It stays in Python (pdfplumber) because the work is column geometry, not application logic — porting
it to TypeScript would buy nothing. Committing the JSON output is what the app actually consumes.

| Column | Years responsible | Fill rate |
|---|---|---|
| Generic | P1 P2 P3 | 100% |
| Brand | P1 P2 P3 | 100% |
| Indication | P1 P2 P3 | 100% |
| Dosing | P2 P3 | 100% |
| Controlled | P2 P3 | 10% (24 scheduled; blank = not controlled) |
| Mechanism of Action | P3 | 100% |
| Black Box Warning | P3 | 38% (blank = no warning exists) |

Extraction notes, all handled in the script:

- The grid is constant at `[36,153,230,302,408,455,604,758]`. Some pages sub-split the Generic column
  (route variants) or the Black Box column (floating text boxes), so the canonical grid is forced
  rather than detected per page.
- The embedded font leaves U+2019 and U+2013 unmapped; both arrive as U+FFFD. Position disambiguates
  them — between letters an apostrophe (*Parkinson's*), space-padded an en dash (*Capsule – 50 mg*).
- Cells hold either multiple values (*Proventil / Ventolin / Proair*) or one wrapped value
  (*Acetaminophen / overdose*). A line opening lowercase continues the previous one.
- Rows without a generic name are page-break continuations or route variants of the drug above.

**Two fields on the sticky note are absent from the sheet: Drug Class and Adverse Effects.**

### Drug class — resolved via RxNorm (done)

`scripts/fetch-drug-classes.py` → `data/drug-classes-rxnorm.json`. All **237 resolved**, 0 failures.

The class used is the FDA **Established Pharmacologic Class (EPC)**, because it reads the way a
pharmacy course does — *HMG-CoA Reductase Inhibitor*, *Proton Pump Inhibitor*, *Angiotensin
Converting Enzyme Inhibitor* — rather than in database register. **217 of 237 (92%)** have one. ATC,
MoA, and VA classes are captured alongside as candidates but are not promoted automatically: ATC
classifies by *product*, so it mislabels topiramate as an anti-obesity drug via its
phentermine/topiramate combination sibling. The remaining **20 show as *Uncategorized*** rather than
being guessed at from a second vocabulary — see [open item 1](#open-items).

This is the one bulk lookup the project allows, and the justification is narrow: a class is a fact
to be looked up, not prose to be written.

**Candidates are ranked against the drug's own indication.** RxNorm returns them alphabetically,
which buries the right answer — topiramate's ATC list leads with *Centrally acting antiobesity
products* (true of the phentermine/topiramate combination product) ahead of *Other antiepileptics*,
though the sheet indicates it for seizure. `build-seed.py` scores each candidate against the
indication through a curated pharmacologic map, weighting a mapped match above incidental word
overlap. That ordering matters: unweighted, methenamine's *Urinary tract infection prevention*
pulled *ANTISPASMODICS,URINARY,OTHER* level with the correct *Other antibacterials* on the bare word
"urinary".

This produces a **hint, never an assignment** — 16 of the 20 get one; `drug_class` stays null and
the drug shows as *Uncategorized* either way. The remaining 4 (buspirone, chlorhexidine,
phytonadione, potassium chloride) have no defensible hint and are left blank rather than guessed.

**A combination product's own classes are routinely incomplete, and the half they name is not
always the half that matters.** RxClass gave Piperacillin/Tazobactam only *beta Lactamase
Inhibitor* — the adjuvant, with the antibacterial missing — and Lisinopril/Hydrochlorothiazide only
*Thiazide Diuretic*, losing the ACE inhibitor. `resolve()` consulted a combination's ingredients
only when the product returned *nothing at all*, so three drugs were confidently classed as their
own adjuvant and Amoxicillin/Clavulanate sat in the review queue even though plain amoxicillin
resolves fine. Ampicillin/Sulbactam happening to return both is what made the gap easy to miss.
Ingredients are now always consulted and unioned, with three rules behind the primary class:

- **Ingredient order is the product's own order**, and the first leads. Sorting the union
  alphabetically instead made Codeine/Guaifenesin an *Expectorant* and Dipyridamole/Aspirin an
  *NSAID*, each naming the adjunct over the point of the drug.
- **Salts are stripped from ingredients** as well as forms, because a class belongs to the active
  moiety: "Codeine phosphate" resolves cleanly and carries no EPC of its own.
- **An adjuvant never leads** (`ADJUVANT_CLASSES`), whatever the naming order. Carbidopa is named
  first and is only there to protect levodopa, so order alone would have classed Sinemet as a
  decarboxylase inhibitor — telling a student its purpose is the opposite of what it is.

Seven classes changed, none was lost, and Sacubitril/Valsartan remains a known limit: sacubitril
has no EPC of its own, so the pair keeps only the ARB half.

Name resolution needed real work — the sheet appends route and release qualifiers (*Clonidine ER*,
*Fentanyl Transdermal Patch*), writes combinations three different ways (`/`, `with`, `and`), and
wraps mid-word in the generic column (*Hydrochlorothiazi de*). The resolver tries candidate
spellings and lets RxNorm confirm which is real, which is also how that extraction bug was caught.

Adverse effects come from elaboration and DailyMed.

### Micromedex — not programmatically accessible

A university library subscription is a human-reader license. Merative's terms prohibit systematic
automated retrieval, scraping through the library proxy risks both the personal account and the
school's institutional access, and redistributing monograph text to invited classmates is
republishing licensed content.

Micromedex does sell API/web-services entitlements for institutional integration, but that is a
separate contract from a library seat. One email to the librarian settles it: *"does our Micromedex
license include API or web-services access, and is there a sandbox?"* If that comes back yes, it
becomes legitimate and slots in as another lookup provider. **This plan assumes no.**

**Micromedex's legitimate role is reading it yourself**: look a drug up, write the fact into the
profile *in your own words*, record `Micromedex, accessed <date>` in that field's source note. Facts
aren't copyrightable; only expression is. That is ordinary studying with a citation trail, and the
per-field source note is where the trail lives.

### On-demand lookup providers

Used from the drug editor when adding or editing a card — never as a bulk import.

| Source | Licence | Gives us |
|---|---|---|
| **DailyMed** (NLM, SPL API) | Public domain | FDA labeling: indications, dosage/administration, adverse reactions, mechanism of action, controlled-substance schedule, boxed warnings |
| **RxNorm / RxNav** (NLM) | Public domain | Brand ↔ generic mapping, ingredient normalization, drug classes (ATC, VA, MeSH PE) |
| **openFDA** | Public domain | NDC directory, label search, adverse-event data if ever wanted |

All free, keyless or free-key, stable, US-government public domain.

**How the lookup panel behaves** — in the drug editor, a "Look up" action queries the providers for
the current drug and returns results grouped by provider and by which field they map to. Each result
is a suggestion with a **Use** button that writes it into *that one field*, stamped
`source: dailymed` (or `rxnorm`/`openfda`). Nothing is written without an
explicit click. Label prose is long, so each suggestion shows a trimmed preview with the full text
expandable, and the field stays editable after insertion — the normal workflow is pull, then
rewrite into exam-shaped language.

Brand↔generic and drug class from RxNorm are the exception worth trusting nearly as-is; MOA, dosing,
and adverse reactions from SPL labels always need hand-trimming.

### Accuracy guard

**Verification was removed on 2026-11-02.** It had been a four-state `verification_status` per field
(`unverified` / `verified` / `flagged` / `not_applicable`), with a verified-only study filter and an
importer that would not overwrite a verified value. The reasoning for dropping it: every value in
this database is put there by the owner, by me on their instruction, or by a script written for it.
There is no untrusted contributor, so "unverified" described nothing real while doing real damage --
it was a holding pen that could keep a drug out of a deck, and the one thing this app must not do is
quietly teach a shorter list than the one you asked for.

What is left is **one flag and the provenance that was always there**:

1. **Per-field `status`** — `ok`, `flagged`, or `none`.

   `flagged` means somebody thinks a value is wrong. It is a to-do, and it is *still studied*:
   withholding the card would shrink the deck without telling you, and a drug you cannot be asked
   about is worse than one you might be asked wrongly about.

   `none` is the sheet's own answer and the reason this is three states rather than a boolean: 62%
   of drugs have no black box warning and 90% are not controlled. Those blanks are *answers*, not
   gaps. Without the distinction the browse list would show 146 phantom missing warnings, and a
   flashcard would ask for a black box warning that does not exist.
2. **Per-field `source` and `updatedBy`** — where it came from and who wrote it, which is what
   `verified` was reaching for and says more. `updatedBy` is also now load-bearing: it is how the
   importer knows to leave a value alone (below).

Nothing is withheld from a deck any more. The brand↔indication pairing flag
(`needs_pairing_review`) likewise warns on the profile rather than suppressing cards, and the
browse filter offers *flagged* / *has gaps* / *complete* in place of the four verification levels.

Footer disclaimer plus a first-login notice: not for clinical decision-making.

---

## Architecture

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js, App Router, TypeScript | Server components for data-heavy pages, one container for UI + API |
| Database | PostgreSQL 17 | Relational for users/tags/progress, JSONB + GIN for dynamic field values |
| ORM | Drizzle ORM + drizzle-kit | Typed schema, SQL migrations in the repo, run on container start |
| Auth | better-auth, email + password, DB sessions | Self-host friendly, no external IdP, pairs with a custom invite table |
| Styling | Tailwind + CSS custom properties | Theme and per-user palette both resolve to tokens, never hardcoded colors |
| Client search | Fuse.js over a prefetched compact index | A few hundred drugs ≈ 100 KB — instant fuzzy search, zero round-trips |
| Container | `docker compose`: `web` + `db` + volume | Reverse proxy (Caddy/Traefik/nginx) assumed already on the server — see [What deploying actually needs](#what-deploying-actually-needs-2026-11-04) |

```
Enkephalin/
  app/
    (auth)/login, /register
    drugs/                  # browse + [slug] profile
    study/flashcards/ , study/quiz/
    settings/               # theme, palette editor, field visibility
    admin/                  # users, invites, fields, tags, drugs, settings, audit
    api/
      lookup/               # server-side proxy to DailyMed / RxNorm / openFDA
  db/schema.ts , db/migrations/ , db/seed.ts
  content/drugs/*.md        # authored profiles, frontmatter + body
  data/
    top-drugs-2026.json     # raw extraction of the class sheet (237 drugs)
    drug-classes-rxnorm.json# RxNorm/RxClass resolution + class candidates
    drugs-seed.json         # the two merged into the app's seed shape
  scripts/
    extract-top-drugs.py    # class-sheet PDF -> top-drugs-<year>.json   (annual)
    fetch-drug-classes.py   # RxNorm/RxClass -> drug-classes-rxnorm.json (annual)
    build-seed.py           # merge the two -> drugs-seed.json
    sync-content.ts         # seed + content -> database upsert
  lib/
    fields/                 # field registry, hot-column sync, card_key hashing
    lookup/                 # provider adapters + field mapping + response normalization
    quiz/                   # question + distractor generation
    srs/                    # scheduling
    color/                  # palette resolution + contrast checks
  Dockerfile , docker-compose.yml
```

Lookup calls go through `app/api/lookup/` rather than the browser so the providers see one
server-side caller, responses can be cached, and no third-party request is made from a student's
browser.

---

## Data model

The central structural decision: **fields are rows, not columns.**

```
field_defs        id, key, label, group, data_type (text|markdown|enum|list|number|bool),
                  enum_options jsonb, sort_order, is_core, is_quizzable,
                  prompt_template, help_text, default_visible,
                  year_levels text[],      -- ['P1','P2','P3'] — who is responsible for this field
                  blank_means_none bool,   -- blank is an answer (bbw, controlled), not a gap
                  lookup_mapping jsonb     -- which provider paths can fill this field

drugs             id, slug, generic_name, brand_names[], drug_class, schedule,   -- hot columns
                  fields jsonb,            -- { "moa": {...}, "half_life": {...} }  GIN-indexed
                  created_at, updated_at
```

Each entry in `drugs.fields` is `{ value, status, source, updated_at, updated_by }` — where
per-field provenance and citations live.

Hot columns are duplicated out of the JSONB deliberately: `drug_class` and `schedule` drive
same-class distractor generation, filtering, and color coding, and those queries should not dig
through JSONB. `lib/fields/` keeps the two in sync on write, so there is still one source of truth
per value.

`field_defs.lookup_mapping` is what lets the lookup panel know that the `moa` field can be filled
from the SPL `mechanism_of_action` section, and `drug_class` from an RxNorm class relation — so
newly added fields can declare their own lookup sources without code changes.

### Brands and indications are entities, not string arrays

The sheet stores brands and indications as parallel lists, which silently loses which brand treats
which condition. Tirzepatide is listed as **Mounjaro + Zepbound** against *Diabetes / Obstructive
sleep apnea / Weight management* — but Mounjaro is the diabetes brand and Zepbound the
weight-management one. Semaglutide is the same shape (Ozempic vs Wegovy). A Brand→Indication card
built from flat lists would teach the wrong pair, confidently.

```
indications       id, slug, label
drug_indications  id, drug_id, indication_id, sort_order   -- unique (drug, indication)
drug_brands       id, drug_id, name, route, form, dosing_override, sort_order, note
brand_indications brand_id, indication_id                  -- -> drug_indications.id
```

**The default costs nothing.** A brand with no `brand_indications` rows covers *all* of its drug's
indications — true for the common case (Proventil / Ventolin / Proair are all albuterol, all for
asthma) and avoiding 237 × N rows of busywork. Links are written only where a brand is actually
narrower.

**The sheet's asterisk is not the mechanism.** It appears to pair a brand with a specific indication
(*Sarafem\** ↔ *Premenstrual dysphoria disorder\**), but it is unreliable: tirzepatide has exactly
this split with no asterisk at all, and *Adcirca\** points at an indication the sheet never lists. So
the asterisk only ever seeds a **suggestion** (2 drugs), while any drug with competing brands *and*
multiple indications is flagged for human pairing regardless.

### An indication is a row, shared between drugs (2026-11-02)

It was free text per drug until migration 0005, and the trouble was never storage. "Hypertension"
existed sixteen times as sixteen unrelated strings, so there was no such thing as *the* indication
to rename; a typo forked a new study filter silently -- typing `Panic disorderr` in the editor
really did create a 93rd filter entry holding one drug, tested live and reverted; and the filter
only held together because `lib/drugs/indications.ts` ran the same slug function at both ends and
the two happened to agree.

As rows: 92 entries over 249 links, one of each, with the slug stored rather than derived. The
study scope carries that slug, the picker lists those rows, and the deck builder reads the same
column -- so a link cannot select drugs the picker did not offer. `drug_indications` keeps its own
id, which is what `brand_indications` points at, so the 24 brand pairings survived the migration
untouched and a brand stays paired to *this drug's* indication rather than to the word in the
abstract.

**Every writer goes through `resolveIndications`** (`lib/drugs/indication-store.ts`), which matches
on slug and creates only what is genuinely new: the importer, the drug editor, and a restore from
backup. Backups still carry wording rather than ids, so a dump stays readable and restores into a
database whose rows are different objects. The editor says which lines join an existing indication
and which would add one -- a typo is now visible before saving rather than discovered in a filter
list weeks later.

**`/admin/indications` is the repair bench**, and does the two things free text could not: rename
one everywhere at once (the slug stays, so saved study links keep working), and merge a
near-duplicate into the one you meant, moving its drugs. Both are audited. Deleting is only
offered for an indication no drug carries; one in use is a merge, not a delete, so nothing can be
silently dropped off a drug.

**The alias table did not go away.** `lib/drugs/indications.ts` still folds the sheet's own two
spellings (`Seizure` -> `Seizures`, `Bacterial infection` -> `Bacterial infections`, `BPH` ->
the expansion) on the way in, because a re-import would otherwise put the old spelling back as a
second row. Judgement calls are still refused there -- `Chronic pain` is not `Pain` -- and the
merge screen is where a person makes that call instead. `npm run seed` now reports new *wordings*
separately from new links, so a sheet that invents a second spelling says so.

### Route is recorded; per-route and per-population detail is not, yet

Every drug carries a `route` field, read only from evidence already in the row: a route stated in
the name (`Diclofenac (topical)`, `Methylprednisolone sodium succinate (parenteral)`) wins over the
dosing text, and failing that the dosing text is read for "by mouth", "subQ", "IV/IM", "puffs",
"into the conjunctival sac" and the rest. 218 of 236 came out of the import that way; the other 18
stay blank and sit in the "still blank" worklist.

Those 18 are the point of the rule. An infusion written as `0.05-0.15 mcg/kg/minute` is obviously
intravenous to a pharmacist, and insulin glargine is obviously subcutaneous — but neither text says
so, and a study aid that quietly fills in what it merely assumes is how you end up revising
something confidently wrong. The same refusal governs drug class and brand pairing.

**The subsystem this leads to.** Dosing and adverse effects vary by route and by population:
paediatric against adult, and oral against IV for the same generic. The model already has the
shape for it — `drug_brands.dosing_override` carries per-brand dosing today, which is how
sildenafil keeps 20 mg three times a day on Revatio and 50 mg before activity on Viagra — but
there is no place yet for "amoxicillin, paediatric, oral" as distinct from "amoxicillin, adult,
oral".

When it is built, these hold:

1. **The top-drugs listing is the standard.** What the sheet says is the drug's primary answer,
   and that is what a card asks by default. Variants are secondary: additions hanging off the
   standard, never replacements for it, or the study set silently changes under you.
2. **A variant carries its own axes** — route, population, and perhaps indication — and its own
   provenance, since "paediatric IV dosing" is a different claim needing its own source.
3. **Study config chooses whether variants are in scope.** Default off: a P1 revising the top
   drugs list should not be asked paediatric IV dosing because a variant exists.
4. **Nothing is generated from a variant that is not confirmed**, the same rule that suppresses
   brand→indication cards while a pairing is unreviewed.

Estradiol is the case already waiting: the sheet gives it three routes and "product dependent"
dosing across two families of products, which the importer deliberately refuses to turn into
brand rows.

**The sheet lists some generics twice.** Sildenafil appears on two rows — Revatio for pulmonary
hypertension at 20 mg three times a day, and Viagra for erectile dysfunction at 50 mg before
activity — both slugged `sildenafil`. The importer folds them into one drug and links each brand
to the indications from its own row, with that row's dosing on `drug_brands.dosing_override`. No
guessing is involved: the sheet pairs them by putting them on separate rows. Imported naively the
second row wins and both brands cover both indications, so the app teaches Viagra for pulmonary
hypertension. The extractor numbers ids per row, so both rows reuse `sildenafil--ind-0`; the merge
re-keys them per row or the collision silently recreates the same wrong pairing.

**Brand families decide what "competing" means.** *Wellbutrin / Wellbutrin SR / Wellbutrin XL* is one
brand in three release forms; *Zyban* is a different brand. 23 of the 73 multi-brand drugs collapse
this way, and collapsing them cuts the pairing review from 7 drugs to **5** — Depakote/Depakote ER
and Lamictal ×4 are single-brand drugs whose "covers all" default was never in question. The true
fans are albuterol, bupropion, digoxin, fluoxetine, and tirzepatide.

**The default degrades once a sibling is narrowed.** As soon as any brand on a drug gets explicit
links, the remaining brands' implicit "covers all" stops being safe: fluoxetine ends up with
Sarafem → PMDD explicit while Prozac silently still claims PMDD. Those siblings are marked
`default_pairing_suspect` with the reason attached, and the drug editor warns on them inline rather
than letting a wrong pairing look deliberate. Four brands are currently flagged — Prozac and the
three Wellbutrins. The warning is a prompt to confirm, not an error; confirming clears it.

### Direction decides what counts as correct

The generic is the root of a fan: brands hang off it, indications hang off it, and some brands
attach to only some indications. Whether an answer is acceptable depends on which way the question
traverses that fan.

**The rule: a question may use the union only when one endpoint is the generic. A question that both
starts and ends below the generic must stay inside one branch.**

| Direction | Acceptable answer | Tirzepatide example |
|---|---|---|
| Generic → brands | **all** brands | *Mounjaro, Zepbound* |
| Generic → indications | **all** indications | *Diabetes, OSA, Weight management* |
| Brand → generic | the one generic | *Mounjaro → tirzepatide* |
| Indication → generic | the one generic | *OSA → tirzepatide* |
| Brand → indication | **only that brand's branch** | *Mounjaro → Diabetes* (never Weight management) |
| Indication → brand | **only brands on that branch** | *Weight management → Zepbound* |
| Brand → brand | **never interchangeable** | *Mounjaro ≠ Zepbound* |

Going down from the root is lossy but safe — every child is genuinely a correct answer for the
parent. Crossing between branches without passing through the root is what produces a false pair.

Three consequences for `lib/quiz/`, all correctness rather than polish:

1. **Distractors are drawn from the complement of the acceptable set, not merely "a different
   drug".** This is the likeliest silent bug in the whole quiz engine: asking for *an* indication of
   tirzepatide with "Diabetes" keyed correct, while "Weight management" sits in the options as a
   distractor, produces a question with two right answers and marks one of them wrong. The
   acceptable set is computed first; options are sampled from outside it.
2. **Brand families collapse before distractor sampling.** *Which bupropion brand treats smoking
   cessation?* offering Wellbutrin / Wellbutrin SR / Wellbutrin XL / Zyban gives itself away — three
   options are one brand. Sampling takes one brand per `family`.
3. **A `default_pairing_suspect` brand generates no Brand→Indication card at all** until confirmed.
   Teaching "Prozac treats PMDD" off an unreviewed default is worse than asking nothing; the card
   appears once a human affirms the link.

Flashcards, being self-graded, can simply *show* the full acceptable set on reveal and let you judge
— the exclusivity problem is specific to multiple choice.

Route and form variants (Estradiol oral / topical / vaginal) are the same fan shape on a different
axis: brands attach to routes rather than indications, and the identical rule applies.

```
tags              id, slug, label, kind (top_list|school_year|course|system|custom),
                  default_color_token, sort_order
drug_tags         drug_id, tag_id

users             (better-auth) + role (student|admin), status (active|disabled)
sessions          (better-auth)
invites           code, created_by, used_by, expires_at, max_uses, uses, note

user_preferences  user_id, theme (light|dark|system),
                  color_axis (class|schedule|tag|none),
                  palette_overrides jsonb,     -- { "class:beta-blocker": "#1f6feb", ... }
                  field_visibility jsonb,      -- which fields show on profiles, and order
                  study_defaults jsonb         -- last-used field set + mode

study_cards       user_id, drug_id, card_key,      -- card_key encodes field set + direction
                  ease, interval_days, due_at, last_result, review_count
quiz_attempts     user_id, started_at, finished_at, config jsonb, score, total
quiz_answers      attempt_id, drug_id, question_key, prompt jsonb, choices jsonb,
                  chosen_index, correct_index, was_correct

lookup_cache      provider, query_key, response jsonb, fetched_at
audit_log         actor_id, action, target_type, target_id, diff jsonb, at
site_settings     singleton: site_name, registration_mode, default_theme,
                  disclaimer_text, default_palette jsonb
```

Adding a field later = one row in `field_defs` via the admin UI. No migration, no deploy.

---

### Colour is cosmetic, and nothing studied may depend on it (2026-11-02)

A standing rule, stated by the owner and now enforced by
`tests/colour-is-cosmetic.test.ts`: **no question is ever based on the palette or on a class's
colour.**

The reason is that a palette is a per-user preference. One person's CIV is red and another's is
green, and either of them can change it in Settings. A question whose answer depended on a colour
would have a different answer for each reader, and could be got right by editing a setting rather
than by learning anything.

The subtler half is the **hint**. Nobody would write "which of these is the blue one", but
colour-coding the four options of a multiple-choice question would do it by accident: the right
answer becomes the option whose colour matches the drug in the prompt, and the paper is answerable
without being read. So the ban covers the study *pages*, not only the question builder — a cue is
as fatal as a premise.

It was already true when the rule was stated: nothing under `lib/study/` or `lib/fields/` mentions
colour, the palette has seven consumers and all of them are browse, profile or settings, and
`drug_class` has been `isQuizzable: false` since the field was defined — it earns its place by
driving colour, the browse filter and same-class distractor sampling, not by being asked.

The test reads the source of `lib/study/**` and `app/study/**` and fails on any import from
`lib/theme/`, because the failure it guards against is silent: a quiz with a colour cue still
scores, still saves and still looks exactly right. It was checked by planting
`import { colorFor } from '@/lib/theme/palette'` in `lib/study/quiz.ts` and confirming the suite
went red naming that file — a guard that cannot fail is decoration. It also asserts the asked-field
set excludes `drug_class` in the database *and* in `CORE_FIELD_DEFS`, so a hand-edited row cannot
quietly make the class askable.

### One colour per value, and 3:1 not 4.5:1 (2026-11-02)

Phase 7 landed, and two things in the feature description above turned out to be wrong once
measured.

**A categorical colour is one value, not a light/dark pair.** The chrome tokens in `globals.css`
are defined twice because a page background has to be. A class or schedule colour is not that: the
question is "what colour is CIV", and an answer that differed by theme would be two answers to one
question. So those colours left CSS entirely and live in `lib/theme/palette.ts`, resolved per
request, which is also what lets the editor show the colour the page will actually draw.

**The 4.5:1 warning in the feature list is unreachable, and was the wrong threshold anyway.**
Measured against both page surfaces, the best of the eight class colours this replaces managed
4.6:1 on white and 3.9:1 on the dark surface; three of the eight fell below 3:1 on dark, and every
dark-mode value failed on white, the worst at 1.6:1. The arithmetic is against it: clearing 4.5 on
white means being dark, which is exactly what disappears on a dark ground.

4.5:1 is the threshold for *text*, and these are fills. So:

- the **fill** is checked at 3:1 against both surfaces (WCAG 1.4.11, non-text contrast), and the
  default ramps were rechosen from the band that clears it in both themes — a test asserts every
  default passes its own check, because a default that failed would make the warning noise;
- the **text on the fill** is computed, not chosen: `readableTextOn` picks black or white, whichever
  wins, which lands between 4.6:1 and 13.4:1 for every colour in the ramps. The promise that colour
  is never the only signal is kept by construction rather than by hoping someone picks well.

The editor **warns and allows**. Nothing becomes unreadable by picking badly — the label on the
badge stays legible either way — so forbidding a colour would be refusing someone their own
preference over a taste they are entitled to.

**Shuffle all** deals a fresh colour to everything on the axis. Three things it is not: it is not
random per entry (independent draws cluster — over a hundred classes you get six near-identical
greens and a gap where orange should be — so it divides the hue wheel evenly, rotates it somewhere
random and deals it out shuffled); it is not a way round the contrast check (every hue is resolved
through `readableOnHue`, and a test asserts all 119 outputs pass the same check the editor enforces
by hand); and it is not offered on the **schedule** axis, hidden in the UI and refused in the
action, because that ramp is ordinal — shuffling CII through CV would throw away the one piece of
meaning colour carries in this app. Writes are scoped by key prefix, so shuffling classes leaves a
schedule colour someone chose deliberately alone, and *Reset every colour* undoes it.

The readable band is not the same width at every hue, which is why the search varies saturation as
well as lightness: measured across the wheel, yellow near 60 degrees only clears 3:1 on both
grounds at a lower saturation and a darker lightness than blue does. A single fixed lightness would
have handed out a yellow nobody can see on white.

**The axis owns colour, so a page means one thing by it.** The schedule badge is filled only when
schedule *is* the axis; otherwise it is neutral text and the colour on the page means whatever
Settings says. Browse grew a dot rather than a fill, because a class name does not fit in a row.

Two things to know about the edges:

- Overrides are keyed by **label** (`class:Angiotensin Converting Enzyme Inhibitor`), because
  `drugs.drug_class` is a text column with no id. A class renamed by a future RxNorm pass orphans
  its colour, which then sits in `palette_overrides` doing nothing. Harmless, and *Reset every
  colour* clears it; pruning unknown keys automatically would throw away a colour for a class that
  is only temporarily absent, mid-import.
- The swatch list is read from the drugs rather than stored, so it cannot list a colour for a class
  nobody carries. That caught a wrong key during verification within a minute.

### Where it did not fit (2026-11-02)

The responsive pass. Five real faults, none of them a matter of taste:

- **The site header did not wrap at all.** `flex` with no `flex-wrap`, holding the wordmark, four
  links, the email and Sign out. On a phone that does not shrink, it overflows the page sideways.
  This had been there since phase 1.
- **The drug list's class column was `auto`,** which in a grid means max-content — so *Herpes
  Simplex Virus Nucleoside Analog DNA Polymerase Inhibitor* took the width it wanted and crushed
  the brands beside it, with 16px between them. Every track is `minmax(0, ...)` now, the class
  column capped so it wraps to a second line instead, and the three-column layout starts at `md`
  rather than `sm` — at 640px three columns in 600px was the cramped case.
- **The flashcard grade buttons never wrapped.** `flex-1` sets a zero basis, so four buttons
  squeezed onto one line and *Again* wrapped inside a 54px button. `min-w-32` makes them wrap
  instead: two rows of two on a phone, one row of four from `sm`.
- **Both runners used `p-6` on a phone**, spending 48 of ~368px on padding inside a card whose job
  is to hold a question. `p-4 sm:p-6`.
- **A quiz option's text had no `min-w-0`,** so one long option could widen the whole button past
  the card — a flex child will not shrink below its content without it.

Two rows that held several things with no wrap were fixed too (the drug editor's action row, the
admin soft-deleted fields list). Checkbox labels were deliberately left un-wrapped: the box should
never wrap away from its words, and the words wrap inside the span already.

What is *not* claimed: none of this was measured in a browser. The column widths are reasoned from
the space actually available — the list gets about 720px at `lg` once the 15rem filter rail and the
8-gap are taken out of `max-w-5xl` — and the compiled CSS was checked for every new utility, since
an arbitrary Tailwind value that fails to compile leaves a grid silently one-column. A real check
at phone width is still worth doing by eye.

### Two colours that do not defer to the axis (2026-11-02)

The rule had been that colour means whatever the reader picked in Settings, and everything else goes
neutral. Two exceptions now, both asked for:

**The controlled-substance badge is always its schedule's colour.** CI through CV is not a way of
*looking* at a drug, it is a fact about handling one, and the badge is the only place it appears --
so deferring to the axis meant the one colour with a legal meaning turned grey whenever someone
chose to colour by class. `scheduleBadge()` in `lib/theme/palette.ts` is the single rule; the list,
the profile and the Settings preview all call it rather than each carrying their own condition, and
it reads the `schedule:` overrides on every axis so the editor still governs which red. The axis
still owns the dot beside a name, so nothing was lost.

**The flashcard grade buttons are a red-to-green ramp**, `--grade-1..4` in `app/globals.css`. Two
decisions worth keeping:

- They are *stepped by position in the row on screen*, not by grade name, so both scales read red to
  green end to end -- four buttons take all four steps, the binary pair takes the ends. "Good" is
  therefore the green end on the binary scale and the third step on the four-point one, which is
  correct either way: the colour says how far along the row you are.
- The ramp lives in CSS, not in `lib/theme/palette.ts`, because the study pages may not import the
  palette at all -- see [Colour is cosmetic](#colour-is-cosmetic-and-nothing-studied-may-depend-on-it-2026-11-02).
  These four are chrome, like `--verified` and `--flagged`, and they stand for an action you are
  taking rather than a fact about a drug.

The light ramp is the 800-series where the existing markers use 700s: a step tints its own button
background, and the lighter values only reached 4.2:1 against that tint. At 20% fill the text clears
5.2:1 in both themes and the 70% border clears the 3:1 that WCAG 1.4.11 asks of a control's edge --
where the app's plain `--border` manages 1.27, which is worth knowing about the rest of the chrome.

Two things the build taught, both now held by `tests/grade-scale.test.ts`:

- **`color-mix` gets a fallback, and the generated one was broken.** Left alone, the compiler emits
  `background: var(--grade)` for a browser without `color-mix` -- a full-strength fill under
  same-coloured text, an invisible label. The base rule states `background: transparent` so it
  degrades to an outlined button instead.
- **The dark values are written twice** in `globals.css`, once for the system preference and once
  for an explicit choice, and nothing but a test stops them drifting. A drift would show only to
  whichever half of the users hit the other code path. The test compares the two blocks token for
  token -- all of them, not just the ramp -- and was confirmed to fail on a single changed hex digit.

**And the quiz says which answer was which in colour** (2026-11-02). `--flagged` and `--verified`
began as thin markers -- a border and a one-word tag -- and are now set as body text: the answer you
gave, the answer that was right, and both halves of the pair your wrong answer actually belongs to
(*Mechanism of action of Simvastatin: HMG-CoA reductase inhibition*). The connective words stay
muted, because what is being pointed at is the drug and the fact, not "is the" or "of". Worst case
of the four ink-on-ground combinations is 5.55:1, held by a test now that these are text rather than
markers, and the words "Correct:" and "Your answer:" still carry the meaning on their own -- colour
is confirmation here, not the message.

Not verified by eye: the painted buttons. They render only after a card is revealed, which is client
state, so what was checked is that the container serves the class and all eight token values, that
the runner asks for all four, and the arithmetic of the step mapping.

### The test runner stopped finding tests (2026-11-02)

`npm test` began reporting **"No test files found"** plus a `code.charCodeAt is not a function`
TypeError from vitest's own error printer — on a tree whose 422 tests had passed twenty minutes
earlier. `tests/test-db.mjs` already carried a note about that exact pair of symptoms, which is
what made it findable: in this project they mean *something in the global-setup graph failed and
vitest destroyed the message while printing it*.

What it actually was, found by tracing each step of the setup into a file (nothing else survives a
crashing printer): `migrate()` from `drizzle-orm/postgres-js/migrator` returns a promise that never
settles when it runs inside vitest's global setup, where Vite's module runner has transformed
`postgres`. Under tsx the same call has always worked, which is why `scripts/` never hit it. Vitest
then ran teardown and exited 1 with nothing printed.

Two things worth keeping from the hunt:

- **The decisive experiment was `git stash`.** The failure looked like it arrived with the files I
  was writing. Running the last commit's tree — 422 tests green less than an hour before — failed
  identically, which ruled out everything I had touched in one command. It should have been the
  *first* thing tried, not the tenth.
- **A trace proved more than a hypothesis.** Three plausible causes (a corrupt transform cache, the
  `.ts`-via-config loader path that caused the earlier incident, a docker port race) were each
  tested and each wrong. Writing `entered / removed old / container up / ready / migrated` to a file
  and seeing it stop after `ready` cost one run and named the line.

The fix: `tests/migrate-test-db.mts` does the migration in its own process under tsx, and
`tests/global-setup.ts` keeps itself to node builtins and shells out to it. Verified by three
consecutive full runs.

### One set of palette rules, two rows to write them to (2026-11-02)

Phase 7's last piece: `/admin/look`, where an admin sets the theme and colours everyone gets before
they choose anything. Three decisions in it.

**The editing rules are a third module now.** `lib/theme/overrides.ts` holds `withColor` and
`withAxisColors` as plain functions over a map — what a key is, what a blank means, which axis a
batch may touch — and both `user_preferences` and `site_settings.default_palette` are those
functions over a different row. Writing the site half as a copy of the user half would have been two
answers to "is `class:a:b` a key", and the pair would have drifted the first time either changed.
`PaletteEditor` already took its three actions as props, so the UI needed no change at all.

**Separate actions rather than one taking a scope.** `app/admin/look/actions.ts` is the per-user
action with `requireAdmin` in place of `requireUser`. A scope that arrives in a form is a scope a
request can claim, and "write the site default" should not be reachable by adding a field to a POST.

**Every axis is editable here, and the axis lives in the URL.** On `/settings` you edit the axis you
chose to look at, which is right for a reader. The site default is not a reader's choice, so an
admin setting the schedule ramp should not have to switch their own view to the schedule axis first.

The trap the page had to name: an admin with their own colours — this one has 119 — edits the
default, looks at `/drugs`, and sees nothing move, because their own entries layer over the site's
key by key. The page counts them and says so, with a link to clear them. Found by looking at the
rendered preview and noticing it showed the built-in ramp while `/drugs` showed the shuffle, which
is the correct behaviour for both and reads as a bug if nothing explains it.

No site default colour *axis*, deliberately: `sitePreferences()` answers `class` and nothing has
ever needed otherwise. A migration for a setting with one plausible value is a migration spent on a
question nobody asked.

### A lookup you cannot reach mid-question (2026-11-02)

A panel on both runners that shows a drug without leaving the session, **shut while a quiz question
is unanswered or a flashcard unflipped** — the owner's condition, and the right one: a question you
have not answered is a retrieval attempt in progress, and looking the answer up there turns the one
moment that teaches something into reading.

Disabled rather than hidden, and the button says what has to happen first (*Answer first, then look
it up* / *Flip it first, then look it up*). Knowing the panel is there is most of the value of it
being there; a trigger that silently appears later is a feature nobody finds.

Three things it had to get right beyond that:

- **Nothing revalidates.** A study page is `force-dynamic` and randomised, so `revalidatePath` on
  one re-renders a *different* paper under a live session — the "0 of 83" bug. A lookup must not be
  able to change the question, so both actions are plain reads and a test asserts the word does not
  appear in either file's code.
- **The runners' keyboards stand down.** Neither key handler checked where a keystroke was aimed,
  which never mattered because there was nothing to type into — and the moment there was, typing
  "2" into the search box would have answered the question. Both now ignore events from a text
  field, and ignore everything while the panel is open.
- **It closes itself when it stops being allowed.** Answering is not the only way out of a
  question: *Next* moves to the following one, where the panel has to shut without being touched.

**The way in is the drug's name** (revised 2026-11-02, same day). The panel first shipped with its
own *Look up a drug* button beside the runner, next to the new-tab links that had always been there.
That was two affordances for one act, and one of them cost you the session. Now every drug named in
a runner is the trigger — the question's drug, the drug a wrong answer actually belonged to, every
row of the summary, the flashcard's own drug — and there is no separate control. The search box
lives inside the panel, where looking up *something else* belongs: it is the rarer thing.

One panel per runner rather than one per link: the runner holds which drug is open, so a summary of
twelve missed questions is twelve buttons and one overlay, not twelve overlays. Every runner link
out to a new tab is gone, and a test asserts none comes back — the whole point was that a drug name
should not cost a paper.

That change closed a leak as well. The flashcard footer said *Open Morphine* whether or not the card
had been turned over, and on a fact-to-drug card the drug **is** the answer. It is gated now, like
everything else.

A trigger that is not allowed renders no control at all — the sentence saying what has to happen
first, not a disabled button. And the gate is stated on every trigger even where its position makes
it unreachable (the quiz's row only exists once the question is answered), so that moving a row
cannot quietly move the rule with it. A test walks every `LookupTrigger` and `LookupPanel` in both
runners and fails on any that is ungated or does not name a drug: the way this rule gets lost is not
somebody removing it, it is somebody adding a second way in and forgetting.

Searched on the server, unlike `/drugs`, which ships all 236 rows and searches them in the browser
— right for a page whose whole job is the list, wrong for a page already carrying a paper. And
"contains" rather than the fuzzy match `/drugs` uses: you reach for this knowing what you want, and
a fuzzy match that confidently returns the wrong drug mid-session is worse than no match. A brand
hit says which brand it was, because searching *Zocor* and being shown *Simvastatin* needs the
connection stated.

Checked live on the real data: `zocor` → Simvastatin (as Zocor), `xanax` → Alprazolam (as Xanax XR),
`ozempic` → Semaglutide, `%` → nothing, and Morphine's card carries its four fields in two groups
with the CII badge. Not clicked through in a browser: the trigger was verified `disabled` with its
reason in the served HTML of both runners, and the gate, the keyboard stand-down and the
no-revalidate rule are each held by a test.

### Two rows that should never have been two (2026-11-03)

Delete and merge, at the bottom of the drug editor, because that is where you are standing when you
notice a duplicate.

**A merge is not a delete with extra steps.** A drug is referenced by its brands, its indication
links, its list memberships, its dosing rows, every SRS schedule anyone holds for it and every quiz
answer anyone has given about it — all `on delete cascade`. That is right for a delete and wrong for
a merge: a merge says *these were always the same drug*, so the history belongs to the survivor.
Every quiz answer moves, because the quiz weights "ask me this again" from them and the question was
always about the same drug.

One rule for the content, stated once: **the survivor keeps everything it has; the loser fills gaps
and hands over what the survivor lacks entirely.** A per-field choice would be an editing session
wearing a merge's clothes. The exceptions are the three places a database constraint forces a
decision, and each is the same answer — keep the survivor's:

- a brand name the survivor already has is dropped, not duplicated (case-insensitively: *ZOCOR* is
  *Zocor*);
- a schedule colliding on (person, card key) keeps the survivor's, because that is the one the
  person has actually been answering against;
- dosing moves only into a drug with none. Half of one drug's regimens beside half of another's
  would read as one contradictory schedule.

**The subtle one was `brand_indications`.** It points at a `drug_indications` row rather than at the
vocabulary, so a brand that moves has to find its pairing already pointing at the *survivor's* link
row — otherwise the pairing is dangling or silently gone. Indications are therefore merged first,
re-pointing the loser's brand pairings before dropping its duplicate links. There is a test that
plants exactly that case, because nothing about the symptom would point at the cause.

**Delete is hard, not a `deleted_at` flag.** A soft-deleted drug would have to be filtered out of
browse, search, every study scope, the card builder and the quiz pool — six places where forgetting
one means a deleted drug quietly still being asked about. The safety net is `/admin/data`, which
exports the whole database as one file, and the audit entry carries what was destroyed, since the
row itself will not be there to say.

Both show what they will do before they will do it, from the same queries the write uses. The delete
copy points at merge whenever study history would go with it. An indication nothing else is for
stays in the vocabulary afterwards — deliberately, since it is shared — and `/admin/indications`
already lists unused ones.

Verified against the real database: previewing *Clonidine ER* into *Clonidine* reports Kapvay and
ADHD moving, one list moving and two already shared, and its dosing discarded because Clonidine has
its own. A full round trip on two throwaway drugs merged and deleted cleanly and left the count back
at 236 — including the vocabulary rows it orphaned, which is how that behaviour got noticed.

### A form action resets the form (2026-11-03)

Reported from the running app: picking a theme, a season or a colour axis in `/settings` and
saving **worked** -- the page came back wearing it -- and then the selects showed the old answer
again, so the form read as though the save had been ignored.

The cause is React, not this app's wiring, and it is deterministic rather than a race.
`startHostTransition` in react-dom calls `requestFormReset` on any `<form action={...}>` before
running the action, and the commit that follows calls the DOM's own `form.reset()`. For an
`<input>` React keeps `node.defaultValue` in step on re-render, so a reset lands on the new value
and nothing is visibly wrong. For a `<select>` it does not: the update path only reapplies
`defaultValue` when `multiple` has changed, so `reset()` restores whatever was selected **at
mount** and leaves it there. An uncontrolled select in a form action is therefore guaranteed to
snap back, which is exactly the three controls the owner was looking at.

**Making the controls controlled does not fix this, and the first attempt at it shipped broken.**
That was the obvious move and it is wrong for a reason worth writing down: `form.reset()` dispatches
no change event, so React's controlled-input machinery -- which only restores a value in response to
an event it intercepted -- never runs. And the reset changes nothing in state, so there is no
re-render to repaint the select from either. The DOM is left holding the mount-time selection with
React perfectly content. The owner reported it back still broken, which is the only reason it was
caught: no test could have failed, because the defect was in a behaviour no test here can run.

**The fix is to stop using `action`.** Both cosmetic forms --
`app/settings/look-form.tsx` and `app/admin/look/site-theme-form.tsx` -- now use `onSubmit` with
`preventDefault`, which never reaches `startHostTransition` and so never schedules a reset. The
controls stay controlled on top of that, because a displayed value held in state cannot disagree
with what was posted, and editing anything now retires the "Saved." line that used to stand over a
form which had since changed.

A source-scanning guard in `tests/theme-preferences.test.ts` holds both halves: no `action={` in
either file (comments stripped first, since both files discuss `<form action>` at length), an
`onSubmit` that calls `preventDefault`, no `defaultValue` or `defaultChecked`, and one
`value`/`checked` **and** one `onChange` per named control -- so a sixth switch added without
wiring fails in the suite rather than in somebody's settings. Confirmed on the running container:
the shipped `/settings` and `/admin/look` chunks contain one `onSubmit` and zero `action:`.

**Known, and not fixed here:** the same deterministic bug is in the two editors that keep a
`<select>` on a page they stay on after saving -- `/admin/fields/[id]` (`dataType`) and the drug
editor (`schedule`, plus each field's `status` and `source`). The drug editor is 500 lines of
mostly uncontrolled form and deserves its own pass rather than being swept into a cosmetics fix;
the cheap fix there is to stop using `<form action>` and call the action from `onSubmit`, which
skips the reset entirely and leaves every field uncontrolled.

### Four screenshots and what they cost (2026-11-04)

The owner sent four screenshots. Every item below is something that looked fine in the markup and
wrong on the screen, which is the argument for sending screenshots.

**A button is the page's ink, not the link colour.** Every filled button in the app was
`bg-[var(--accent)]`, and `--accent` is deliberately the one chrome token the seasons never move —
see *A season is not a theme*. That is right for a link inside a sentence and wrong for a lozenge:
on a tinted autumn page the whole interface goes warm and a cold blue *Again* sat in the middle of
it. A primary button is now `--fg` on `--bg`, **the reading pair inverted**. Both tokens are
already retinted per season, so the button takes the season with it with nothing per-season to keep
in step; and because it is the body text's own pair swapped over, its contrast is whatever the body
text's is, with no new figure to defend. `--accent` goes back to meaning exactly one thing: a link.
Two weights — `.btn-primary` and `.btn-quiet` — stated once in `globals.css` rather than as a
repeated string of utilities, so there is one place to argue with. 24 call sites swept; the only
accent fill left in `app/` is the avatar, which is an identity chip rather than a button.

**A link that reads as a button is a button.** *Another quiz* sat beside *Again* as underlined blue
text — same job, two shapes. It, and the deck's *Start another*, are `.btn-quiet` now.

**The plate is gone.** `main.open` gave the home page's column to the weather, and `.plate` was its
companion: a local repaint of the page ground behind the bare text, so no mote could cross a word.
The screenshot killed it. A plate repainted the *season* wash but not the ambience wash or the
starfield beneath it, so instead of being invisible it rendered as an opaque band behind the
greeting, behind *START ANOTHER*, and behind the disclaimer. **A rectangle you can see is worse
than a leaf you can.** The trade is now stated rather than engineered around: on that one page a
mote may pass behind a greeting, a two-word heading and a disclaimer, and every block there
carrying real reading is a card, which still paints `--surface`.

**Three statements of the brand name, down to one.** A profile said the brands in its header
(*Sold as Androgel*), again as a *Brands* section, and a third time as a *Brand names* row inside
an *Identity* group — a group whose every line the reader had already passed, since its other two
rows were the page's own `<h1>` and the class badge beside it. The header line went, and so did the
group: the page now skips `generic`, `brand` and `drug_class` as rows, and a group left with no
fields renders nothing rather than a heading over a gap. Keyed by field rather than by group name,
so a custom field filed under Identity later still appears.

**And the class got a section instead.** Dropping Identity took the only *labelled* statement of
the drug class with it — the badge in the header is a colour with a word in it, and on the `tag` or
`none` axis it is not even that. So the class says itself where Identity used to be, with the drugs
that share it: *Same class* had been a sidebar list of names under a heading that never said what
the class was. The two belong together.

**The lookup panel, the same argument.** It had a band of chips for the class and the schedule and
a *Sold as* sentence for the brands — three shapes for three facts, above a field list that states
facts one way. All of it is labelled rows now, the drug's own identity included. One thing came
back with it: **indications**, which the card has carried all along and the panel never printed.
They are held out of the field groups (a profile shows them per brand) and nothing picked them up
again, so the panel had been silently missing a quizzed field.

**The categories are gone.** 65 therapeutic category tags, written by `scripts/seed-categories.ts`
— a curated FDA-class → category map. The owner's verdict: not asked for, and diluting the thing
they meant to help. `scripts/prune-tags.ts` removed all 66 tags but *Top Drugs 2026*, writing what
it removed to `backups/` first, one audit row per tag. Nothing about a drug is harmed: `drug_tags`
cascades, and the 236 links to the one remaining list are untouched. Two consequences worth
knowing — a saved study setup scoped to a category stops matching, which is honest rather than
silently reinterpreted; and the quiz's near-miss distractor loses its *same category* fallback for
a drug whose class has no other member, which it already handles by reaching further afield. The
map stays in the repo, because one run brings all 65 and their links straight back, and arguing
with a table is easier than rebuilding one.

Guarded in `tests/chrome.test.ts` (16) and the plate's absence in `tests/seasons.test.ts`, each
proved to bite: the primary button back in link blue, a link-as-button keeping its underline,
*Another quiz* back to an underlined link, one new accent-filled button, the plate rule back in the
stylesheet, and a plated heading back on the home page.

### An answer that belongs to nine drugs (2026-11-04)

Reported by the owner: get a schedule question wrong and the review said *"CII" is the controlled
schedule of Methylphenidate* — one drug, when nine drugs in the sheet are CII.

It was not a display bug so much as a wrong idea about what an option *is*. Every option carries
the drug it was drawn from (`fromGeneric`), and for nearly every field that drug is the whole
answer: one mechanism, one dose, one class. The schedule is not like that. Which of the nine the
sentence named was whichever one the draw happened to reach for first — true, arbitrary, and
reading as though the other eight were not controlled at all.

So a question now carries **`fromOwners`: every drug each option is true of**, matched on the
answer *key* rather than on the text. That key is already the app's definition of "the same
answer" — it folds *Seizure* into *Seizures* through the alias table and compares a dose by its
printed sig — and it is the same comparison that keeps a shared value from ever being offered as a
wrong answer. Using it here means the list of owners and the list of answers that cannot be
distractors are the same list, derived once.

Measured on the running database:

| Field | Shape of the answer |
|---|---|
| Controlled schedule | **9 drugs** share CII, **11** share CIV, 3 share CV, 1 is CIII |
| Indication | *Bacterial infections* is the answer for **19** drugs |
| Dosing | 178 of 236 answers belong to one drug; **58** are shared |

Two places say it, because they are read at two different moments:

- **On the card, under the options**, the moment it is answered: *Also the controlled schedule of
  Oxycodone, Morphine, Methadone, Fentanyl Transdermal Patch and 4 others.* The asked drug is left
  out — it is named in the prompt — and the list caps at four, because nine names in a sentence is
  a list nobody reads and the *number* is the thing worth taking away: this answer does not
  distinguish.
- **In the review**, where a wrong answer is actually read back. The *Also right* line, which the
  card has always had, was missing there entirely: a fact-to-drug question whose clue was true of
  nine drugs looked in the summary as though one drug were the answer. Both lines are there now.

Every name in those lists is a button into the lookup panel, which is the point of naming them: the
distinction is learned by looking at the two drugs, not by reading that they differ.

Related: [Direction decides what counts as correct](#direction-decides-what-counts-as-correct),
whose fan rule is where "the same answer" comes from in the first place.

### The chrome the browser was drawing (2026-11-04)

A round of the owner's own notes, all of them about the parts of the interface that had been left at
their defaults — and which were therefore the only parts not taking part in the theme.

**The scrollbar.** Left to the browser it is a bar in the operating system's taste, which went
wrong twice: on a tinted season it was the only neutral rectangle on the page, and with dark chosen
in Settings on a light machine it was a *light* bar beside dark text — because `color-scheme: light
dark` hands that choice to the OS, which does not know what was picked. So `color-scheme` is now
narrowed to whichever theme is actually in force (which settles the form controls and the
overscroll gutter too), and the bar is drawn from a token: `--scroll-ink`, the chrome's own `--fg`
channels, at an alpha over a **transparent** track. Transparent is what makes it follow the
decorations with nothing per-season to keep in step — what shows through behind the thumb is the
page's own washed, tinted ground. `scrollbar-color` is inherited, so :root reaches every scrolling
element; the WebKit pseudo-elements are not, so they are on `*`. Written as `rgb(channels / alpha)`
rather than `color-mix`, for the reason the streak pill is: the minifier emits a solid-colour
fallback, and a solid thumb is a black bar on a white page.

**The current-page pill** was filled in `--accent`, which is the colour of a link in a sentence. As
a lozenge it was the one piece of the bar that ignored the rest of it — in a tinted autumn
everything goes warm and the pill saying where you are stayed cold blue. It is filled in `--border`
now, which is the token the seasons move *most*, and `--fg` on it measures 11:1 at worst across
both themes and all four tints. `aria-current` and the weight still carry it, so the colour is
confirmation rather than the message.

**The two smallest type steps, up one notch each** — 12px → 13px and 14px → 15px, line heights
moved to match. Nearly every sentence in this app is `text-sm` and nearly every provenance mark is
`text-xs`, so those two *were* the sizes most of the words were set in, and 12px is below what
anyone should have to read prose at. `text-base` is deliberately untouched: it is the question on a
quiz card and the body of a profile, it is already 16px, and every heading is scaled off it.

**The room above the question.** Title, settings summary, saved-setup bar and settings panel came
to about 140px before the first question — enough to push the fourth option of a four-option
question below the fold on a laptop. Before a session starts those each deserve a row; the moment a
paper is on screen they are reference material about something already decided. So while a session
runs the title shrinks to a label, the summary and the setups join it on that one line (the setup
bar grew a `compact` form), the panel keeps only its one-line summary, and the page padding halves.
Both study pages, same treatment.

**The disclaimer** was a full-width paragraph under a full-width rule, which gave the least
interesting sentence on the page the weight of a section heading. It needs to be *present* —
findable by anyone looking for it, ignorable by everyone who has read it once — so it is centred,
narrow and small at the foot of the page, marked off by eight pixels of hairline rather than a rule
drawn under the content above it. One component serving both the signed-in and signed-out halves,
still reading the admin's own wording out of site settings.

**The lookup panel and the drug profile**, restyled. Both were correct and flat: a column of
label-and-value rows with nothing saying which half was the answer. Now the label is the quiet half
(small caps, muted) and the value is set normally; sections draw their own card with a hairline
running out of the heading; and the panel holds its search row at the top and scrolls its body
instead of growing, because a drug with every field filled is taller than a laptop screen and a
dialog that pushes its own close button off the bottom is a trap.

**The brand name.** The owner asked for it to be more visible on a profile, and the honest fix was
that it was in the wrong place: ten sections down, under a heading, when on half the drugs in the
sheet the brand is the name anyone would recognise. It is in the identity card at the top now —
*Sold as Ritalin, Methylin, Metadate, Concerta* — with the Brands section below keeping the detail
that only belongs there: which route each one is, what it is licensed for, whose dosing differs.

**Again**, on the results screen, beside *Another quiz*: the same settings, a new paper, started.
Implemented as `router.refresh()` rather than as a link, because the settings are what the page was
already rendered with — rebuilding them as a query string would be a second opinion about what they
were — and the page keys the runner on the paper's id, so a fresh draw remounts it. Disabled until
the attempt has been recorded: the write happens in an effect on that component, and remounting
mid-write would throw away the quiz just sat, which is the same class of bug as the re-render that
once scored a finished paper 0 of 83.

Guarded in `tests/chrome.test.ts` (12) and `tests/study-screen.test.ts` (10), each proved to bite
by planting its violation: the pill back in link blue, an opaque scrollbar track, `color-scheme`
handed back to the OS, the smallest step back at 12px, a tinted border too dark for its text, a
`color-mix` thumb, the review dropping its shared-answer line, *Again* offered before the attempt
is written, the asked drug left in its own owner list, the setup bar back to full height mid-quiz,
the disclaimer left-aligned, and the sentence hard-coded on one of the two halves.

### The button gets a colour of its own (2026-11-04)

Third time on the same control, and the first two were both corrections rather than designs.

It started as `bg-[var(--accent)]` — the *link* colour, a fixed blue the seasons deliberately never
touch, because four seasonal accents would be four more contrast pairs to defend. Right for a link
in a sentence, wrong for a filled lozenge: in a tinted autumn the whole chrome goes warm and the
button sat in the middle of it cold. That got replaced with the reading pair inverted, `--fg` on
`--bg`, which solved the clash by giving the button no colour at all — near-black on near-white,
with a free contrast argument (it is the body text's own pair swapped over, 15:1) and nothing
per-season to keep in step. Which is also what was wrong with it: on an icy winter page the one
control you actually press was the only thing on screen with nothing seasonal about it.

So it now has three tokens of its own, stated per theme and per season: `--btn-fill`, `--btn-ink`
for its words, `--btn-edge` for its boundary. The seasons are the owner's: **icy blue** for winter,
**petal pink** for spring, **sunny yellow** for summer, a **burnt orange** for autumn. Light and
dark with no season were left to me and are a cool slate and a cool near-white — the same inversion
as before, but chosen rather than borrowed.

**Three tokens, not two, and that is the whole technical content of this.** The seasonal fills are
pale in both themes, and a pale fill cannot be told from a pale page: icy blue measures **1.1:1**
against the light ground, where WCAG 1.4.11 asks 3:1 of a control's boundary. In dark that never
came up — the button was already a light lozenge on a near-black page, so the season only has to
pick which light, and the edge clears 6.3:1 without trying. In light the edge is the only thing
doing it: a deeper shade of the same season, held at **3.65:1 or better against every ground the
app can produce**, which means each tinted ground under a season wash under the clock's warmth.
The words clear **10.3:1** on their own fill everywhere, which was never the hard part — the fill
is opaque, so nothing composites over it.

Hover thickens the edge from 1px to 2px rather than deepening the fill. Inset, so the button does
not change size; the edge rather than the fill, so the figure the words were measured against does
not move. (The old hover drew a `--surface` ring, which was a light ring on a dark fill and read as
a gap.)

**It does not wait for `data-tint`, and it is the only thing in that section that does not.** The
tint gate exists to protect grounds that text is read on across every page; a button is one
lozenge you aim at, it paints an opaque fill over whatever the washes left, and its pair is
measured together — the same reason the grade ramp gets to be red and green regardless of the
season. Picking a season should colour the button you press, not only the snow behind it.

`btn-quiet` stays the page's own surface deliberately. Two seasonal fills side by side would read
as two primary actions, which is the opposite of what the second one is for.

Guarded in `tests/seasons.test.ts` (23 new) and `tests/chrome.test.ts` (one rewritten, two
new): the two
contrast figures measured per theme per season against every stacked ground, all three tokens
present and theme-dependent in all three theme blocks, the two dark statements of each season
identical, no season quietly restating the default, and no `[data-tint]` creeping into those
selectors. Proved to bite by planting a summer edge at 2.6:1 and a winter ink the same lightness as
its fill; both failed by name.

### The rest of the blue (2026-11-04)

Two reports, one cause. *Hovering the avatar and Sign out does not follow the theme*, and *there is
still blue link text that should be pills*.

`--accent` is the colour of a link inside a sentence, and it is deliberately the one chrome token
the seasons never move -- four seasonal accents would be four more contrast pairs to defend for no
gain. Every filled button used to borrow it, which was the first thing to go wrong and is fixed.
What was left behind was everything that is *not quite a button*: a back link, a tag, a class-mate,
*Clear filters*, *Remove*, a disclosure row, the ring on the avatar, the edge of *Sign out*, the
hover on every card on the home page. All of it in a sentence's treatment, in the one colour that
cannot take a season -- so in a tinted autumn the warm page was dotted with cold blue.

**The line drawn, and it is three ways rather than two:**

- **A sentence keeps its link.** *"There are 236 drugs to draw from"*, *"...until you clear yours"*,
  *"Settings is where the theme lives"*. The words are prose and the link is a word in them. Accent
  and underlined, unchanged -- this is what accent is *for*, and the point of the pass is to make
  that claim true rather than to delete the colour.
- **A target gets a pill.** A place to go, a small action standing on its own, or a chip that stands
  for a thing: tags, class-mates, saved setups. Shaped like the top bar's navigation, because it is
  the same kind of thing.
- **The identity of a row keeps its link.** A drug in the browse table, a field or a list in an
  admin row. The row is already the target, and a column of pills reads as a wall of buttons rather
  than as a list of names. Three files, named in the test.

**`.pill` in `globals.css`**, which the top bar used to own privately and now shares with 30-odd
call sites. `--muted` at rest, `--fg` on a `--border` fill on hover -- the pair the current nav pill
was already measured in at 11:1 across both themes and all four tints. Four modifiers: `.pill-on`
for the one you are on (filled, and a notch heavier so the fill is not the only thing saying so),
`.pill-soft` for a row where one pill is already filled, `.pill-edge` for a chip, `.pill-xs` for the
small form, `.pill-danger` for removing and revoking.

Two details worth keeping. `.pill-soft` repoints a `--pill-hover` variable rather than overriding
the hover rule, so the rule is written once -- and it exists because hovering a neighbour in the top
bar must not draw the same lozenge as the current pill, or the row lies about where you are. And
`.pill-danger` has to restate its colour on hover, because the shared hover takes the text to
`--fg`: without it, *Remove* goes quiet at exactly the moment the cursor is on it.

**What the hovers point at now is `--btn-edge`** -- the avatar's ring, *Sign out*'s edge, a chip's
edge, and all seven cards on the home page and the admin index. It is the right token for the job
rather than a convenient one: of everything the seasons move, it is the only value held at 3:1 or
better against every ground the app can produce, which is what WCAG 1.4.11 asks of a control's
boundary. The one accent hover left is `:focus-visible` in the stylesheet, and it stays -- an
accessibility affordance nobody can switch off wants the strongest fixed contrast, not the
seasonal one.

**The admin index finally took part in the look.** It was eight underlined blue links with grey
sentences trailing after them -- the browser's own idea of a list -- on a site where every other
index is a grid of cards. Same cards as the home page's areas now, read off one table, and grouped
in three: the content, the people who reach it, and the site itself. Eight destinations in one grid
is a wall, and these are not eight of a kind.

**And the sig glossary's codes are no longer blue.** `QD`, `PO`, `Q8H` were set in `--accent` --
the one place in the app where blue text did nothing at all when you clicked it. They are `--fg`
against the muted English beside them; the monospace was always what set them apart.

Guarded in `tests/chrome.test.ts` (seven new, two rewritten), and the two that matter are the two that
generalise: **no `hover:`/`focus:`/`active:` state anywhere in `app/` may name `--accent`**, and
**every remaining `var(--accent)` in `app/` has to be on a list in the test with a reason beside
it** -- five sentences, three row identities, one identity chip. That is the same shape as
`tests/form-reset.test.ts`, and for the same reason: the rule is not "no accent", it is "accent
where a sentence or a row earns it", so a new one has to come to the list and say which. Proved to
bite by planting an accent hover on the 403 page and an accent mention in an unlisted file.

### What the site is called (2026-11-04)

Three values have been in `site_settings` since phase 0 with no way to edit them: `site_name`,
`registration_mode` and `disclaimer_text`. `/admin/site` edits them now. The lock is why this was
the first of the two remaining gaps worth closing — the register page refuses a stranger because
of `registration_mode`, and turning it meant SQL or a backup restore.

**The site name was stored and nothing read it.** That is the part worth writing down, because it
means the setting was not merely unreachable, it was *fictional*: every one of the eighteen page
titles appended the default name itself, the top bar printed the word, the signed-out front page
used it as its heading, and the 403 said *Back to Enkephalin*. Renaming the row would have changed
nothing anybody could see. So a settings screen had to come with the wiring, or its first field
would have been a control that does nothing:

- The root layout is a `generateMetadata` with a **title template** — `{ default: name, template:
  '%s — <name>' }` — and the eighteen pages now carry only their own half, `title: 'Drugs'`. One
  async function instead of eighteen.
- The wordmark, the front-page heading and the 403 read `getSiteName()`, which falls back rather
  than returning undefined: every caller would otherwise invent the same fallback, and a bar with
  a hole in it is worse than one showing the default.
- `/drugs` had the disclaimer's first half *hard-coded as a second copy* — so rewording the
  disclaimer on the front page left the page people actually read drug facts on still saying the
  old thing. It reads the stored text now.

**Separate from `/admin/look`, deliberately.** Same row in the database, two different questions:
Look is the theme and palette everyone *starts* on and any reader can override, while nothing on
this page can be overridden by anyone, because none of it is a preference. The admin index grew a
third group for it — the content, the people who reach it, the site itself.

**Both texts are required, and the disclaimer's refusal is a judgement rather than a constraint.**
A blank name leaves the bar and the tab title with a hole in them, which is arithmetic. A blank
disclaimer is a choice: this is a study aid built off a class sheet, the sentence saying it is not
a clinical reference is the one sentence it should not be able to lose, and clearing a field is far
too quiet a way to lose it. Rewording is the control that exists; removing is not. The two caps
(40 characters, 500) are about the wordmark and the footer they are printed in, not about the
column, which would take a novel.

**One writer for all three**, validated before anything is written, because an admin changing the
name and the disclaimer in one sitting must not be able to land the first and be refused the
second — which is exactly what three independent setters would do. It returns what it stored, so
the form re-seeds from that rather than from what was typed: a name entered with a trailing space
visibly loses it instead of sitting there looking unsaved.

**Every change writes one audit row** — `site_settings.update`, with `from` and `to` for the fields
that *moved* and nothing for the ones that did not. A save that changes nothing writes no row at
all. The log is still write-only until the audit UI is built, which makes it the last real gap in
phase 8; these rows are what it will have to render first.

Two smaller things fell out. `lib/settings.ts` became `lib/settings/{index,shape}.ts`, because the
admin form is a client component and needs the modes, the labels and the caps — importing them from
a module that reaches for `@/db` pulls `postgres` into the browser bundle, which does not build.
Exactly the split `lib/account/shape.ts` already carries a comment about, and I walked into it
again. And the look half and the identity half now share one `upsertSiteSettings`, so there is a
single statement that creates row 1 rather than two that could disagree about whether it exists.

Guarded in `tests/site-settings.test.ts` (22). The ones that matter are the refusals: each of the
five bad inputs is checked to leave the row exactly as it was, a junk `registration_mode` in the
column falls back to *invite* rather than to open — a corrupt value must not be a way in — and a
source check holds the wiring, since a title that re-hard-codes the name would otherwise break the
setting silently and no runtime would notice. Driven live as well: the name changed in the
database, with the tab title, the template and the front-page heading all following, and put back.

### The last three screens of phase 8 (2026-11-08)

Done, and phase 8 with them. All three were listed as *nothing to act on today*, which was true of
their queues and not true of the gaps behind them.

**The flagged queue** -- `/admin/flagged`. The browse filter has offered *Flagged* since phase 7
with nowhere to send anyone who used it. A flag means *somebody thinks this value is wrong*, and a
flagged value is **still studied** while it waits, so a flag with no queue behind it is a doubt
recorded and then forgotten -- worse than not recording it. Ordered by what it costs to leave
wrong: a value that has actually been asked of somebody leads, then the most recently asked, then
the alphabet. Two outcomes, and only one of them lives on the screen: *Looks right* clears the doubt
and leaves the value untouched, which is what most flags resolve to and is one click; correcting a
value goes to the field's own editor, because an enum picker, a list box and a markdown area with a
preview are what a value may need and a second set of those on a queue screen would be two editors
disagreeing about what is allowed.

Finding the flagged values needed raw SQL. `browse.ts` walks all 236 drugs in JS and is right to --
it needs every field anyway to compute the gaps -- but here the answer is a handful of rows out of a
few thousand values, and `jsonb_each` with a status test is the query the question actually is.
Drizzle's builder cannot express a lateral over a jsonb column: putting the table in a `sql` FROM
makes it invisible to the select, which fails with *the table drugs is not part of the query*. Same
place migration 0010 ended up for its `coalesce` index -- written out, and pinned by a test.

**The brand pairing editor** -- `/admin/pairing`, and this one was not a missing screen but a
**missing writer**. `brand_indications` could only be written by the importer and the merge path, so
a pairing was unchangeable once asserted -- and seven of them were asserted by
`scripts/fill-review-gaps.ts` from FDA labelling rather than read off the sheet. An assertion nobody
can correct is the wrong kind of fact for a study aid, and these are the rows *Direction decides what
counts as correct* turns brand questions on: get Zyban wrong and the app teaches that Wellbutrin is
for smoking cessation. `setBrandIndications` now lives beside the other list writers in
`mutations.ts`, audited as `drug.brand_indications`, naming brands rather than uuids because a
person reads that log.

Six drugs, because pairing is only a question where a drug has more than one brand *and* more than
one indication -- and **release forms of one brand do not count**, which is the same collapse
`build-seed.py` does: Depakote against Depakote ER is one brand in two forms, three Wellbutrins
against one Zyban is a real question. The screen says which six rather than listing 236 and letting
somebody discover that 230 of them have a single row. A brand with nothing ticked **covers all of the
drug's indications** -- the importer's own default and the common case -- so the grid says so in the
row as the boxes change, or an empty row reads as *treats nothing* and somebody ticks everything to
be safe.

**Bulk field set** -- `/admin/bulk`. The case is the sheet's own shape: a field that is the same
answer for most of the list. Most drugs have no black box warning, and recording that by opening 180
editors is how a true fact stays unrecorded -- where an unrecorded *none* is indistinguishable from a
gap, which is the one confusion the field system exists to avoid. Every write goes through
`setDrugField`, one drug at a time, so a bulk set is a stack of ordinary edits with an audit row
each; there is deliberately no bulk path into the database, since a second writer that skipped the
field's rules would be the fastest way to put 236 bad values somewhere.

**The dangerous half of a bulk set is what it overwrites, not what it writes**, so the roster shows
every drug's current value beside its box, counts how many ticked drugs already hold a value, and
counts separately how many were set by a *person* -- the ones where a bulk write undoes somebody's
work. *Only the gaps* is the default selection, so the first click cannot overwrite anything. And the
outcome separates *changed* from *already matched*, because reporting 180 writes when 179 were no-ops
makes every later count untrustworthy.

Live on `?field=bbw` the gap count reads **0 against 146 blank values**, which is correct and is the
whole distinction working: `bbw` is `blankMeansNone`, so a blank is the answer *None* rather than a
hole, the roster shows *None* for each, and a bulk write is not offered the chance to overwrite 146
recorded facts as though they were missing. Pinned by a test, since the dev data has no real gaps
left to see it with.

Guarded in `tests/flagged-queue.test.ts` (9), `tests/brand-pairing.test.ts` (9) and
`tests/bulk-field-set.test.ts` (9). Two of those tests needed the schema's own rules pointed out to
them first: a core field like `brand` lives in its own column and so **cannot be flagged at all**,
which is why the first attempt to flag one for a live check updated nothing; and `indications` is a
shared vocabulary with a unique slug, so a fixture building two drugs that both treat *First* has to
reuse the row rather than insert a second.

Two chrome guards caught all three screens on the way through, both working exactly as intended.
`tests/chrome.test.ts` keeps an allowlist of files allowed accent-coloured text with a stated reason
-- *accent where a sentence or a row identity earns it* -- and the drug named in each row is that, so
all three are registered with reasons. And `tests/form-reset.test.ts` allows `<form action={...}>`
only where the reset is the point, which sent the flagged queue's one-click control back to being
what it should have been from the start: not a form at all, but a button handing two constants to a
server action.

Verified on the running container: 6 drugs and 35 checkboxes on the pairing grid with every current
link ticked correctly (three Wellbutrins to Depression, Zyban to Smoking cessation, Revatio to
pulmonary hypertension, Viagra to erectile dysfunction); the flagged queue rendering two
deliberately-flagged values with their sources and both actions, then its empty state once they were
cleared; 236 roster checkboxes on the bulk screen with the field pills, an unknown `?field=` falling
back to the picker rather than erroring, and the apply button naming its own count. Flags and
pairings were put back exactly as they were -- 0 flagged, 24 pairings, 105 audit rows untouched.

### The log leaves with the database (2026-11-08)

Done. `audit_log` is in the backup, `BACKUP_VERSION` is 2, and the exclusion list is down to things
that are actually credentials: password hashes, sessions, invite codes, verification tokens. The
audit log was always the odd one out among them — not a credential, but the record of who asserted
what — and once export/restore became the only recovery path it was the one thing in the database a
server move would silently drop.

**It keeps the no-UUID rule, which is the only interesting part.** The file names a drug by its
slug, a person by their email, and carries no database ids at all, so an entry cannot simply hold
`actor_id` and `target_id`. Five target types resolve five different ways on the way out and back:
drug, tag and indication by slug, user by email, the settings row by the literal `site`. Verified on
the real export — 105 entries, **zero UUIDs in the audit section**.

Two things resolve to null rather than being dropped, and both are deliberate:

- **A subject that no longer exists.** 77 of the 105 are like this, 65 of them the `tag.delete`
  sweep. Dropping them would delete exactly the rows somebody goes looking for, and the audit UI
  already handles the state — it falls back to the name in the diff and renders *(deleted)* instead
  of a dead link. `target_id` has no foreign key for the same reason.
- **An actor with no account in the destination.** The entry is kept with a null actor and the
  address is *reported* on the restore screen, because losing *what changed* to preserve *who* is
  the wrong trade for a history. Said out loud rather than left to be noticed.

**And the microsecond bug tried to happen a second time.** The same `timestamptz`-keeps-microseconds,
`Date`-keeps-milliseconds mismatch that cost the audit UI 23 rows sits in the export too, one layer
down: a timestamp that goes through a `Date` is truncated, and a truncated history is one whose rows
can swap places. So `at` is read out with `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` and written
back as `sql`${at}::timestamptz``, letting Postgres parse its own format.

Writing it back needed the raw SQL specifically, which a test found rather than a guess:
Drizzle's `timestamp` column calls `.toISOString()` on whatever it is handed, so a `Date` has already
lost the precision and a string **throws outright** (`value.toISOString is not a function`). Worth
knowing how close this was to shipping quietly: **all 105 live entries carry a sub-millisecond
component**, so the truncation would have touched every row in the table rather than an unlucky few.

`replace` clears the table and writes the file; `merge` adds only what is not already there, because
the log is append-only and a merge that re-inserted everything would duplicate a record whose whole
value is being a faithful count. With no ids to compare, an entry is identified by what it says —
instant, actor, action, subject — and at microsecond precision that tuple is as close to unique as
the table gets. Inserts are chunked at 500, since a long-lived install will have tens of thousands
of entries and one insert that size is a parameter count Postgres refuses.

`tests/backup-audit.test.ts` (15) holds it: the round trip keeping `.329008`, two entries one
microsecond apart keeping their order, a slug resolving to a *different* uuid in the database it
lands in, replace clearing, merge skipping and merge still adding, the unmatched actor, the deleted
subject, and a v1 file refused rather than half-read.

**And the quiz history followed it the same day, as version 3.** `quiz_attempts` and `quiz_answers`
were the other omission, and unlike the audit log that one was a plain gap rather than a decision:
`study_cards` was carried, so a restore brought back *what is due* while losing every score, result
and streak, which made "the progress you earned" half true. Raised, and the owner said put it in.

**Answers nest inside their attempt, which is what keeps the no-UUID rule.** An answer belongs to
its attempt by *position in the file*, so `attempt_id` is never written down; the attempt belongs to
the person it is nested under. Nothing in the jsonb needed translating, which was worth checking
rather than assuming: `question_key` is a kind and a field (`fields_to_drug:dosing`), `prompt`
carries the drug's slug and generic, `choices` and `acceptable` are plain answer text, and `config`
names its scope by tag slug. Verified on the real export — 10 attempts, 128 answers, **zero UUIDs in
the progress section**, every score intact.

Three decisions worth keeping:

- **Replaced wholesale per person, in both modes**, which is the rule the rest of a person's
  progress and the drug's children already follow. Merging attempt by attempt would need an identity
  an attempt does not have — two quizzes of the same five cards, sat a minute apart, differ only in
  their timestamps — and getting that wrong means either a doubled history or a silently dropped one.
- **But "describes no attempts" and "does not describe attempts" are different files**, and only the
  first means *delete what is here*. The delete is skipped when the key is absent, so a hand-trimmed
  file cannot wipe a history it never claimed to know about.
- **An answer whose drug is gone is dropped and counted; the attempt keeps its score.**
  `quiz_answers.drug_id` is a real foreign key, so there is nothing to point it at — and `score` and
  `total` are what a results screen shows and what a streak counts. Rarer than it looks: a restore
  re-creates every drug the file describes, so this only bites a file somebody edited.

The microsecond rule got a name while this landed — `exact()` and `exactIn()`, one place saying why
an ordered history never goes through a `Date`, now used by both the audit log and the quiz history.
Deliberately *not* used for `study_cards`: a due date is day-scale, nothing is ordered by it to the
microsecond, and millisecond ISO is the right shape for a value a person might read.

`tests/backup-quiz-history.test.ts` (14). The version number is pinned in exactly one file, because
two tests asserting it means every bump fails twice and says nothing extra.

**So the backup now covers 19 of the 23 tables.** What is left out is left out on purpose and is all
credential: password hashes, sessions, invite codes and redemptions, verification tokens — plus
`lookup_cache`, which is a cache and rebuilds itself.

### The log that nobody could read (2026-11-08)

Done. `/admin/audit` opens the 105 rows that seven modules had been writing since phase 8 began,
which was the last gap in the phase with anything actually in it: the cost of keeping the record was
already being paid and none of the benefit was available.

It is a reader, not a queue. Nothing on it can be edited and reading it writes nothing -- the one
screen in the admin UI with no action on it, which is what keeps the log a record rather than a
document.

**It summarises the shapes it knows and shows every diff raw.** Seventeen actions produce five
different diff shapes: `{from,to}` pairs, nested per-field pairs, identity snapshots left behind by
deletes, lists, and merge reports with a moved/dropped count per child table. Seventeen bespoke
renderers would mean the eighteenth action silently rendering as nothing, which is the one failure a
log may not have. So `summarise` handles what it recognises, returns null otherwise, and the raw JSON
is one click away on every row -- labelled *No summary for this shape* where there is none. The same
rule the dosing parser follows one table over: a value that cannot be read keeps its place.

**A deleted target keeps its name.** `audit_log.target_id` carries no foreign key on purpose -- a log
that cascaded away with its subject would lose exactly the rows somebody is looking for -- so names
are resolved by joining where the row still exists and read back out of the diff where it does not.
`drug.delete` recorded the slug and generic, `tag.delete` the label, `user.delete` the email. Those
rows render as sentences and say *(deleted)* instead of offering a dead link. The site is the one
target with no table at all, named where the rows are built.

**The filter pills are read off the table, not hard-coded.** A new action appears in the filters the
first time it is written. Hard-coding the seventeen would mean a new one being invisible on the one
screen whose whole purpose is that nothing written goes unseen.

**And a real bug, found by two pages that did not add up.** Paging is keyset rather than offset,
because this table is written by the very edits somebody makes while reading it. The obvious cursor
-- timestamp plus id -- silently skipped rows: `timestamptz` keeps microseconds and a JavaScript
`Date` keeps milliseconds, so a timestamp that has been through Drizzle is *already* truncated.
`17:47:47.329008` came back as `.329`, `at < '...329Z'` then excluded all 65 rows stored at `.329008`
while `at = '...329Z'` matched none of them, and **23 of 105 rows fell down the gap between page one
and page two**. Found by walking the pages and adding them up -- 50 + 32 against a table of 105 --
which is the only reason it was found at all, because a short history looks exactly like a short
history.

The fix is to stop converting the value: the cursor is the row's **id alone**, and the comparison
reads that row's own stored `(at, id)` back in SQL as a row-wise `<`. Safe because `audit_log` is
append-only -- nothing in the codebase deletes from it -- and the comment says what to do if that
ever changes, because then a missing cursor row would read as the end of the log.

Guarded in `tests/audit-log.test.ts` (13). The one that matters inserts `PAGE_SIZE * 2 + 7` rows in
one statement, asserts the premise -- one instant, every row carrying a sub-millisecond component --
and then walks every page and checks the ids cover the table exactly once. A bulk write is precisely
where this bites, because every row it inserts shares one `now()`.

Verified on the running container: 105 entries over 17 kinds of change, three pages walked by
following the screen's own *Older entries* link with no overlap and no gap, filters narrowing to 5
and 1 and 0 rows, contradictory filters giving an empty state rather than an error, and a junk cursor
opening the first page rather than failing. Also surfaced, exactly as predicted when it was written:
the duplicate `dosing.reparsed` pair on dofetilide from the double-rebuild bug, sitting there in the
log at the same timestamp.

One thing it needed from the chrome guard: `tests/chrome.test.ts` keeps an allowlist of files that
may use accent-coloured text, each with a stated reason, and the rule is *accent where a sentence or
a row identity earns it*. This screen has both -- the subject of each entry is that row's identity,
and the empty state offers *Clear them* inside a sentence -- so it is registered there with its
reason rather than worked around.

### Only one drug splits its dose by brand (2026-11-04)

Asked by the owner after the sildenafil fix: *are there any other medications that need the dose
split?* The answer is **no**, and the owner's own criterion is what settles it — a split is for
drugs with **multiple dosing strategies tied to their brand on the sheet**.

That criterion is machine-checkable, which is better than a judgement call per drug.
`data/top-drugs-2026.json` has exactly one generic on more than one row: **sildenafil**, Revatio
and Viagra, each row carrying its own dosing line. It is also the only drug whose brands carry a
`dosing_override`, because `perRowDosing` in `lib/content/sync.ts` fires only in that case. One
criterion, one query, one drug — already done.

**What the earlier count meant, and did not.** The note under *Direction decides what counts as
correct* records *4 genuinely split (bupropion, fluoxetine, sildenafil, tirzepatide)*. That is a
count of drugs whose **brands partition the indications** — Zyban against the three Wellbutrins,
Sarafem against Prozac — which is a fact about pairing, not about dosing, and reading it as a
dose-split queue is the mistake this section exists to stop. Of the ten drugs with two or more
indications and an unbranched dosing line, every one of them keeps it:

- **Bupropion** — the sheet gives one row and one dose. Zyban's own regimen (150 mg daily for three
  days, then twice daily, run 7–12 weeks from before the quit date) is a fact about FDA labelling,
  not about this sheet. Out of scope by the criterion, deliberately: the sheet is what the class is
  examined on.
- **Fluoxetine** — Prozac and Sarafem are both 20 mg once a day. Only the schedule differs, and the
  sheet says nothing about it.
- **Tirzepatide** — Mounjaro and Zepbound both start at 2.5 mg weekly. Nothing to split.
- **Divalproex, celecoxib, lamotrigine, budesonide/formoterol** — the dose does vary by indication
  in the labelling, but no brand on the sheet is tied to one branch, so the split would have nothing
  to hang on.
- **Albuterol, digoxin** — already recorded as uniform. Digoxin's real HF/AF difference is the
  target serum level, which is not a dose and is not a sheet column.

So the indication-scoped dosing built on 2026-11-03 serves one drug today and is still the right
shape: it cost one nullable column, and the next edition of the sheet can split a row without any
code moving.

### A thousandfold typo, and where a correction lives (2026-11-04)

Found while answering the question above. Dofetilide was stored — and asked, and shown on its
profile — as **500 mg by mouth twice daily**. The dose is 500 **mcg**. A thousandfold overdose of a
drug whose own black box warning is about hospitalising patients on a monitor for the arrhythmia it
can induce, sitting in a study aid as the right answer.

**It is the sheet's error, not ours.** Checked against the PDF (page 8) before deciding anything,
because the two cases have different fixes and guessing between them is how you corrupt the one
file that can tell them apart: the text really does read *500 mg by mouth twice daily*, so the
extractor transcribed it faithfully.

Which is why the fix is **not** in `data/top-drugs-2026.json`. That file is a reading of the PDF
and has to stay one — it is how a bad value in the app can be told from a bad value on the sheet,
and it is regenerated whenever the sheet is re-extracted, so an edit there is both a lie and
temporary. `data/drugs-seed.json` is no better: it is built from that file by `build-seed.py`.

So a correction is **a human's value written over the sheet's**, exactly as if somebody had typed it
into the drug editor, which is a path that already exists and already works:
`scripts/correct-sheet-errors.ts` holds one reviewable table of them, each with its own `source`
(*FDA labelling for Tikosyn; the class sheet prints mg where the label says mcg*) and attributed to
the env-seeded admin by foreign key. `updatedBy` is what makes it stick — the importer keeps a
human's value over the sheet's unless run with `--force` — and the same pattern is already carrying
`fill-review-gaps.ts` and `split-dosing-by-indication.ts`. A fresh database seeds the typo and this
script removes it, which is a documented step rather than a surprise.

Deliberately narrow: this file is for values that are **wrong**, not values that are thin. The
corrected line stays as terse as the sheet's. Dofetilide's renal and QTc adjustments are real and
are not added here, because rewriting the sheet into a better reference is a different project.

**And a bug in the script it was modelled on.** Both scripts carried the comment *`setDrugField`
does not re-read the regimens*. It does — `lib/drugs/mutations.ts` rebuilds them for the dosing
field, and passes `{ unique: drug.dosingUnique }` when it does. So the explicit second call logged a
duplicate `dosing.reparsed` for one edit, and dropped `unique` — the human saying *the sig is simply
like that* — which would push a settled drug back into the dosing bench. It is not simply redundant,
though, which is why it was there: `setDrugField` returns early **without** writing when the value,
source and status all already match, and that is exactly the half-done state both scripts check for.
The call is now the repair path only, taken when the rows do not already reflect the prose, and it
passes `unique`. Both scripts re-run to *already corrected* / *already split* and write nothing.

### The sheet is a baseline, not a source of truth (2026-11-04)

Settled by the owner, immediately after the section above argued from the opposite premise: *I don't
think we should be re-extracting from the sheet now that we have the database. It was just the
baseline and a reference while building.* Right, and it moves where the authority sits.

**What is now true.** The database holds the content. `data/top-drugs-2026.json` and
`data/drugs-seed.json` are the baseline it was built from and the reference for what the class is
examined on — kept, read, diffed against, never re-imported. `scripts/extract-top-drugs.py` and
`scripts/build-seed.py` are archival: they are how the content got here, and they document the
reading, which is exactly what let the dofetilide typo be pinned on the sheet rather than on us.

**`npm run seed` stops being routine.** It was always conservative — a human's value survives it
unless it is run with `--force` — so it cannot undo an edit. What it *can* do is **resurrect**: it
creates drugs the database lacks, so a drug deleted on purpose comes back. That is a re-import of a
baseline over a database that has moved on, which is no longer a thing anyone wants. It stays in
`package.json` because it is how a genuinely empty database gets its 236 drugs, and that is now its
only job.

**Which promotes export/restore from convenience to the only recovery path**, and that makes the
backup's exclusions matter more than they did when re-seeding was a fallback. `lib/data/backup.ts`
deliberately carries no password hashes, no sessions, no invite codes and **no audit log** — chosen
so a dump is a file you can keep anywhere without it being a way to log in as you, which is still
right for the first three. The audit log is the odd one out: it is not a credential, it is the
record of who asserted what, and under this decision it is the one thing in the database that a
move to a new server would silently drop. **Open, and worth settling before the activity log lands:
either `audit_log` joins the backup or it is accepted as local-only and said so out loud.** Leaning
toward joining it — rows whose actor is matched by email, like study progress already is, since the
file carries no UUIDs.

**Settled 2026-11-08, on the owner's call: it joins.** See
[The log leaves with the database](#the-log-leaves-with-the-database-2026-11-08).

`scripts/correct-sheet-errors.ts` keeps its place, with its job changed: it is a no-op against the
live database now, and what it carries is the *record* of why dofetilide reads `mcg` when the sheet
says `mg` — provenance in `source`, attribution by foreign key, and the fix ready if an empty
database is ever seeded from the baseline again.

### What deploying actually needs (2026-11-04)

Asked by the owner: *is this ready to deploy via Docker?* **Yes, the image is.** `docker compose up
-d --build` is verified working on this machine today. What is not automatic is the content and two
environment values, and one of those is a quiet security bug if it is missed.

**What the container already does right.** Multi-stage build on `node:22-alpine`, running as a
non-root `app` user. `output: 'standalone'`, so the runtime ships without `node_modules` — bar
`drizzle-orm` and `postgres`, copied deliberately because the entrypoint needs them. The entrypoint
runs migrations under `set -e` **before** `exec`ing the server, so a failed migration stops the
container rather than serving against a schema the code does not expect. The health check is a real
`select 1` round-trip, and `web` is gated on `db` being healthy. Both services publish to
`127.0.0.1` only. Secrets arrive as env and are never baked into a layer; `.env` is in
`.gitignore` *and* `.dockerignore` and is untracked. `bootstrap()` seeds site settings, the field
defs and the first admin idempotently, and `registration_mode` defaults to `invite`, so a fresh
instance is never briefly open.

**What a deploy has to supply:**

1. **`BETTER_AUTH_URL` must be the public `https://` origin.** `lib/auth.ts` passes it straight to
   `baseURL`, and that scheme is what decides whether the session cookie is marked `Secure`. Left at
   the dev `http://localhost:3000`, sign-in still works and the cookie travels in clear — the
   failure mode is silence, which is why it is first on this list.
2. **A fresh `BETTER_AUTH_SECRET` and `ADMIN_PASSWORD`**, not the dev ones. `ADMIN_PASSWORD` is read
   only while no admin exists, so it can be dropped from the server's env after the first boot
   rather than sitting there for the life of the deployment.
3. **The content, which does not ship in the image.** A fresh database boots with settings, fields
   and an admin, and **zero drugs**. Under the decision above the way to fill it is a backup:
   `npm run export` here, then `/admin/data` on the server to restore. Not `npm run seed` — that
   needs the repo, node and `DATABASE_URL_HOST` on the server, none of which a machine running only
   the image has, and it would import the baseline rather than the database that has been worked on.
   **Export after the last content change, not before** — the newest file in `backups/` predates the
   dofetilide correction.
4. **The reverse proxy forwarding to `127.0.0.1:3000`**, which is the whole of the TLS item.

Not blocking, but true: a restore does not carry invite codes or the audit log, so classmates are
re-invited on a move and the change history stays on the old box until the question above is
settled.

### Two logs, not one — planned

Asked for by the owner, 2026-11-04: *an activity log in the admin panel with the things you listed
before.* Those things — somebody signed in, started a quiz, finished one, changed their password,
flagged a value — are **not** what `audit_log` holds, and the distinction is the design:

- **`audit_log` answers "who changed the content?"** Sixteen actions across seven modules, every
  one of them an edit with a diff: `drug.field`, `drug.create`/`delete`/`merge`, `dosing.reparsed`,
  `indication.rename`/`merge`, the four `tag.*`, `site_settings.update`, and the admin-acting-on-a-
  person set `user.role`/`status`/`password`/`signout` plus a person's own `account.email`. This is
  the one that matters when a value in a study aid turns out to be wrong, and it is the **audit UI**
  on the phase 8 list.
- **An activity log answers "what has been happening?"** Different question, different shape: high
  volume, no diffs, per-person, and interesting in aggregate rather than row by row.

Two screens, then, not one table with a filter — a diff-per-row view and a volume view want
opposite layouts, and merging them makes the audit log unreadable the day somebody does forty
flashcards.

**What exists already, which is more than half of it.** Quiz and flashcard activity is in
`quiz_attempts` and `quiz_answers`, which the results and streak screens already read — an activity
view over study is a query, not a schema change. Password changes are in `audit_log` when an admin
does it (`user.password`).

**What is genuinely missing:**

- **Sign-in and sign-out are recorded nowhere.** A successful sign-in leaves a `sessions` row, which
  says a session exists, not that one began — and nothing at all survives a sign-out. This needs a
  write in the auth path.
- **A person changing their own password.** `account.email` is audited; the self-service password
  change is not.
- **Flagging is not an event.** `status: 'flagged'` is a field's current state. *Who* flagged it and
  *when* is in `audit_log` only as a `drug.field` row whose status moved, which no activity view
  would find without knowing to look for it.

Decisions to make when it is built, recorded here so they are not made by accident: whether an
activity row is retained forever or rolled up (forty flashcards a night is 15,000 rows a year);
whether a person can see their own activity or only an admin can; and whether this table joins the
backup, which is the same open question the audit log has above.

### A second section: imported sets — planned

**Scrapped 2026-11-09.** The feature is gone — screens, parser, tables and all. This section is kept
because it is the reasoning behind every identifier, and because a revival should start from it
rather than from scratch; *Sets, re-cut for a static quiz* holds the second design, and *Scrapped:
the imported sets section* holds what was removed and why.

Asked for by the owner, 2026-11-08: *define a format for a second section, for importing generic
flashcard sets for flashcarding and generic quiz generation.* The home page already promises it —
*for the top-drugs list **and more*** — so this is the *and more*.

**The one decision everything else follows from: a set is a small table, not a list of cards.**

A flashcard app would take `front,back` pairs and be finished. This app cannot, because its quiz is
not built from cards — it is built from **an axis shared across many subjects**. Every option in a
multiple-choice question is another drug's answer to *the same field*: `drawDistractors` takes one
near miss from the same class, then falls back to the same category, then to anyone, and
`atomsOf`/`answerKey` keep a subject's *other* true answers out of the wrong-answer pool. Strip the
axis out and there is nothing to draw from but unrelated backs, which produces questions answerable
by shape alone — a date among three sentences — and that is worse than no quiz.

So an imported set declares **columns**, and its rows are subjects. A plain two-column set is then
the degenerate case rather than a different feature: one column, and the distractors are the other
rows' answers in that column, which is an ordinary and perfectly good MCQ.

**Grounded in the real notes, 2026-11-08.** The owner supplied the nine endocrine decks for ERGI PD
Exam 3 (PSCI 413), plus a 142-card flashcard file as a *reference for the kind of content* an import
would carry -- not as a format to read. The format is ours. What the decks settle is which
identifiers it needs, and they settle it with their own column headings.

**The decks are already tables, and the lecturer names the columns.** Deck 19 states them outright
-- *"What to know for each: Generic name; chemical class; mechanism; use/indication; and be able to
suggest a drug for a given condition"* -- where that last clause is the reverse direction this engine
already has. Pulling every table heading out of all nine decks gives the real vocabulary:

| Heading, as the slides write it | Deck |
|---|---|
| `Class / Generic / Composition / Mechanism / Effect / Use` | 13, 18 — and 14 without the first two |
| `Class / Generic / Composition / Mechanism / Use / Toxicity` | 13 |
| `Drug / Indication / Target`, `Drug / Indication / Mechanism`, `Drug / Main use / Mechanism` | 19 |
| `Drug / Principle mechanism / Type` | 19 |
| `Drug (Sub)Class / Generic / Brand`, `Drug / Brand (first FDA approval)` | 15, 12 |
| `Hormone / Chains / Residues / Type` | 13 |
| `Hormone / Source / Use / Patient` | 13 |
| `Receptor / Location / Function` | 13 |
| `Site / Drugs shown` | 14 |
| `Step / Detail` | 14 |
| `Stem / Meaning` | 19 |
| `Compound / Notes`, `Drug / Notes` | 14 |

Three things fall out of that table, and each one is an identifier.

**One: the column sets differ per topic, but they rhyme.** `Class / Generic / Composition /
Mechanism / Effect / Use` recurs almost verbatim in three decks. So one set per topic with its own
declared columns is right -- a single global schema for "study material" would be wrong -- *and* the
same kind of answer keeps appearing under different headings. *Mechanism*, *Principle mechanism* and
*Target* are one pool wearing three names.

**Two: the rows are not all drugs.** A `Receptor / Location / Function` row, a `Hormone / Chains /
Residues / Type` row and a `Site / Drugs shown` row are different sorts of subject, and a question
asked about one must not be answered with the others. Six subject kinds appear in nine decks: drug,
hormone, receptor, site, step, stem.

**Three: some rows are a sequence.** `Step / Detail` is the thyroid synthesis pathway and the GPCR
cascade, where the order *is* the content. Those want a different question entirely -- what comes
next -- and they must never take a random distractor, because the only honest wrong answer to "what
is step 3" is another step.

And a note on the flashcard file, kept because it is the clearest evidence for the table shape: of
its 142 cards, **96 contain a semicolon** and 26 ask more than one thing -- *"What is octreotide used
for, how is it dosed, and what are its adverse effects?"* answered in three clauses, median answer
120 characters. Those are good flashcards and impossible questions: four 120-character three-part
options are told apart by overlap, and a distractor wrong in one of its three parts is unfair rather
than instructive. Organised as a row with three columns, the same fact makes three real questions
plus a bundle. That is the whole argument for importing **organised data** rather than cards.

**The format.** JSON is canonical, because it is what `lib/data/backup.ts` already speaks and it is
diffable; CSV/TSV is accepted for a table pasted out of a spreadsheet, read as one set with its
header as the columns. Natural keys throughout, no UUIDs, same rule the backup follows.

**`docs/set-format.md` is the authoring guide**, written 2026-11-08 to be handed to a model along
with a set of lecture notes: the skeleton, every key, the closed `answers` vocabulary, how to
decompose a multi-fact note into columns, the refusal list, and a pre-handover checklist. It exists
because the format's hard part is not the syntax, it is knowing that one card with three clauses is
three columns — and because the `answers` vocabulary cannot be guessed. Its six JSON examples are
checked valid, and its worked example passes the spec it documents. The importer gets written
against that file, and the two have to stay in step.

```jsonc
{
  "format": "enkephalin.set/1",
  "slug": "ergi-pd-thyroid-drugs",
  "name": "Thyroid - Drugs to Know",

  // Scope hierarchy: what "small quizzes based on its identifiers" means.
  // Study one topic, or everything on Exam 3. Maps onto `tags` plus an ordering.
  "course": "PSCI 413",
  "exam": "Exam 3",
  "unit": "Unit 5: Thyroid",
  "topic": "Hyperthyroidism",
  "source": { "file": "14.Thyroid.pdf", "pages": "11-13" },   // provenance, as every value carries

  "identity": { "key": "generic", "label": "Generic", "kind": "drug" },
  "group": "subclass",          // names a column: the near-miss axis AND the colour axis
  "kinds": ["drug", "hormone", "receptor", "site", "step", "stem"],

  "fields": [
    { "key": "subclass",    "label": "Subclass",     "type": "enum",     "answers": "chemical_class" },
    { "key": "composition", "label": "Composition",  "type": "text",     "answers": "composition" },
    { "key": "mechanism",   "label": "Mechanism",    "type": "markdown", "answers": "mechanism",
      "prompt": "What is the mechanism of {{name}}?" },
    { "key": "target",      "label": "Target",       "type": "text",     "answers": "enzyme",
      "reversible": true },    // "which drug inhibits TPO?" is a fair question
    { "key": "effect",      "label": "Effect",       "type": "text",     "answers": "effect" },
    { "key": "use",         "label": "Clinical use", "type": "list",     "answers": "indication" },
    { "key": "toxicity",    "label": "Toxicity",     "type": "list",     "answers": "toxicity" },
    { "key": "residues",    "label": "Residues",     "type": "number",   "answers": "count",
      "measured_in": "aa" },
    { "key": "notes",       "label": "Notes",        "type": "markdown", "asks": false }
  ],

  "items": [
    { "generic": "Methimazole", "kind": "drug", "aliases": ["Tapazole"],
      "subclass": "Thioamide",
      "mechanism": "Inhibits thyroid peroxidase, blocking organification",
      "target": "Thyroid peroxidase",
      "effect": "Decrease thyroid hormone levels",
      "use": ["Hyperthyroidism", "Graves disease"],
      "toxicity": ["Agranulocytosis", "Rash"] },

    { "generic": "Organification", "kind": "step",
      "sequence": "t4-synthesis", "order": 2,
      "notes": "Iodine attached to tyrosine residues on thyroglobulin" }
  ]
}
```

**The identifiers, and what each is for.** This is what the owner asked to be thought through --
*information tagged as things like drug, treatment, etc. for mixing answers*:

- **`answers` on a column is the distractor pool key, and deliberately not the column name.** The
  table above is the proof: three decks call one thing *Mechanism*, *Principle mechanism* and
  *Target*. Column headings are local and must stay local; the pool they draw from has to be shared.
  So `answers` is a small closed vocabulary, every entry of which is a heading or cell type observed
  in these nine decks: `drug_name`, `brand_name`, `hormone`, `receptor`, `enzyme`, `site`, `stem`,
  `chemical_class`, `composition`, `mechanism`, `target`, `indication`, `effect`, `function`,
  `toxicity`, `population`, `dose`, `route`, `half_life`, `duration_class`, `potency_ratio`,
  `location`, `source_tissue`, `count`, `year`, `prose`. **This is the identifier that does the
  mixing** -- it lets a thyroid question borrow a wrong answer from the steroid deck and have it
  still be a mechanism.
- **`kind` on a row is the same idea for the identity question.** Asked *which of these is
  methimazole?*, the options must be other **drugs** -- a hormone, a receptor and a site among them
  would be eliminable without knowing anything. The six kinds above are what nine decks actually
  contain; `kinds` is declared per set rather than fixed, because the next course is respiratory and
  will want `organ` and `pathogen`.
- **`group`** is the near miss inside a kind -- *Thioamide* against *Iodide* -- and it is the one
  identifier that already has somewhere to go: it maps onto `drugClass`, which drives the near-miss
  rule, the scope filter and the colour coding today.
- **`aliases`** are not a convenience. T4, thyroxine and levothyroxine are one thing, and offering
  two of them as two options is a question with two right answers. The alias table built for
  indications already solves this, and `answerKey` has to fold aliases in or the engine's "never
  offer a second true answer" guarantee quietly breaks on exactly the material most full of synonyms.
- **`reversible` on a column** decides whether it can be the *stimulus* rather than the answer.
  `Site / Drugs shown` is a reverse row the slides wrote out by hand; *which drug inhibits TPO?* is a
  fair question where *which drug has these notes?* is not. Entity-typed columns default reversible,
  prose defaults not. This is also the data the drug section has been missing: randomising the
  stimulus is recorded as unbuilt because the fan rule needed thinking through, and a per-column flag
  is what makes it safe to turn on.
- **`sequence` + `order` on a row** marks a sequence member, from `Step / Detail`. Both, not just
  `order`: one set holds more than one sequence -- T4 synthesis and the GPCR cascade are both
  `Step / Detail` tables -- and a bare position number would silently interleave them. It buys a
  question type the engine does not have, *what follows organification?*, and more importantly it
  **forbids** the random fallback: a step's wrong answers are the other steps in its own sequence,
  or there is no question.
- **`measured_in` on a numeric column** keeps `Chains`, `Residues` and a dose comparable, and means
  numeric distractors come from other rows' real values rather than being invented. Named the long
  way round because `unit` was already taken by the scope level above -- deck 14 calls itself *Unit
  5: Thyroid*, which is the course's own word and the one a person will look for.
- **`asks: false`** marks a column that is context, not an answer. Without it every set grows a
  *Notes* column that becomes a terrible question -- and both `Compound / Notes` and `Drug / Notes`
  are real headings in deck 14.
- **`recall_only` on a row** is the escape hatch for a fact that genuinely does not decompose:
  deck 19's `Stem / Meaning` matching table is nine stems at once, and the ordering facts are
  likewise one card. It imports, it flashcards, it is never offered as multiple choice.

**The distractor ladder**, which is the existing `drawDistractors` rule generalised one step at a
time, with the owner's random fallback at the bottom:

1. **Same column, same set, same `group`** -- the true near miss.
2. **Same column, same set.**
3. **Same `answers` type, same `unit` or `exam`** -- the mixing. A mechanism from one topic against a
   mechanism from the next, which is the real exam's own difficulty.
4. **Same `answers` type, anywhere imported.**
5. **Any answer in the set, chosen at random.** Honest last resort -- and **recorded on the
   question**, so "how many questions needed the random fallback" is a number the import report and
   the results screen can show, rather than something nobody ever finds out.

Three rules bound the ladder, and they are what keep the random rung from being a licence:

- **A sequence never reaches rung 5.** A row with a `sequence` draws only from the other members of
  that same sequence. The only honest wrong answer to *what is step 3* is another step, and a random
  mechanism offered there does not make the question harder, it makes it free.
- **An identity question is bounded by `kind`.** *Which of these is methimazole?* draws only from
  rows of kind `drug`, at every rung including the last.
- **It asks short rather than padding**, exactly as the drug engine does today — and the engine's
  actual threshold, checked 2026-11-09 rather than assumed: it refuses when there is **no**
  distractor at all, not when there are fewer than three. `quiz.ts` says why in a comment at the
  refusal — *"A lone option is not a question. Two is, barely, and a scope that small is the user's
  own doing — better a short quiz than a drug silently skipped."* An earlier draft of this section
  said "below three distractors", which was wrong about the code it was describing; sets inherit the
  real rule and `tests/set-study.test.ts` pins both ends of it. A value the subject itself holds is
  never offered, which the `acceptable` machinery already guarantees.

**No relations block, and that is a decision rather than an omission.** Much of this material is
signed relations between entities -- *GHRH stimulates GH*, *ketoconazole inhibits P450c17*, *T3/T4
inhibit TRH and TSH*. A triple store was the obvious second data model and it is not needed: a
relation **is** a column whose `answers` type is an entity type. `inhibits` with
`answers: "enzyme"` gives *which enzyme does ketoconazole inhibit?* with other enzymes as
distractors, and the reverse direction free. A row for GH with list columns `stimulated_by` and
`inhibited_by` carries a whole feedback axis. One model, not two -- the same reason the dosing branch
went in the prose rather than into a column somebody ticks.

**What this buys for free, which is nearly all of it.** `buildCards` and `buildQuiz` consume
`CardSource`, a plain shape — they do not know what a drug is. So a set needs an **adapter**, not an
engine:

| `CardSource` | drug section | set section |
|---|---|---|
| `generic` | generic name | the item's identity value |
| `drugClass` | FDA EPC class | the set's `group` column |
| `tags` | tag slugs | the set's tags |
| `values` | `drugs.fields` | the item's columns |
| `schedule`, `routes`, `indications`, `dosingSig`, `dosingBranches` | real | empty |

Those last five being empty is correct by construction rather than a stub: `askable` already
refuses `controlled` without a schedule, and `atomsOf` only branches dosing when branches exist. And
mapping `group` onto `drugClass` means one line buys the near-miss distractor rule, the scope
filter (`scope.classes`), and the colour coding — all three of which are class-driven today.

Free, then: both study modes, inclusive and exclusive, both directions, the identity question
(*which of these is X?* with other items' names as options), per-subject bundles, the
acceptable-answer protection on `list` columns, SRS (`srs.ts` has no drug reference at all), cram
blocks, the priority weighting and the quiz cap.

**What actually needs building:**

1. **`set_fields`, not `field_defs`, and it needs an editor.** `field_defs.key` is globally unique,
   which is exactly wrong when two sets both want a column called `definition` — and the table
   carries sheet-specific baggage (`yearLevels`, `isCore`, the lookup mapping) that a set has no use
   for. A separate, set-scoped table, unique on `(set_id, key)`. **An imported set is editable
   afterwards** (owner's call, 2026-11-08): re-import is not the only way to change a column, which
   means `set_fields` gets the screen `/admin/fields` already is — rename, reorder, retype, set
   `options`, set the prompt, soft-delete — scoped to one set, and the items get the drug editor's
   treatment one table over. Deciding this now rather than later is what makes the merge policy
   below a real question instead of a theoretical one.
2. **The study tables learn a second kind of subject.** `study_cards.drug_id` and
   `quiz_answers.drug_id` are `not null` FKs today. They become nullable, gain an `item_id`
   alongside, and a `check (num_nonnulls(drug_id, item_id) = 1)`. **The unique index is the trap**,
   and this project has already fallen into it once: in Postgres nulls are distinct, so
   `(user_id, drug_id, card_key)` stops constraining anything the moment `drug_id` can be null.
   Same fix as migration 0010 — index over `coalesce(..., zero-uuid)`, with a test reading
   `pg_indexes`, because Drizzle cannot express it.
3. **A section-neutral identity.** `promptFor` hard-codes `{{generic}}`, the literal field keys
   `'brand'` and `'generic'`, and `IDENTITY_FIELD = 'generic'`. These become a property of the
   section. Small, but it is the one place the engine genuinely knows it is about drugs.
4. **The import screen**, under `/admin`, and a browse/study surface for sets alongside `/drugs`.
5. **The distractor pool gains two rungs, and that is the one real change inside `quiz.ts`.** Today
   `drawDistractors` draws from the candidates already in scope. Rungs 3 and 4 of the ladder reach
   *outside* the scope — same `answers` type across other sets in the unit — so the builder needs a
   second pool handed to it alongside the scoped candidates, kept distinct so a set can never be
   studied *as* another set while still borrowing wrong answers from it. Indexed on
   `(answers_type, value_key)`.
6. **Alias folding into the answer key.** `answerKey` is what stops a second true answer being
   offered, and it compares meanings. With aliases declared, two spellings of one thing must produce
   one key, or the guarantee breaks on exactly the material most likely to carry synonyms -- T4 and
   thyroxine sitting in the same four options.

7. **`<br>` is a line break, and today nothing renders one.** Asked for by the owner, 2026-11-08:
   the authoring template must not produce long single-line answers run together with semicolons.
   `docs/set-format.md` now tells an author to break such a cell with `<br>`, which puts a small
   requirement on this side: there is **no markdown library in the project at all** -- a `markdown`
   field is split on blank lines by `formatFieldValue` and rendered as `<p>{paragraph}</p>`, which
   React escapes, so a literal `<br>` would reach a reader as four characters. So the set renderer
   splits a cell on `<br>` (and on a real newline, treated identically) and emits the lines as
   separate nodes. Two properties matter and are worth a test each: the split is **presentational
   only** -- a cell is still one answer, so `answerKey`, the distractor pool and the alias folding
   above see the whole value and never a line of it -- and nothing is ever injected as HTML, because
   accepting one tag from an imported file is how a format grows an XSS hole. A `list` column is
   still the right home for several *independent* values; `<br>` is only for parts of one answer
   that need to be read apart.

### Sets you can actually study (2026-11-09)

**Scrapped 2026-11-09**, with the rest of the section — see *Scrapped: the imported sets
section*. Kept for the reasoning, which is the only thing left of it.

Asked for by the owner: *make them so i can study*. Build items 2, 3, 4 and 7 above are done, and
the section is reachable and usable end to end — import a file, browse the table, flashcard it,
quiz it, and have the schedule and the score kept.

**The study tables learned a second kind of subject.** Migration 0011: `drug_id` nullable on
`study_cards` and `quiz_answers`, `item_id` alongside, `check (num_nonnulls(...) = 1)` so *neither*
stops being representable. The trap landed exactly where it was predicted — in Postgres nulls are
distinct, so `(user_id, drug_id, card_key)` would stop constraining the set case the moment
`drug_id` could be null, and every set card would look unique to the index. Coalesced over both
columns against the zero uuid, the same fix migration 0010 needed, hand-written because Drizzle
cannot express it. `tests/study-subject.test.ts` reads `pg_indexes` *and* pins the other side: a drug
card and a set card sharing a card key must stay two cards.

**The engine's last piece of drug knowledge is gone.** `IDENTITY_FIELD = 'generic'`, the literal
`'brand'`, and two hard-coded "Which drug?" strings became a `StudySubject` the builders read.
The default is the drug section, so the 71 existing engine tests pass untouched — and a set of
hormones asks *Which hormone?* because the kind is declared in the file rather than assumed.

**`lib/sets/source.ts` is an adapter, not a second engine**, which was the whole bet of the table
decision and it paid. A set's columns become `FieldDef`s, its rows become `CardSource`s, the five
drug-only fields stay empty (correct by construction: `askable` already refuses `controlled`
without a schedule), and mapping the set's `group` column onto `drugClass` buys the near-miss rule,
the scope filter and the colour coding in one line. The scope becomes tag slugs — `set:`, `course:`,
`exam:`, `unit:`, `topic:` — because the scope filter already speaks tags, so *everything on Exam 3*
needed no new kind of filter.

**Only two writers know which sort of subject an id names**, and that is deliberate: the engine
threads one string through untouched. `recordGrade` and `recordAttempt` take `subject: 'drug' |
'item'`, and getting it wrong is not a silent bug but a failed insert, which is what the check
constraint is for.

**The screens.** `/admin/sets` imports — a file input *and* a textarea, because a file is what a
model hands back and a paste is what you do at eleven at night. `/sets` lists them grouped by course
and exam, since that is how somebody decides what to study. `/sets/[slug]` is the table itself, with
sequences shown apart and in their own order because the order *is* the content. `/sets/[slug]/
flashcards` and `/quiz` reuse the drug runners — the session runner took an `onGrade` prop and an
`emptyHint`; the quiz runner already took its action as one.

Their forms are deliberately **shorter** than the drug pages'. Most of those pages is scope — lists,
categories, indications, program year — and a set *is* the scope: you picked it by opening it. Every
column is ticked by default, because a set is small and you opened it to learn it.

**`<br>` renders**, as build item 7 required. `lib/sets/render.ts` splits a cell on `<br>` or a real
newline and emits plain strings; the tag is **recognised and discarded, never passed through**, since
accepting one tag from an imported file is how a format grows an XSS hole. The split is
presentational only, and the test that matters proves it through the real builder rather than through
the private key function: two rows sharing a first line and differing after the break must stay two
distinct answers, or one would be silently dropped from the other's options as "not wrong".

**One convention was being broken and is now fixed.** The `lib/sets/*` modules imported `@/db` and
extensionless siblings, which only Next can resolve — but `lib/data/backup.ts` and `db/schema.ts`
deliberately use relative `.ts` imports so plain `node --experimental-strip-types` can load them for
the scripts. The sets modules now follow it, which is what let the import be driven from a host
script against the live database.

Verified against the real database rather than only in tests: a real eleven-row thyroid set imported
through the actual parser and importer (6 columns, 5 subclasses, 6 mechanisms, a five-step synthesis
sequence), and all four pages fetched over HTTP as a signed-in user — the table renders, the aliases
render, the sequence renders in order, and a `<br>` cell arrives as two lines with no literal tag
anywhere in the output.

**Still to build, and none of it blocks studying:** the `set_fields` editor (build item 1 — the
table and the merge policy exist, the screen does not); rungs 3 and 4 of the distractor ladder, which
is the cross-set mixing (build item 5); alias folding into the answer key (build item 6 — aliases are
parsed, stored, refused when duplicated and shown on the table, but `answerKey` does not yet fold
them, so a set with T4 and thyroxine as separate rows could still offer both); and **sets joining the
backup**, which is a real gap of the same shape as the quiz history: a card or answer about an item
is currently skipped by the export with a comment saying so, rather than written half-resolved.

**The importer refuses rather than guesses**, which is the dosing parser's rule one level up —
all-or-nothing is what makes a format safe to point at a file somebody else wrote. It refuses the
whole file, naming the row and column, on: a cell in an `enum` column that is not one of its
`options`; a row with no identity value; two rows with the same identity; a `group` naming a column
that does not exist; a `kind` not in the set's declared `kinds`; an `answers` type outside the
vocabulary; the same alias claimed by two rows; an `order` without a `sequence`, or two rows at the
same position in one sequence; an unknown `format`. Nothing is half-imported and nothing is coerced.
(Gaps in a sequence are fine -- the slides skip steps, and a set that only has 2, 3 and 5 still asks
*what follows 3* correctly.)

The `answers` vocabulary being closed is the one refusal worth defending, because it is the opposite
of the `kinds` decision three paragraphs up. `kinds` is open because a new course brings genuinely
new sorts of thing. `answers` is closed because its *only* job is to make two sets agree, and a
vocabulary anyone can extend by typing agrees with nothing -- a column tagged `mechanisms` and
another tagged `mechanism` would silently never pool. Adding a type is a one-line change to a
constant, with the import refusal naming what is allowed.

**And it reports what the set can and cannot be quizzed on, at import time rather than at question
time.** A column needs **four distinct answers** across the set before it can make a four-option
question, so a 40-item set with a three-value `class` column is a fine flashcard column and a
guessable quiz column. That is a fact about the file, it is cheap to count, and saying it while
somebody is looking at the import result is worth more than a short question six weeks later. Same
report should flag a column whose answers are not the same *kind* of thing — the shape tell above —
as a warning, not a refusal, because that one is a judgement.

**Re-import is a merge keyed by slug**, keeping a human's later edits the way `sync.ts` already
does via `updatedBy`, with the backup's two named modes rather than a flag: `merge` leaves what the
file does not mention alone, `replace` deletes the items the file lacks and takes a typed
confirmation.

Because sets are editable, that policy has to cover **columns** as well as cells, and the two behave
differently:

- **A cell a person edited survives re-import**, exactly as a drug field does. `updatedBy` already
  answers *has a human touched this*, and the rule is already written and tested.
- **A column a person edited survives too** — a renamed label, a reworded prompt, a corrected
  `answers` type. The file supplies columns; it does not own them after the first import.
- **A column a person deleted stays deleted in `merge`.** This is the resurrection problem
  `npm run seed` has with drugs, one table over, and the answer is the same: soft-delete, and the
  importer skips a key it finds already soft-deleted rather than reviving it. `replace` revives it,
  which is what `replace` is for.
- **A column whose `type` changed under it is a refusal, not a coercion.** If the file now says
  `number` where the stored column is `list`, the import stops and names it: the existing cells are
  one shape or the other and quietly reinterpreting 236 values is how a parser earns distrust.

**Out of v1, deliberately:** cloze deletion (the engine has no model for a hole in a sentence);
images and audio; per-card SRS state in the file — progress belongs to this app and is matched by
email, as the backup already does; ~~nested sets~~ — **done 2026-11-09, and without the format
growing a nesting key at all: see *Nested decks* below.** Anki `.apkg` is *not* a format this
reads: it is a converter script writing `enkephalin.set/1`, which is the point of having a format
at all.

**Where the mixing stops.** Sets mix freely with each other, which is what rungs 3 and 4 are for:
that is one body of imported material with one declared vocabulary, and a mechanism is a mechanism
whichever lecture it came from. Sets do **not** mix with the drug section in v1. Not because it
would be wrong in principle -- 236 drugs' mechanisms are the best distractor pool in the database --
but because the drug fields carry no `answers` types, so there is nothing to pool *on*, and
inventing the mapping at the same time as the format would mean two untested ideas holding each
other up. The later move is small and deliberate: tag `field_defs` with `answers` types and the two
pools join on the identifier that already exists. Worth doing, worth doing second.

What a quiz must never do, in any version, is draw a wrong answer from a *different* `answers` type
-- a mechanism offered against an indication is not a near miss, it is a category error, and the
near-miss rule is the one thing holding question quality up.

### Nested decks (2026-11-09)

**Scrapped 2026-11-09**, with the rest of the section — see *Scrapped: the imported sets
section*. Kept for the reasoning, which is the only thing left of it.

Asked for as *nested views and quizzing, like the spaced repetition plugin in Obsidian*. There, a
deck is a path of nested tags and **every node of it is reviewable**: the parent holds its
children's cards. That is the shape, and the thing worth noticing is that this app already had the
data for it. Every set declares `course / exam / unit / topic` — a four-level path in the course's
own words — and nothing read it as a path. So **no migration, and no nesting key in the format**:
the hierarchy was in the file from the first import.

**Every node is a deck, and a set is a leaf.** `/sets/thyroid`, `/sets/pharm/exam-3`,
`/sets/pharm/exam-3/endocrine/thyroid` and `/sets/pharm/exam-3/quiz` are all the same kind of
address, resolved by one function, so the flashcard page never learns which it was handed. Two
rules keep the tree and the url in agreement, both in `lib/sets/tree.ts`:

- **An empty level collapses.** A set with a course and a unit but no exam hangs off its course.
  A branch called *(no exam)* is a thing nobody filed anything under.
- **A node is grouped by the segment it is addressed by.** `Exam 3` and `exam-3` are one node, not
  two nodes sharing a url — the failure that would otherwise stay invisible until one of them went
  missing from the other's session.

**A set slug wins over a node for a single segment**, so every `/sets/<slug>` link written before
the tree existed still means the set. And the *surface* is the last segment rather than a nested
route, because Next refuses anything under a catch-all (*Catch-all must be the last part of the
URL* — it builds and then 500s every request): the whole path is resolved as a deck first, and only
if that fails is a trailing `flashcards` or `quiz` read as the surface. A unit somebody really
called *quiz* therefore stays openable.

**The merge is where the judgement is** (`lib/sets/scope.ts`), and the rule is *a node studies what
its sets agree on, and says what it left out*:

- Columns are unioned **by key**. Three decks that all call a column `mechanism` become one column
  over all their rows, which is the entire reason to sit a unit instead of a set: verified live, a
  Fludrocortisone question drew its wrong answers from the thyroid and renal decks.
- A key two sets disagree about the **shape** of is dropped, not coerced — the same refusal the
  importer makes when a file changes a column's type under it — and the page names it.
- A column any set calls context is **shown but never asked** anywhere in the node.
- Identity: the majority `identity.key` wins, every set's identity column is kept out of the
  askable columns, and a node of mixed kinds asks *Which one?* rather than *Which hormone?* over a
  deck half of which is drugs. `card_key` is built from fact keys only, so none of this forks a
  schedule that already exists.
- Item slugs are prefixed with their set (`thyroid/levothyroxine`): two decks may each hold a row
  called levothyroxine, and `extras` is keyed by slug, so without it one row would wear the other's
  `recall_only` flag.

**Not done here, deliberately:** pooling two *differently named* columns that share an `answers`
type (`mechanism` and `target`). That is rungs 3 and 4 above, and doing it as a side effect of this
would mean remapping column keys — which is what `card_key` is built from, so every remapped card
already reviewed would fork its schedule. Worth doing deliberately.

The tree shows `rows · N due` per node, rolled up from `study_cards`, and a node with something due
opens itself: the page you open to decide what to study should not begin by hiding the answer.
*Not started* and *nothing due* are different words, because they are very different situations.

**Called *Class sets* in the chrome**, not *Sets*: a nav item called *Sets* next to *Drugs*,
*Flashcards* and *Quiz* said nothing about what was in it, and what is in it is one course's
material. The url stays `/sets`.

**The deck quiz is the drug quiz's page, down to the words.** It had drifted into a dialect of its
own — *Paper settings*, *Most questions*, *Another paper* — and two screens that do the same job in
different words are two things to learn. So it now carries the same compact running header (title,
then `6 questions · per fact · mixed directions · Mechanism, Clinical use`), the same
*Quiz settings* → *Change these and start a new quiz* disclosure with *the one running now is left
behind* beside it, the same hinted labels, and the same *Questions* control that starts at the whole
pool. It also gains **Priority**, which it could have had all along: `questionWeights` already
coalesces `drug_id` and `item_id`, so a set's own answers were already the history — the deck paper
just never asked for them. One weighter, two sections.

### Deleting an imported set (2026-11-09)

**Scrapped 2026-11-09**, with the rest of the section — see *Scrapped: the imported sets
section*. Kept for the reasoning, which is the only thing left of it.

Asked for straight after the nesting: a set could be imported and re-imported but never removed, so
a mistaken import was permanent. `/admin/sets` now folds a delete under each row.

**One `delete` and four foreign keys do the work.** `set_fields` and `set_items` cascade from
`sets`; `study_cards.item_id` and `quiz_answers.item_id` cascade from `set_items`. So the schedules
and the answers go without being named, which is the behaviour to want — a schedule pointing at a
row that no longer exists is not recoverable state.

**A past attempt survives with its score.** Only the per-question rows pointing at this set's items
go, so an old paper keeps saying *14 of 20* while the questions inside it thin out. That is the
honest reading — the person did sit it — and deleting attempts that merely touched the set would
take a mixed paper's drug questions with it. Verified live: 11 attempts before, 11 after, three
answers and three schedules gone.

**The confirmation is a checkbox and the counts beside it**, which is the choice
`app/drugs/[slug]/edit/danger-zone.tsx` already made one section over: what stops a mistake is
*3 study schedules and 3 quiz answers go with it*, not a typed-out slug. The counts come from the
server (`setDeletePreviews`, two grouped queries for the whole list rather than one per row), and
the delete recounts inside its own transaction so the report says what actually went rather than
what the page last drew. The result banner lives **above** the list, not in the row: a successful
delete revalidates the page, the row unmounts, and a message held inside it would vanish with the
thing it was reporting on.

**Found while building it: every set's row and column count was 0, on both this screen and
`/sets`.** `listSets` counted with a correlated subquery written as
`where ${setItems.setId} = ${sets.id}`, and **Drizzle renders a column embedded in a `sql` template
as a bare identifier** — so it compiled to `where "set_id" = "id"`, and since `set_items` has an
`id` of its own that is a correlation to the wrong table which is always false. A count that is
wrong is not a count that throws, so nothing failed and the numbers were simply not true. Both
subqueries are table-qualified by hand now, with the reason written beside them, and
`tests/set-import.test.ts` pins the counts. The pattern is worth knowing before writing the next
one: everywhere else in this codebase that does this aliases the inner table (`as other`) and
qualifies through the alias, which is why only sets had the bug.

### Deleting several at once (2026-11-09)

**Scrapped 2026-11-09**, with the rest of the section — see *Scrapped: the imported sets
section*. Kept for the reasoning, which is the only thing left of it.

Asked for straight after the single delete: *a way to bulk delete imported sets instead of just
individually, probably through selection in the admin screen.* The reason is the batch import one
section up — lecture material arrives nine files at a time, so a bad batch is nine mistakes, and
nine folds to open with nine checkboxes and nine confirmations inside them is the same work nine
times.

**Selection replaces the per-row delete rather than sitting beside it.** Ticking one row and
pressing the button *is* the single-set path, and a second form with its own wording and its own
confirmation is a second thing to keep in step — the kind of pair that drifts until two screens
that do one job say it in two dialects, which is the mistake the deck quiz had already made and had
to be walked back. So `/admin/sets` is now one form: a box per row, a select-all with the running
count, and one danger zone that appears only once something is ticked.

**`deleteSet` is a wrapper over `deleteSets`, not a second implementation.** Two code paths through
the same cascade is two places for the counts to drift apart, and the counts are the whole
confirmation. The single version keeps its name and its report shape, so the tests written for it
still describe the behaviour rather than the old code.

**One transaction, all of them or none.** A half-applied batch would leave the report describing a
database nobody has: the banner naming nine sets while the list still shows four. And the four
numbers are read inside that transaction before the delete, with **one grouped query per number for
the whole batch** rather than four per set — the shape `setDeletePreviews` already uses for the
list.

**A slug that is already gone is not a refusal.** Somebody else deleting a set first — or a stale
page — means the end state asked for is the end state reached, so the rest still go and the missing
ones are *named in the report* (`missing`, said as *adrenal was already gone*). Refusing the whole
batch there would mean a person who ticks ten and loses a race has to find which one and retry.
Nothing found at all is still a refusal, because then there is no end state to reach and the
message can name what was asked for.

**`getAll('slug')`, not `get`** — the same trap the file picker next to it walks into. A list of
checkboxes sharing a name sends one entry per tick, and `get` would delete the first and report
success for all of them: a silent wrong answer rather than an error, which is the worst kind.

**The ticks are dropped when the rows are.** A successful delete revalidates the page and the list
arrives without what went, so the footer must not keep counting it — and the effect that prunes the
selection returns the *same array reference* when nothing was stale, because `rows` is a fresh
array on every render and a new reference there would loop. The report banner still lives above the
list, for the reason the single delete put it there: a message held inside a row vanishes with the
row it was reporting on.

**Per-row cost is on screen while the box is ticked.** Each row now says its schedules and answers
alongside its rows and columns when it has any — the two numbers nobody can re-import — so the
decision does not need a fold to be made. The footer adds them up for what is ticked.

**One audit row per set, not one per batch.** The audit screen reads a row as a thing that happened
to a target, and a batch's only target would be the list somebody was looking at. Each row keeps
the id and the diff the single delete wrote, plus `batch: n` **only when n > 1** — so every delete
written before this change keeps its shape, and a reader can still tell a nine-set sweep from nine
separate second thoughts.

### Sets, re-cut for a static quiz — planned (2026-11-09)

**Scrapped 2026-11-09**, with the rest of the section — see *Scrapped: the imported sets
section*. Kept for the reasoning, which is the only thing left of it.

Asked for by the owner, straight after the bulk delete: *redesign the bulk set system. The quiz
system will be changed to static, so the workflow doc will have to make its own set of 3 false and
1 correct with a distractor. The flashcards will remain the same. We won't have to worry about
inter-set checking because they will be confined after this change, so a lot will be scrapped.*
Supplied with it: **the Obsidian flashcard workflow doc** used for the ERGI-PD decks before this app
existed — `Flashcard and Study Notes Workflow.md` — *to help narrow down information scope*.

**The decision this overturns is the first one.** *A second section: imported sets* opens with it:
*the one decision everything else follows from — a set is a small table, not a list of cards*, and
the argument for it was entirely about the quiz. A table existed because a generated multiple-choice
question needs **an axis shared across many subjects** to draw wrong answers from, and cards give
you nothing but unrelated backs. Take the generation away and the axis has no job. So the table is
not wrong-in-hindsight; it was load-bearing for a feature that is being removed, and what replaces
it has to be re-derived rather than trimmed.

**What *static* means here.** The file carries the questions, four options each: **one correct,
three false, and one of the three named as the near miss.** Named rather than mixed in anonymously,
for two reasons. It forces the author to write one — *three false answers* with no further
instruction reliably produces three obviously-wrong ones, which is a free question. And it is
reportable: *you picked the near miss* is the most useful thing a results screen can say, and it is
what the five-rung generated ladder was spending its whole length trying to approximate.

**Shuffled at serve time, not in the file.** `quiz_answers` already stores `choices` and
`correct_index` per answer, so what is stored is the order the person actually saw and the file's
own order never leaks a pattern.

#### What gets scrapped, and why each one can go

- **The `answers` vocabulary** (`lib/sets/vocabulary.ts`, 26 types) — its *only* job was to let two
  sets pool wrong answers. Confined sets pool with nothing, so a closed vocabulary constrains
  nothing and costs an import refusal nobody can act on.
- **`group` as the near-miss axis** — the near miss is now written by the author, by name.
- **`reversible`, and randomised stimulus for sets** — a question's direction is whatever its stem
  says.
- **`kind` / `kinds`** — these bounded the *identity* question (*which of these is methimazole?*,
  answerable only by other drugs). Nothing generates an identity question any more.
- **Rungs 3 and 4 of the distractor ladder** (build item 5, never built) and the second pool it
  needed. This is the *inter-set checking* the owner is removing, and the whole of build item 6
  (alias folding into `answerKey`) goes with it: aliases existed to stop two spellings of one thing
  being offered as two options, which only a generator can do by accident.
- **`sequence` + `order` as a question type** — *what follows organification* was a generated
  question with a generated option set. A sequence that matters is now a question somebody wrote, or
  a card; the ordering may stay as presentation on the set page.
- **`recall_only`** — it existed to keep a fact that will not decompose out of the multiple-choice
  pool. With cards and questions written separately, a card is simply not a question.
- **`quiz_answers.distractor_rung`** — there are no rungs. It stays as a column until a migration
  drops it, because rows written before today still mean something.
- **The four-distinct-answers import report** — replaced by checks a file can actually fail: exactly
  four options, all four distinct, and the correct answer not repeated among the wrong ones.
- **Most of `lib/sets/scope.ts`** (312 lines) — a node deck merged *columns by key* and had to drop
  any key two sets disagreed about the shape of. A node now concatenates its sets' cards and its
  sets' questions. *Confined* is what makes that honest: nothing is pooled, so nothing can disagree.

#### What stays, and is why this is a re-cut rather than a rewrite

The four scope lines and the whole deck tree (`course` / `exam` / `unit` / `topic` — which is the
Obsidian doc's own tag path, `#flashcards/<Course>/<Exam>/<Set>/<Topic>`, the same idea arrived at
twice and a good sign); every node being studiable; the delete and the bulk delete above;
**merge / replace** and the *a human's edit survives re-import* policy; **refuse rather than guess,
whole-file, naming the row**; `<br>` as a presentational line break with the tag discarded rather
than injected; SRS, cram blocks, the priority weighting, the quiz cap, both runners, and the compact
running header both quiz screens now share. The backup gap stays a gap.

#### The one fork, and it needs the owner's word

*The flashcards will remain the same* reads two ways, and they build differently:

- **(A) The table stays, for flashcards only.** Rows and columns as today, cards still generated per
  column (*What is the mechanism of X?*), plus an authored `questions` block. Nothing about the
  flashcard experience changes, `set_fields` / `set_items` / the table view / the column pick all
  stand, and the scrap list above shrinks to the distractor machinery alone.
- **(B) The file becomes a deck: authored cards plus authored questions.** What the Obsidian doc
  describes, and what *narrow down information scope* most plainly asks for. The table goes, and the
  column pick with it; a card's topic section becomes the thing you study a slice of.

**Recommended: B**, for the reason the opening paragraph gives — the table was justified by
generation and nothing else, and keeping a column model alive to synthesise prompts means keeping
`set_fields`, the type-change refusal, the per-column merge policy and the unbuilt column editor
(build item 1) for no remaining benefit. The Obsidian doc also makes a point the table cannot
answer: a good card sometimes pairs two linked facts — *what is X's mechanism, and what is its boxed
warning?* — which one row with two columns is structurally unable to ask, and that is the shape
somebody writing for an exam actually wants. B keeps the part the owner called *the same*: a prompt,
an answer, a grade, the same schedule.

**Nothing imported today is lost under B**, which is what makes it safe: a v1 table is mechanically
a set of cards — one per asked column per row, using the column's own prompt, which is what
`buildCards` does at runtime now — so the conversion is a script run once, and the existing thyroid
set keeps its rows as cards. Card keys change, so schedules on them fork; with eleven rows and one
real set imported, that is a cost worth naming and not worth engineering around.

#### Shape, if B

```jsonc
{
  "format": "enkephalin.set/2",
  "slug": "ergi-pd-thyroid",
  "name": "Thyroid — Drugs to Know",

  "course": "PSCI 413", "exam": "Exam 3", "unit": "Unit 5: Thyroid", "topic": "Hyperthyroidism",
  "source": { "file": "14.Thyroid.pdf", "pages": "11-13" },

  "cards": [
    { "topic": "Thyroid axis and synthesis",
      "front": "What regulates the thyroid axis?",
      "back": "TRH to TSH to T4/T3; T3/T4 feed back to inhibit TRH and TSH" }
  ],

  "questions": [
    { "topic": "Thioamides",
      "stem": "What is the mechanism of methimazole?",
      "correct": "Inhibits thyroid peroxidase, blocking organification",
      "near_miss": "Inhibits peripheral 5-deiodinase, blocking T4 to T3",
      "wrong": ["Destroys follicular cells by beta emission",
                "Blocks iodide uptake at the sodium-iodide symporter"],
      "because": "The peripheral deiodinase effect is PTU's, not methimazole's." }
  ]
}
```

- **`topic` on a card or a question is the Obsidian tag section**, and it is what you study a slice
  of now that there are no columns. The doc's own rule comes with it as a warning rather than a
  refusal: *every tag section has at least 2 cards — merge a one-card section into a neighbour.*
- **Natural keys, as everywhere else in this project.** A card is keyed by its topic plus a slug of
  its front, a question by a slug of its stem, with an optional `"id"` to pin identity — because
  without one, rewording a front on re-import forks its schedule, and *reword for clarity* is the
  most ordinary edit there is. The refusal list gains *two cards with the same front in one topic*.
- **`because` is shown after answering**, never as an option. It is the Obsidian doc's *answer plus
  one line of reasoning*, and it is what turns a missed question into something learned.
- **Two new tables, `set_cards` and `set_questions`**, both set-scoped and cascading from `sets` the
  way `set_items` does, so the bulk delete above keeps working untouched. `quiz_answers` grows a
  third subject column — `question_id`, the check becoming
  `num_nonnulls(drug_id, item_id, question_id) = 1` — and `questionWeights` coalesces three columns
  instead of two, which is all the priority weighting needs to keep working. `study_cards` points at
  `set_cards` instead of `set_items`. The nulls-are-distinct trap applies to both indexes again, and
  the fix is migration 0010's and 0011's: coalesce over the zero uuid, hand-written, pinned by a
  test that reads `pg_indexes`.

#### What the Obsidian doc settles about scope

It is the clearest statement of *how much* a set should carry, and the numbers belong in the
authoring guide rather than left to a model's judgement: **20–35 cards for a single lecture**,
140–200 for a whole study-guide deck, 35–55 for a quick-review pass, answers **one to two lines**.
Its content rules survive intact, and some are already this project's: stick to the slides; mark
anything added beyond them; use the correct value where a slide is wrong and list it under *slide
issues to check*; mark an unofficial answer *verify in class*; escape gene star alleles; and **no
semicolon runs**, which is the `<br>` rule this app already renders. Those issue lists and *verify
in class* notes want somewhere to land: a `notes` block on the set, shown on its page, is the cheap
answer.

### A class, an exam, a topic (2026-11-09)

**The topic came back out the same day — see *Not a topic, an indication*.** Everything below about
stacking, the dropdown and the rename holds; there are two kinds now, not three, because what a
lecture is about was already a field.

The day-old course profile, generalised on the owner's own correction: *alternate profiles should be
tagged like class/exam #/topic and be selectable in the standard flashcard and quizzing areas as a
tag like top drugs. There should probably be a dropdown menu for swapping between alt profiles when
looking at it on the drug profile or panel.*

**Three kinds rather than one, because that is how the material is addressed.** A melanoma lecture
is PHRM 535, and it is Heme/Onc Exam 3, and it is Melanoma — three true scopes, each of which
somebody revises by. The morning's version allowed only `course`, which was the right first cut and
the wrong vocabulary. So `tag_kind` grows `exam` and `topic`, `drug_course_values` becomes
`drug_variant_values`, and the module, the route and the tests follow the name: a **variant** of a
drug profile. Renaming a one-day-old uncommitted table is cheaper than living with
`drug_course_values` holding a topic's wording, and migration 0015 is an `alter table rename`, which
is correct whether or not 0014 was ever applied.

**They stack, widest first, narrowest wins.** `VARIANT_KINDS = ['course', 'exam', 'topic']` is the
order, and it is a rule about meaning rather than a preference about display, so every query sorts
by it instead of by the tag's own sort order. A session scoped to an exam *and* a topic reads the
exam's wording where the topic is silent, and the topic's where it speaks. `overlayFields` already
applied layers in the order given; all that was missing was a function that puts them in the right
one, which is `variantSlugsAmong` and is why it sorts rather than returning what it was handed.

**A dropdown rather than the pill row it started as**, which is the owner's call and also the
honest answer to the arithmetic: a drug in a class, on an exam, under a topic has four versions
before anybody has typed a word, and a pill each turns the top of a profile into a second
navigation bar. A `<select>` stays one control however many there are, groups them under *Class /
Exam / Topic* so the kinds are visible rather than inferred, and says which is in force without a
fill colour. It navigates rather than holding state — `?as=melanoma` — so the overlay stays on the
server where `getDrugProfile` does it, and every version is linkable.

**The count stays on each option** — *Melanoma — 3 of its own* — because *this one has its own
wording for 3 fields* is the thing worth knowing before choosing it. A variant with none is still
offered: the drug carries the tag, and "it says what the drug says" is a true answer to *what does
my class say about this*.

**What this cost outside the rename:** `lib/tags/constants.ts` had to learn the two new kinds, and
that is worth a warning. `createTag` validates against `TAG_KINDS` and falls back to `custom` for
anything else, so an import created a tag called *Melanoma* of kind `custom` — a variant nothing
could ever read, with no error anywhere. The list a form may offer and the list a variant may use
are two lists, and the second is `lib/drugs/variant-kinds.ts`; leaving a kind out of the first is
how a tag becomes `custom` by accident.

### Searching what a profile says, not just what it is called (2026-11-09)

*Refresh the drug list search fields to match the drug fields a little better, maybe be able to
search any field in the one spot and add filters in more filters.*

**One box, two searches, and the order is the whole design.** The name, the brands, the class and
the indications keep their fuzzy match — a near-miss spelling is exactly what Fuse is for. Field
prose is matched on **substring** instead, and never fuzzily: fuzzy search over a paragraph of
mechanism finds something for almost any three letters, and a rail that always has hits is a rail
that never answers a question. Name hits rank first, so searching *dabrafenib* still puts dabrafenib
at the top while searching *pyrexia* finds it by its adverse effects.

**A row that matched on content says which field earned it**, with a window around the hit rather
than the first ninety characters — the reason a drug matched *pyrexia* is halfway down its adverse
effects, and a snippet from the start of the field shows none of it. Without that line, searching a
toxicity returns a list of drugs with no visible reason to be in it, and a search box you cannot
check is one you stop trusting.

**The cost is in the payload**, and it is accepted for the same reason the index was one payload to
begin with: every stored field's text, flattened to one line per field, is about 500 characters a
drug and so roughly 120 KB over 236 of them. Flattened because searching does not care about
paragraphs; a `Record` per field rather than one blob because the rail reports which field matched.
`none` and `missing` contribute nothing, so searching *none* does not return every drug without a
black box warning — *Still blank* is the way to ask that question.

**In one field** is the precise form of the same thing, in *More filters*: pick a field, type text.
It exists because the single box deliberately pools everything, and two fields can hold the same
word — *melanoma* is an indication on one drug and a regimen's name on another. **Route** joined the
rail too, read out of the `route` field's own list values rather than a column, with the usual
caveat said out loud: a drug with no route recorded is not a drug with no route.

### A regimen is a field, for now (2026-11-09)

*The first test of this subsystem will be with cancer medications so we need to be sure there is a
regimen field for specific drug combos that you see in cancer treatments like FOLFOX.*

**Oncology is where a dose stops being a property of one drug.** Oxaliplatin is 85 mg/m² *in
FOLFOX*; nivolumab is 1 mg/kg beside ipilimumab and 240 mg alone. The combination has to be sayable
somewhere, and `dosing` cannot say it without lying about whose dose it is.

**A field rather than a table, and the trade is deliberate.** A `regimens` table with member rows is
the right shape for a pharmacy system and the wrong first move for a study app, where the thing
being learned is the sentence *this drug appears in these protocols at these doses, chosen on these
grounds*. A markdown field renders as the decision it is, is searchable by the protocol's name (see
above), and is quizzable the day it exists — *which named regimens include nivolumab, and at what
dose*. The duplication it costs is paid for by the importer **composing** the text rather than
copying it: a re-import rebuilds every member's block from one declaration, so the two cannot drift.
A table is still the better end state, and the field is what a table would have to be able to
produce anyway.

**`blankMeansNone`, and no year level.** Most drugs are in no named protocol, so a blank is an
answer and not two hundred phantom gaps in the review queue. But no program year is responsible for
it — the sheet has no regimen column — so a year preset must not tick a field that answers *none*
for most of the list. Ticking it deliberately, which is what studying an oncology unit looks like,
works as it does for every other field. That makes it the one entry in `tests/fields.test.ts`'s
asked-fields list that the sheet does not define, which is why that test now names it explicitly.

**Markdown grew a renderer**, `lib/fields/prose.ts`, because a regimen arrives nested and
`formatFieldValue`'s paragraphs flatten it into unreadability. Three constructs: paragraphs, nested
bullets (two spaces a level, three deep), numbered steps, plus a heading. Not a markdown subset
waiting to grow into markdown — the import format tells authors to use exactly these, and anything
else falls through as the plain text it is, which is why a table degrades into a line of pipes
rather than vanishing. **Deliberately not mermaid**, despite a flowchart being what was asked for: a
`graph TD` block needs a renderer, a renderer needs a CDN or a bundle, and this app runs on a box in
a cupboard that may have neither. A nested list *is* the flowchart when the flowchart is six nodes
deep, and it is the only form that still reads as itself in the raw text, in a backup file, and on a
phone.

### Importing what a lecture says about drugs (2026-11-09)

*Do we already have an importable format like the study set one but for drug profiles?* No — there
were three ways in and none of them was an authoring format: `data/drugs-seed.json` (the one-time
sheet sync), the JSON backup (a whole-database dump, keyed for restore rather than for writing), and
the bulk field set (one field, many drugs). So: `enkephalin.drugs/1`, with `docs/drug-import.md` as
its authoring guide — and the guide is the real deliverable, because the file's author is another
model handed that document, a slide deck, and nothing else.

**The one rule the guide opens with is a scoping rule, and it comes straight from the owner:** *keep
this just for drugs instead of ancillary study info for classes.* A melanoma deck is fifty-five
slides and maybe eight of them are about a drug. The incidence, the ABCDE rule, the Breslow table,
the staging, the irAE body maps are all real material and none of it has anywhere to go here.
Leaving it out is correct rather than lossy, and saying so first is what stops a file arriving full
of disease facts filed under whichever drug shared their slide.

**Absent, none and blank are three different things**, and the format refuses the third. An omitted
key means *this deck did not say*, and nothing is written. `null` means *this drug has none*, which
is an answer and is quizzed. An empty string says neither, so it is refused rather than guessed at —
the same distinction `blankMeansNone` exists for, enforced at the door.

**Nothing is overwritten, by default.** `write: "fill"` puts a value on the drug itself where the
drug has none, and sends a value that *differs* to the variant layer for the narrowest scope the
file names. That is what makes importing a lecture safe over a profile somebody has been curating,
and it is the rule that ties this feature to the one above it: a disagreement is not a correction,
it is *what this class says*. `variant` sends everything to the layer; `base` overwrites, and exists
for correcting the app. A drug the app has never held takes everything as its own whatever the mode
says — there is nothing to differ from, and a new drug whose mechanism lived only in a class layer
would read as an empty profile.

**Two passes, and the first writes nothing.** The preview reports every field, where it would go,
and *what it would replace* — the same thing the bulk field set screen shows, for the same reason.
`applyDrugImport` re-plans against the database rather than trusting the plan from the screen: a
preview is a screenshot, not a lock. And it refuses outright if any problem remains, because half an
import across eleven drugs is the state nobody can reason about afterwards.

**Everything is written through the editor's own writers** — `createDrug`, `setDrugField`,
`setDrugTags`, `patchVariantLayer` — so an import is a stack of ordinary edits with an audit row
each, with the same validation and the same provenance, rather than a second way into the database.
Two of those needed something new:

- **`patchVariantLayer`**, because `saveVariantLayer` writes the *whole* layer. That is right for
  the form, which shows every field at once and reads an empty box as *clear it*; it is exactly
  wrong for an import, where one lecture speaks about three fields and would silently wipe what
  another had put there. Two writers, and the difference between them is the difference between a
  form and a patch.
- **The tag union.** `setDrugTags` replaces membership, so adding a lecture's tags had to be the
  union with what the drug already carries — or importing a melanoma deck would quietly take
  dacarbazine off *Top Drugs 2026*.

**A lecture can declare the fields it needs**, which oncology forces immediately: the field set has
no adverse effects, no monitoring, no interactions. A `declare` block creates them through
`createFieldDef` with no year level, and a key that already exists is left exactly as it is — an
import never renames or retypes a field. The failure mode here is three files inventing
`adverse_effects`, `ae` and `toxicity` for one idea, so the guide's field table comes before its
declaration section and says to reuse the shortest key already in use.

**Matching is by generic name, then aliases, against both generic *and brand* names**, because a
deck that says *Opdivo* and a database that says *nivolumab* are talking about the same drug, and
creating a second one is the worst thing an import could do. A near-match is not guessed at.

**Regimens are declared once at file level and composed onto every member**, each member's own line
marked — the point of reading *Dabrafenib + trametinib* on dabrafenib's profile is to find
dabrafenib's dose in it. A component naming a drug that is neither in the file nor in the database
is refused rather than invented from a dose line, and a one-drug "regimen" is refused too: that is
the drug's own dosing.

**Flagging is offered as the alternative to guessing.** A value the author is unsure of carries
`"status": "flagged"` and lands in the admin flagged queue, where it sits beside every other doubted
value with its provenance attached. That makes the existing review path the import's review path,
which is better than an import-specific notion of confidence that only one screen understands.

**What is not in it, and would be worth having:** the file's `issues` list is shown and then
discarded, where it could become a note on the drug; there is no way to import the *same* lecture
twice and see what changed between the two readings; and nothing yet reads a PDF — the file is
written by a model that read one, which is the division of labour the owner already had with the
notes in `C:\Users\DT\Downloads\slides`.

### The top bar at half a screen (2026-11-09)

*Shrink the top bar a tiny bit so it fits half screen width without wrapping.*

The wide layout measured about 690px — wordmark, five pills, avatar, *Sign out* — against the 683px
a window gets at half of a 1366-wide screen, which is how this app is actually read: notes on one
side, the drug on the other. Seven pixels over, and the row's only fallback is to wrap, which
doubles the height of the chrome on **every** page.

So `.pill-nav`, a notch smaller than `.pill` and set never to wrap its own label, plus a 28px mark
and avatar in place of 32 and one step tighter gaps. About 75px, which is the difference between
wrapping and not, and the bar still reads as the same bar. The size lives in `globals.css` beside
the pill it modifies rather than as utilities in the header, which is what `tests/chrome.test.ts`
has pinned since `.pill` stopped being this bar's private styling.

### Not a topic, an indication (2026-11-09)

Hours after the three kinds shipped, the owner cut one: *since we already have the tagging system
lets just tag things more simply as class/exam # instead of topic, since those already exist as drug
fields.*

**And that is the right cut.** A topic is what a lecture is *about* — melanoma, heart failure — and
what a drug is for is an **indication**, which this app has had as a field since the first week,
with its own shared vocabulary, its own axis in the study scope and its own browse filter. Making
it a tag as well meant one idea recorded in two places that could disagree about the same drug with
neither being wrong: the melanoma *tag* says dabrafenib belongs to this lecture, the melanoma
*indication* says dabrafenib treats it, and nothing kept them honest with each other.

What is left is the two levels at which **wording** actually differs, which is all a variant ever
was: a class, and an exam inside it. `VARIANT_KINDS` is `['course', 'exam']`, and the import refuses
a `topic` scope rather than ignoring it — an author working from an older copy of the guide would
otherwise watch a scope they wrote disappear without a word.

**The enum value stays.** Dropping one from a postgres enum is a table rewrite for no gain, and an
unoffered value costs nothing: `TAG_KINDS` no longer lists it, so nothing can create one, and
`/admin/tags` still labels an existing one *Topic* rather than showing a raw enum. The distinction
that made this cheap is the one already written down in `lib/tags/constants.ts` — the list a form may
offer and the list the database holds are two different lists.

### One provenance line, and it names the class (2026-11-09)

*We should have all the variants just say "from [class title] content".*

The import used to stamp every value with *PHRM 535 — 16.Melanoma.pdf*. Correct, and wrong for where
it is read: a profile shows a source line **per field**, so fourteen fields from one lecture were
fourteen copies of a file name — noise shaped like information, when the question a reader actually
has is *whose words are these*. The class answers that. Which of their files answers a different
question, and one asked far less often.

So `provenanceOf` is now *from PHRM 535 content*, the widest scope and nothing else, and **the file
name is recorded once** — `noteOf` puts the file, the deck, the pages and the date on the layer,
where the editor already shows it and where somebody checking a value goes next. Nothing is lost; it
stopped being repeated.

The variant editor defaults its own source box to the same phrase, so a layer typed by hand and one
written by an import read identically on a profile. A layer whose provenance differs per field is
still possible — a drug entry can override it — but it is now the deliberate case rather than the
accident.

### The import asks what it should do (2026-11-09)

*It should be an option in the import to decide if a drug creates an alternate profile or if it fills
missing info then splits.*

`write` already had the three behaviours; what it did not have was a person to ask. It was a key in
the file, and **the file's author is a model that read a slide deck** — it knows what the lecture is,
and nothing whatever about the state of this database. Whether a melanoma lecture should fill in
gaps or stand up as its own version of twenty drugs depends entirely on what is already recorded,
which only the person watching the preview can see.

So the three are a radio on the import screen, in their own words — *fill the gaps, split where it
differs* / *make an alternate profile, and only that* / *correct the drug itself* — starting on
whichever the file names, defaulting to `fill`. Changing it re-reads the same text, so flipping the
radio and pressing **Check it** shows both outcomes before either happens. The copy lives in
`WRITE_MODE_COPY` beside the modes themselves, because the guide, the screen and the refusal message
all describe the same three behaviours and three separate descriptions is how they stop matching.

The guide now says this out loud, and tells its author not to work around it: there is no need to
split a deck into two files to get two behaviours.

### V-3, and which version a list means (2026-11-09)

Two asks that turned out to be one feature. *The browse list should show a number for how many
variants there are in an identifiable pill like "V-3".* And: *building flashcards and quizzes should
default to the profile added for a drug, and the tag drug adder should have options for each drug
variant origin like "amoxicillin [V-1] [Top Drugs 2026], amoxicillin [V-2] [Infectious Disease]".*

**A drug's versions have no names of their own.** They are named after the classes that wrote them,
and *amoxicillin as the Infectious Disease class words it* does not fit in a row of a 236-row list.
So they get numbers: `numberedVariantsByDrug` sorts a drug's layers into overlay order and numbers
them from 1, the browse row shows the count as `V-3`, and the list builder offers *amoxicillin [V-2]
Infectious Disease*. Same set, same order, so V-2 means the same thing in both places — and
recomputed rather than stored, so a new class appearing above it renumbers rather than lying.

The pill is bordered and monospaced rather than coloured. It is a **count, not a state**: nothing is
wrong with a drug that has three versions, and the badges either side of it — *flagged*, *needs
review* — both mean "look at this". Only layers that actually say something are counted, which is why
it reads the layer table and not membership: a class that words nothing its own way is not another
version of anything.

**Then the second half, which needed a column.** `drug_tags` gains `variant_tag_id`: a list can say
*hold amoxicillin as Infectious Disease words it*, and studying that list reads that wording by
default. Migration 0016, nullable, `on delete set null` — deleting a class drops the pointer and
leaves the drug on the list, because membership and wording are two facts and only one of them is
about that class.

**Two sources of "which version", ordered rather than ranked.** A list's choice is standing, made
when the list was built; a scope's is deliberate, made just now. The standing one is applied first
and the deliberate one last, so the deliberate one wins — the same rule that makes an exam beat the
class it sits in, and the same reason the overlay order is a list rather than a preference.

Three things this had to not break, all pinned by `tests/list-variant.test.ts`:

- **The card is still one card.** A drug studied as its class words it has the same `card_key` and
  the same schedule as the drug's own, because `card_key` is built from field keys and nothing else.
  This is the invariant that the whole variant feature exists inside.
- **The drug editor must not reset it.** Its tag section is about membership and has no version
  control on it, so `setDrugTags` now reads the existing pointers and writes them back. Without
  that, ticking a box on a drug would quietly undo a choice made on a list.
- **A version that is not a class or exam is refused**, not ignored. Silently reading the drug's own
  profile when the list says otherwise is the kind of wrong nobody notices.

What was still missing when this shipped: the study session did not say *whose words* it was asking.
Closed the same evening — see *The card says whose words these are*, which is where the V-n
numbering earns its keep.

### Declaring a field is a request, not a decision (2026-11-09)

*Should we allow the import creation doc to make fields for important info, then we can decide on
import if we create a new field or assign it to an existing one in the database? That way things
can't be creating duplicate categories.*

The failure this prevents was already written into the guide as a plea: *reuse the shortest key
already in use*, said to an author who **cannot see the field set**. A model reading a slide deck
knows the lecture has adverse effects in it and has no way to know this database calls that
`adverse_effects`, or `toxicity`, or nothing at all. Three lectures left to themselves produce three
fields for one idea, and merging fields after the fact means rewriting values across hundreds of
drugs.

So the declaration stays in the file and **the decision moves to the screen.** Each field a file
asks for appears beside the existing set with a dropdown: create it, or send its values to a field
that already means that. The author's job is to say *this lecture has adverse effects in it*; the
database's job is to say what that is called here.

**Done as a rewrite of the file rather than as an argument threaded through the planner.**
`applyFieldMap` takes the file and the map and hands back a file with the keys renamed and the
mapped declarations dropped — so a mapped file is simply a file that was written with the right keys
in it, and every refusal, preview line and writer downstream works unchanged and cannot disagree
with the mapping. The alternative, a `fieldMap` parameter threaded into plan and apply, would have
put the same decision in two places and invited them to drift.

**The suggestion is deliberately dim.** Word overlap on label and key, noise words dropped, and it
only fills in a dropdown's default. A wrong suggestion sitting visibly beside the real field set
costs a click; a clever one that silently folds a lecture's toxicity notes into somebody's black box
warning costs a field nobody can untangle afterwards. Same reason the default where nothing
resembles it is **create**: a duplicate field is recoverable, a merge is not.

Two refusals the mapping needed of its own. Two of a file's fields sent to one existing field is
refused rather than letting the later one win — half a lecture's wording would vanish silently. And
mapping onto a core field is refused, because `parseDrugImport` already refuses core keys inside
`fields` and a remap must not be a way around a rule.

**One subtlety that was a bug for ten minutes:** a mapped field is no longer declared, so it drops
out of `plan.declare` — and the dropdown that did the mapping would have disappeared from the screen
on the next *Check it*, taking the choice with it between checking and importing. So the state
carries `asked` (what the file wanted, before the map) and `map` (what was chosen) alongside the
plan. The control that makes a decision has to still be on screen showing that decision.

### The card says whose words these are (2026-11-09)

The gap named in the last round, closed on the owner's instruction: *we can add the variant number
and origin pills to the answers and questions, just not the drug name in case that reveals the
answer.*

**The constraint is the interesting part.** A flashcard can be asked either way round, and in
`fields_to_drug` the drug *is* the answer — so a pill reading *amoxicillin [V-2]* on the question
side hands it over, and the obvious implementation of "label the card with its variant" is wrong in
exactly the direction nobody would notice until the quiz felt suspiciously easy. The number and the
class are safe on both sides: *V-2 · PHRM 535* says whose wording is being asked about, and the
number is only meaningful beside a drug you have already been told. `CardVariant` holds those three
fields and no name, and the type's own doc comment says why.

**Per field, not per card, and then per card from its fields.** A class that rewords the dosing has
not reworded the mechanism, so `loadCardSources` records which version supplied each *key* —
`wordedBy` — and `buildCards` folds that down to the versions behind the keys a given card actually
asks about. A pill naming a class whose value did not win would be worse than no pill at all; a
mechanism card in a dosing-only class correctly shows nothing.

The overlay and the record are built from **one function** (`layersFor`), because they have to agree
about both the set of layers and their order. Two loops over the same slugs is how a pill ends up
naming the wrong class after somebody adds a layer kind.

Shown above the question as well as on the answer, because it changes what the question *means*:
*what is the mechanism* and *what does PHRM 535 say the mechanism is* have different right answers.
On the quiz it is one pill — a question asks about exactly one field, so at most one class's wording
is in play.

Numbered by `numberedVariantsByDrug`, the same function the browse pill and the list builder use, so
**V-2 means the same thing everywhere**. That is the whole argument for numbering them at all: the
versions have no names of their own, and a number that differs between two screens would be worse
than none.

### The search box can see a class's wording (2026-11-09)

One box over every field's text, shipped before variants existed, and it indexed the drug's own
values only. So a lecture could write seventy-six values and **none of them were findable by what
they said** — the feature that exists to record a class's wording had made that wording the one text
in the app search could not reach.

The row used to carry the *count* of versions and nothing else, on an argument that reads well and
was wrong: the list is a list, the versions are one click away on the profile. True of the `V-3`
pill, false of the box. Searching is precisely the case where "one click away" fails, because the
click you need is the one you cannot identify yet — if you knew which drug to open you would not be
searching.

So the row now carries each version's text as well. **The payload argument it was holding out
against turns out to be weak**, because a layer stores only the fields it words differently: a class
with its own mechanism for twenty drugs adds twenty short strings, not twenty profiles. The feature
that makes variants cheap to store makes them cheap to search.

**The part that matters more than the indexing: the hit says whose words it was.** A match in a
layer with no label is a trap — you click through to a profile that does not contain the word you
typed, because the class that wrote it is behind a dropdown and nothing told you to look there. So
the match line carries a `V-2 PHRM 535` pill when the drug's own profile was not what matched, and
no pill when it was. That distinction is a real one: *the drug says this* and *one class says this*
are different claims, and a search that collapses them is worse than one that misses.

Three tiers now, in order: the name-ish fuzzy hits, the drugs whose own values contain it, then the
drugs where only a version does. Same reasoning as the existing two — a drug that says something
itself outranks one where a single class's wording does — and the last tier is still a real answer
rather than a consolation.

**The precise field filter sees versions too.** Having the loose box find a row and the exact form
of the same question lose it would be two different ideas of what this app knows about a drug, and
the looser control cannot be the more capable one.

One thing deliberately left: `flatten` keeps markdown markers, so no search of any kind matches
across a `**`. That is shared with the drug's own values rather than new here, and stripping markers
is a change to what every search does — worth doing on its own, not smuggled in on this.

### The dropdown says how many drugs a list holds (2026-11-09)

*I want the tag so it's easy to select that set of drugs in the flashcard and quiz creator.*

Which is what the scope already does -- an import creates the class and the exam as tags, tags every
drug in the file with both, and both appear in the **Drug list** dropdown grouped by kind, so
*Exams -> Heme/Onc Exam 3* is one selection on either study screen. The one thing missing was
confirmation: the dropdown listed tags with no counts while the categories axis beside it showed
them, so picking a lecture's exam told you nothing about whether you had got the lecture.

Now *Heme/Onc Exam 3 -- 20 drugs*. Tags with none still appear, reading 0, because "this list is
empty" is exactly the answer you need when a deck comes back with nothing in it -- hiding them would
turn a visible emptiness into an inexplicable one.

Worth being explicit about the two labels, because they are deliberately different things. The
**provenance** on a value names the class -- *from Heme/Onc content* -- because that is whose words
they are. The **tag** you study by is the exam, because that is the set you are revising. Both come
out of one `scope` in the import file, and a lecture is reachable through either.

A lecture is still not a unit you can select, by the same earlier decision: there is no `topic`
scope, because what a lecture is *about* is an indication. So the melanoma lecture is the indication
axis, not a tag -- which also means it keeps working when a second lecture covers the same disease.

### The panel deleted a drug nobody ticked (2026-11-10)

*Something is wrong with the deletion thing we added. I went through removing imported drugs and one
of the drugs in a different tag disappeared.* And: *drugs in the delete page with variants need to
show which variant has which tag instead of just all the tags on the top one.* And: *despite
choosing the variant prednisone it deleted the top drugs/original.*

The audit log says exactly what happened. 24 drugs at `20:30:50` -- the whole heme/onc import, which
is what the screen is for -- and then one more at `20:31:39`: `{"slug": "prednisone", "tags": 3}`.
Three tags still on it, so its version had **not** been cleared first; `clearVariantLayer` would have
taken the class and the exam with it and left one. The second press sent `drug=prednisone`, and
Prednisone was a Top Drugs 2026 drug the lecture had merely worded.

Three things let a drug go out under a tick meant for its version, and all three are the same
mistake: **the screen knew something the person could not see.**

- **A tick the filter hid still counted and did not travel.** Checkboxes are DOM fields, so
  `new FormData` collects the rows on screen; the count beside the button counted every tick. That
  pairing is the worst of the two: the deletion was a *subset* of a number that was right, so a tick
  made under one filter sat invisible and went out with a later press. The count stays over every
  tick -- *a filter changing is not a reason for a tick to be forgotten* is still the rule -- and a
  hidden tick is now rendered as a hidden input, with a red line saying how many there are and a
  button that clears the filters. Count and deletion are the same set again.
- **The ticks survived the press.** They are cleared when the form is sent, which `submitTo` makes
  safe: it builds the `FormData` synchronously before it dispatches, so emptying the state after the
  call cannot race the submission. What the report names is also dropped from the list, so a row for
  a drug that is already gone is not a row somebody re-ticks.
- **The summary counted instead of naming.** *1 drug and 0 versions will be deleted* is a sentence
  nobody can check. It now names them: *Prednisone -- off Top Drugs 2026*, in the danger colour,
  with the escalation said outright -- *1 ticked version belongs to a drug that is ticked too, so the
  whole drug goes, not just the version. Untick the drug if you meant only its version.* The old
  wording for that case was *already goes with its drug*, which reads as reassurance.

**And a tag is now drawn on the version that brought it**, which is what was asked for and is the
same fix from the other end. One row of pills above a drug's versions could not answer *which class
goes out with which version*, so the only way to find out was to press delete and read the report
afterwards. Each version's line now carries the memberships that go off the drug with it, and names
the ones that merely stop reading it (*read by Top Drugs 2026, which stays*). What is left on the
drug's own row is what no version claimed -- so for a drug a lecture only touched, that is the
curated list it was already on, standing alone where it reads as the warning it is. A drug the
import *created* shows nothing there at all, and the difference is visible at a glance.

`variantScope` is that rule as a pure function, beside the SQL in `clearVariantLayer` that acts on
it. Two statements of one rule drift, so `tests/remove-drugs.test.ts` runs both against one fixture
-- an exam holding the wording, a class pointed at it, a class with wording of its own, a curated
list -- and asserts that what the panel promises is what the mutation takes.

**What was not changed: the cascade itself.** It never ran here. [A version's tags go out with
it](#a-versions-tags-go-out-with-it-2026-11-10) is still right, and the evidence says the loss came
from the drug tick rather than from the scope rule -- so the fix is in what the screen shows before
the button, not in what the button does.

**And Prednisone is back on Top Drugs 2026**, through `scripts/restore-sheet-drug.ts <slug>`. It is
the restore the export could not be: `/admin/data` holds the whole database as one file, and the
newest one predates a week of work, so rolling back to it to recover a single row would have cost
far more than the row. The sheet still has that row -- Prednisone's own profile had never been
edited by hand -- so the script runs `syncDrugs` over a list of one, the same code path that made
the other 235, and then `rebuildRegimens` for the dosing prose, which is the step the sync leaves
to `backfill-dosing.ts` and the reason a restored drug would otherwise be the only one in the table
with no dosing row. It **refuses a drug that already exists**: overwriting a live profile with the
sheet's wording is `npm run seed -- --force`, a different operation, and not what *put it back*
means.

What came back is what the sheet knows: Deltasone, *Inflammatory disorders*, `2.5-10 mg by mouth
daily` parsed to one regimen, the Corticosteroid class, `rxcui` 8640, page 19, and the Top Drugs
2026 membership. What did not: the two indications the lecture added and the lecture's own wording
of the drug, which come back by importing that lecture again -- and the study history recorded
against the deleted row, which is gone for good. The `phrm-535` and `heme-onc-exam-3` tags are
still there with nothing on them, which is correct: deleting drugs is not a decision about the
vocabulary.

### A declared field's label is Title Case (2026-11-10)

*Additional notes should be capitalized in the drug import doc, new tags should follow that rule:
"Additional Notes".*

The guide's own examples were sentence-cased -- `"label": "Additional notes"`, `"Adverse effects"`,
`"Clinical pearls"` -- so every field a lecture has ever asked for arrived that way. A label is the
name of a section on a profile and the heading on a flashcard, read beside every other field's
label, so one sentence-cased among them is the odd one out.

Written down with the same wrinkles as the class rule, so the guide has one idea about capitals
rather than two: every word takes a capital, a joining word does not (`Dosing in Renal Impairment`),
an acronym keeps its own case (`CYP Interactions`), and a hyphen behaves as it does in a class
(`Non-renal Clearance`). The `key` is untouched and stays `snake_case` -- it is the address and is
never shown, which is the whole reason the two are separate.

Both example blocks and the `notes` heading now read that way, for the reason the generic-name entry
gives: a guide whose example contradicts its rule teaches the example.

**One thing this does not reach, and it is the owner's call.** The ten fields the app *ships* are
sentence-cased in `lib/fields/core-fields.ts` -- *Mechanism of action*, *Black box warning*, *Drug
class*, *Brand names* -- and an import never renames a field, so the fields already declared keep
the labels they were created with too. Follow this rule and a new *Additional Notes* sits beside an
existing *Mechanism of action*: the guide is consistent with itself and the profile is not, until
somebody decides to retitle the shipped set and the stored `field_defs` rows. Recorded here rather
than done, because it is a change to what every screen prints and nobody has asked for it yet.

### A version's tags go out with it (2026-11-10)

*When a variant with a tag the main drug doesn't have is deleted from the database, the tags get
added to the main drug when they should disappear along with the variant.*

They were. `clearVariantLayer` deleted the layer and then nulled every pointer at it, on the
reasoning the removal screen was built with that morning -- *membership and wording are two facts,
and only one was wrong*. True of a curated list, and wrong about the only tags that were there
because of the import being undone.

What an import writes is **a version and its scope together**: the lecture's class and exam are
tagged onto the drug, the layer lands on the narrowest of them, and `pointTagsAtVariant` points the
others at it. Delete the wording alone and both tags stay behind -- and a class tag with nothing
left to read is read as *the drug's own words*, so a lecture deleted off cefuroxime went on
claiming that cefuroxime's own profile is what Heme/Onc Exam 3 teaches. Nobody tagged it. The
import did, and the import was what was being undone.

So deleting a version now takes, with it:

- **its own membership** -- the drug comes off that class or exam;
- **every other scope that was reading it** -- a course pointed at the exam's layer is the same
  lecture under another name.

And deliberately does not take:

- **a list, a year or a custom tag.** `top-drugs-2026` is a curation decision that outlives any one
  lecture, and the split is already `pointTagsAtVariant`'s: it will point a list at a version and
  would never put a drug on one. The membership stays and only its pointer is nulled.
- **a class with wording of its own.** Then it is a version in its own right rather than another
  name for the one going, and dropping its membership would leave its layer stored and unreachable
  -- `variantOptionsFor` only offers a layer the drug is still tagged with. Pointer nulled, place
  kept.

The pointer still gets nulled for everything that stays, for the original reason: a membership
naming wording that is gone is stale in the way that looks like nothing, because every reader
quietly falls back to the drug's own words while the profile goes on reporting a version the drug
has not got.

**Two things make this safe to do by kind rather than by provenance.** `drug_tags` records nothing
about who put a row there, so a hand-tagged class is indistinguishable from an imported one -- the
rule has to be about what kind of tag it is, and a class or exam membership is the one kind an
import creates wholesale. And `clearVariantLayer` has exactly one caller, `/admin/remove`, whose
whole purpose is undoing an import; the other way a layer goes -- emptying every box on the variant
form -- is a different sentence (*this class says what the drug says*) and still touches no
membership at all.

The screen says what it did. `removeAction` reports the memberships it dropped, named
`drug:tag`, the summary line says *a version takes the class and exam tags that came with it; lists
stay* before you type DELETE, and the page's intro says it too. A deletion nobody ticked is one the
screen has to admit to.

### The guide now asks for a capitalised drug class (2026-11-10)

*I want to make it so the drug import doc capitalizes drug classes, right now its showing
"Second-generation cephalosporin" and that looks bad.*

Same shape as [the guide now asks for a capitalised drug
name](#the-guide-now-asks-for-a-capitalised-drug-name-2026-11-10), and the same fix: the
instruction, not a normaliser.
`drugs.drug_class` holds an FDA Established Pharmacologic Class name -- the one class vocabulary
this project trusts, per `lib/drugs/drug-class.ts` -- and all 119 values the sheet brought in are
RxNorm's own spelling of one: `Xanthine Oxidase Inhibitor`, `Cephalosporin Antibacterial`,
`HMG-CoA Reductase Inhibitor`. A lecture writes the class as lecture prose, so an import drops
`Second-generation cephalosporin` into a column where everything else is title case.

The rule written down, with the wrinkles taken from values already stored rather than invented:
capitalise every word; a joining word stays lowercase (`Serotonin and Norepinephrine Reuptake
Inhibitor`); after a hyphen a qualifier stays lowercase (`Anti-epileptic Agent`, `Thiazide-like
Diuretic`, and so `Second-generation Cephalosporin`) while two hyphenated nouns both take a capital
(`Sodium-Glucose Cotransporter 2 Inhibitor`); a Greek letter or stereochemical prefix stays
lowercase wherever it falls (`beta-Adrenergic Blocker`, `5-alpha Reductase Inhibitor`,
`l-Thyroxine`); and an acronym keeps its own case and is **not** spelled out, because the acronym
rule is about fields read as prose and `Glucagon-Like Peptide-1 (GLP-1) Receptor Agonist` is not
the name of anything.

**It is not only looks**, which is the part worth having in the guide. The class is stored verbatim
and compared as a whole string -- the browse rail's class filter, the colour-by-class axis and
`sameClass` distractor sampling in `lib/study/quiz.ts` all group by the exact value -- so two
spellings are two classes with one name, each a smaller group than the lecture meant, and the same
class with two colours.

The worked example's four classes were lower case and are now not, for the reason the generic-name
entry gives: a guide whose example contradicts its rule teaches the example.

Left alone, and worth deciding on separately: the classes already stored by the Heme/Onc import.
The class is *filled and never corrected* outside `base` mode, so no re-import will tidy them --
unlike a drug name, though, nothing is derived from the class, so a rename is cheap whenever
somebody wants it.

### *Visible by default* means *visible when empty* (2026-11-10)

*Making it not show declutters, but right now if a drug does have info in that field and
defaultVisible is unchecked, that info section isn't viewable on any drug, even the ones where it
should be.*

The flag was a censor dressed as a declutter switch. Unticking it to stop two hundred drugs printing
*not recorded yet* also hid the twelve that had the fact -- on every drug, with nothing on any screen
to say the field existed at all. Decluttering and withholding are not the same instruction and only
one of them was ever wanted.

So `defaultVisible` is now about the **empty** field rather than about the field:

| | ticked | unticked |
|---|---|---|
| drug has a value | shows | **shows** |
| drug has nothing | shows, as *not recorded yet* | hidden |

Four things worth keeping from doing it:

- **The formatter already knew the difference.** `formatFieldValue` distinguishes `missing` -- a gap
  -- from `none`, which is an answer, so the test is one call and the rules that feed it
  (`blankMeansNone`, a stored `status: 'none'`) need no second implementation. The corollary is
  exact and worth stating: a field whose blank already means none has **no** empty state, so this
  flag cannot hide it. `bbw` is that field, and 147 of 237 drugs depend on the reading.
- **The emptiness test has to run against the overlay, and against the layers in the comparison.**
  A field the drug is silent about but a class words is the thing *Compare all* was opened to show;
  testing the drug's own values would have dropped the row and the layer with it.
- **`coreValues` moved into `getDrugProfile`.** The filter has to ask the same question of the five
  core fields as the page does, and two answers to *has this drug anything to say here* would be two
  profiles. The page destructures it now instead of rebuilding it.
- **The variant editor stopped reading `profile.defs`.** Its comment used to justify the narrowing
  -- *a field somebody has hidden is out, since the profile would not show it* -- and under the new
  rule that is exactly backwards: a hidden-when-empty field is absent until something is written,
  and this is the screen that writes it. Leaving it out would make the only fields a class could
  speak about the ones it had already spoken about. It reads the registry direct, like the drug
  editor always has.

A reader's own `fieldVisibility` still outranks both, in either direction. Worth recording that
**nothing in the app sets it**: it is read here and carried through backups, and that is the other
half of why the old meaning was so sharp -- the one switch that hid a field had no counterweight
anywhere.

### The field list reorders itself, and ticks its own boxes (2026-11-10)

*Drag to reorder appearance order, and put blank-means-none, can-be-quizzed and visible-by-default
on the list as checkboxes so they are easy to change.*

Appearance order was a number box on each field's own editor page, which turned the only question
anybody asks of this screen -- what comes after what -- into arithmetic, and spread the answer across
thirteen pages. It is now a drag, and `/admin/fields` is a client component for exactly that reason:
an order is only expressible as *the whole order*, so the row has to move before the server has
agreed to it.

**Within a group only.** A profile renders fields grouped, so a row dragged between two members of
another group would sit on this page somewhere the profile will never put it. Changing a field's
group is an edit to the field, and the editor is where that lives.

Three things this turned up that were not obvious:

- **The grouped order and `sortOrder` are not the same list.** The numbers interleave the groups
  live -- `ae` at 0, `generic` at 10, `indication` at 30 -- so a profile's Clinical section is built
  from three separate runs of the sort order. The page therefore hands the list over already
  flattened through `groupFieldDefs`, which is both the order a reader sees *and* the order in which
  each group is one contiguous run, which is what lets the arrows move a row past its neighbour. The
  first reorder renumbers 0..n and the two agree from then on.
- **`reorderFieldDefs` takes every field, not the one that moved.** Renumbering the lot is the only
  write that cannot leave two fields claiming one position, and it is a transaction because a
  half-applied renumber is a scrambled list rather than an old one. The index is the new
  `sortOrder`, which keeps the editor's default of 100 meaning *last*, and a test pins that.
- **`setFieldFlag` is deliberately narrow.** `updateFieldDef` writes the whole definition, so using
  it to tick a box would have the list sending back a label, a type and an enum option list it never
  displayed -- any of which, arriving stale, would overwrite an edit made in the editor a minute
  earlier. One id, one flag, one boolean.

Also: **arrows beside the handle**, because a native drag works for neither a keyboard nor a
touchscreen, and a reordering control that only a mouse can reach is a reordering control half the
time. And both writes return their `Result` so a refusal puts the row -- or the tick -- back where
it was and says why, rather than leaving the screen disagreeing with the database.

The three flags' copy moved into `FIELD_FLAGS` in `lib/fields/constants.ts`, and the editor now
reads it too: the list shows one word and a tooltip, the editor the whole sentence, and two copies
of that wording is how a checkbox comes to mean something subtly different depending on where it was
ticked.

Two static guards failed on the new file and both were right to: the accent-text allowlist in
`chrome.test.ts` and the form-action allowlist in `form-reset.test.ts` each name the file that is
allowed the thing, and the thing had moved from `page.tsx` into `field-list.tsx`. Updated with their
reasons rather than widened.

### What counts as a pearl, and keeping a field short (2026-11-10)

Guide only, by instruction, and nothing in it needed the importer -- so nothing in the importer
moved. (The semicolon warning from earlier the same day stays: asked and answered.)

**`pearl` gets a test, because it is the field most often filled with something that belongs
elsewhere.** A value is a pearl only if the slide labels it one, or it is unique and important for
that drug and no other field is about that kind of fact. The part worth writing down is the second
half of the first clause: **a slide labelled *Pearls* is still sorted by what it says.** A
*Macrolides Drug Interaction/Pearls* slide listing CYP3A4 interactions is `interactions`;
vancomycin's *General practice pearls* about when to draw a trough is `monitoring`. The label tells
you the lecturer thought it mattered, not which field it belongs in -- and it does not go in `pearl`
as well, because two copies of a fact are two things to keep in step.

Three kinds of thing that are not pearls: a class fact repeated onto every drug in the class, which
teaches it once and pads the rest; anything another field already says, which is one more place for
the two to disagree; and trivia that goes stale, an approval year or an *approval being sought*, in
a file that will be read for years by nobody who comes back to date-check it. Three good ones are
given for calibration -- daptomycin's *inactivated by lung surfactant*, ceftriaxone's *not for
neonates*, amikacin's *reserved for gentamicin- or tobramycin-resistant bugs* -- each of which would
change what you do, is true of the drug rather than the class, and is in no other field. And most
drugs have none, so the key is left out.

**`notes` is now documented** as the field for a useful fact that fits no other field and is not a
pearl: cross-reactivity as a plain statement with no percentages (the percentage moves with the
study and with what counted as a reaction), resistance that changes which drug you pick, and which
brand is which formulation. Both it and `pearl` are declared by files rather than shipped, which the
section says, because an author who writes `notes` without declaring it gets a refusal.

Worth recording from checking rather than assuming: a brand row **can** carry a route and a form --
`drug_brands.route` -- but the import format has no way to set them, since `brands` is a list of
names. So *Ceftin is PO, Zinacef is IV* genuinely has nowhere better to live than `notes`, and the
guide says so rather than implying the field is a dumping ground.

**A value is a bullet fragment, not a sentence**: *Renally adjust*, not *Adjust for renal function.*
Shorter wording and never fewer facts -- every organism, dose, level, adverse effect and interaction
the slide gives stays, because those numbers are the whole reason the lecture is worth importing.

One clause of that is mine rather than asked for, and it is there to stop the guide contradicting
itself: the rule bites hardest on the fields that are really lists, while a mechanism or a dosing
paragraph may stay prose where the explanation *is* the content. The markdown chapter documents
paragraphs as a supported construct and the worked example's `moa` values use them, so a flat *no
sentences* would have condemned the guide's own examples on the page after it recommends them.

The example's dabrafenib pearl mixed two facts -- *crosses the blood-brain barrier* and *metabolised
by CYP2C8 and CYP3A4*. The first stays as the pearl; the second moved into a declared `pk` field
rather than being deleted, since *keep every fact* is the other half of the same rule and an example
that quietly drops one would teach the wrong lesson.

### Spell an acronym out once per field (2026-11-10)

A rule for the guide and **not** for the importer, which is the decision worth recording. The owner
had passed two long specifications through without reading them and said so afterwards: *they should
have just been rules for the drug import doc instead of system changes.* So the acronym rule is
authoring guidance only -- no warning, no scan, no code -- and the semicolon warning built an hour
earlier is left in place pending a decision rather than ripped out unasked, since removing working
code is its own system change.

The rule: the first time an acronym appears **in a field**, it is the full term with the acronym in
brackets, and later uses in that field stay short. Per field, not per file, and that is the only
part of it that needed an argument: a flashcard shows one field at a time, so an acronym spelled out
in `pearl` is an acronym nobody has met in `moa`. An indication is read alone too -- in the drug
list, in a filter, in a quiz stem -- so it explains itself the same way.

Mechanics, in the guide because every one of them is a thing a deck gets wrong: capitalise the full
term only where it starts a line, a bullet or a heading; square brackets where the acronym falls
inside round ones, so brackets never nest; never two bracket groups back to back -- `(MRSA)
(bacteremia)` is two fragments the reader has to join up, and the fix is a sentence. Then three
lists: what stays short (routes, frequencies, everyday terms, body weights, pharmacodynamic ratios,
electrolytes, enzyme and gene names), what is always written out with no acronym kept (`C. diff`,
`incl.`, `FQ`, `2x/week`), and the coverage mnemonics, each followed directly by its letters.

One row was extended past what was asked, because the guide's own examples needed it: the
enzyme-and-gene row now covers a target, gene or pathway the deck names as such -- `PD-1`,
`CTLA-4`, `BRAF`, `MEK`, `MAPK`. Spelling `BRAF` out teaches nobody what the deck meant by it, and
without that row the worked example would have contradicted the new rule on its first line.

Examples brought into line: `irAE`, `ICI`, `OS` and `NCCN` spelled out at first use in each field
they appear in, `CNS` and `QTc` left short, `AE` written out as *adverse effects*, and
`Raised ALT/AST 4%` reworded to `Raised transaminases (ALT/AST) 4%` -- the full term for the pair,
which reads better than expanding both.

Nothing stored was touched. A one-off scan says **90 stored values** use an acronym that is never
spelled out in that value -- `ICI` 8, `REMS` 7, `ADHD` 6, `GERD` 5, `irAE` 4, `ALT`/`AST` 4 each,
`COPD` 4, `NCCN` 3, `MOA` 3 -- counted after discarding receptor and enzyme names, trial names and
capitalised English words, which a looser pass had put at 143. Left alone pending a decision, like
the semicolons.

### Two rules of form: no semicolons, and a capital after every slash (2026-11-10)

**No semicolon in a markdown value.** `lib/fields/prose.ts` reads a heading, a paragraph and a list,
and a semicolon is none of them -- so `- Tendonitis and tendon rupture; risk factors age over 60` is
one bullet carrying two ideas, and the second is the one nobody sees. Each idea gets its own line: a
bullet, or a sub-bullet under the one it qualifies, which is the shape whenever the second half is
*about* the first.

**Warned, not refused**, and the distinction is the whole design. The value is correct, importable
and renders exactly as written -- it only reads worse than it could -- so blocking a lecture over it
would be out of proportion, and saying nothing would be worse, because nobody rereads a field once it
is stored. `ImportPlan.warnings` is its own channel: not `problems`, which stops the import, and not
`issues`, which is the file author's own list of what they could not resolve. A warning is about
*form*, and it is named exactly the way a refusal is -- `drugs[3] (Ciprofloxacin).fields.bbw` -- so
it points at the line to edit rather than at a name to search for.

Three decisions inside it:

- **Markdown only.** A `list` field reads `;` as a separator and is documented as doing so (`"IV;
  PO"` is two routes), so the scan must not creep into the one type where the character means
  something. A `text` field is left alone too: nothing there splits, but nothing there pretends to.
- **The type comes from the database or from the file**, in that order, so a field this lecture
  declares is scanned on the strength of its own `type` -- which matters, because a lecture's own
  markdown field is the one most likely to arrive as a wall of semicolons.
- **A regimen is scanned at its source**, over `when`, `flow` and `notes`, rather than over the
  composed `regimen` value the planner builds for each member drug. Scanning the composition would
  report one semicolon once per drug in the protocol and point at none of the places it is written.

Nothing stored needs cleaning for correctness: a semicolon is ordinary text to `parseProse`, so every
stored value renders as written. It is a readability debt, and the live library carries 45 of them --
18 `moa`, 13 `regimen`, 10 `ae`, 3 `dosing`, 1 `pearl`, plus one variant layer -- across 29 distinct
lines, mostly one deck repeated across the BRAF/MEK drugs. Left alone pending a decision: rewriting
somebody's stored prose is not a thing to do unasked.

**A capital after every slash.** In a combination product every component is capitalised -- in the
generic name, the aliases and a regimen component's drug name: `Amoxicillin/Clavulanate`,
`Piperacillin/Tazobactam`, `Imipenem/Cilastatin/Relebactam`, and the short forms `Amox/Clav`,
`Pip/Tazo`, `TMP/SMX`. Only the first letter of each part changes; the rest stays as the deck writes
it, so `Norethindrone/Ethinyl estradiol` capitalises *Ethinyl* and leaves *estradiol* alone. The rule
is about **names** and not about prose with a slash in it -- a dose written *nivolumab 480 mg /
relatlimab 160 mg* is a sentence.

No importer change, and two facts worth writing down rather than assuming. Matching lower-cases both
sides, and the address fallback lower-cases too, so a file spelling a component either way finds the
same drug and creates no duplicate. And **an import never renames a drug it matched**: `createDrug`
is the only writer of `generic_name` on this path, so the stored spelling survives the import that
disagrees with it. Fixing a stored name is an edit, not an import -- a test already pins it.

Checked before writing any of it: the library has **no** lower-case component to fix. Every
combination name and every brand is already capitalised on both sides of the slash.

While in there, a table this guide had split in half: the `source` and `note` rows of the drug-entry
table had been orphaned below the capitalisation paragraph I added on 2026-11-10, so they rendered as
the literal run of pipes this same guide tells authors to avoid. Reunited with their table.

### A tag reads the drug as something, and the page now says which (2026-11-10)

*Swapping between variations shows both as having the tags when only one should. An ID lecture
scoped to [PHRM 532] and [ID Exam 1] was imported over an amoxicillin already on a top-200 list, and
both tags appeared on both versions.*

The membership is not the bug, and it cannot be: a layer is only ever read through a tag the drug
carries -- every reader joins `drug_tags` -- so the tag has to be on the drug for the ID version to
be readable at all. What was missing is that **which wording a list means is per membership**, which
`drug_tags.variant_tag_id` has recorded since migration 0016 and the profile's Tags card ignored. It
printed every membership in one row whatever was on screen, so the drug's own profile claimed the
class's tags and the class's version claimed the list's, and nothing on the page distinguished *this
drug is on PHRM 532* from *what you are reading is what PHRM 532 says*.

So `getDrugProfile` now answers that per tag, as `reads`, decided in this order:

1. the version the membership names, where it names one **and that version still has wording**;
2. the tag itself, where it is a class or exam that words this drug differently -- reading the drug
   through it *is* reading its layer, which is what the version pills do;
3. the drug's own words.

The card groups by it and shows **only the group that is on screen**. I built it grouped first, with
the other readings greyed and linked, on the argument that both halves are worth knowing -- the drug
really is on the top-200 list while you read the ID class's words. The owner's answer was to hide
them, and it is the better call: a tag that reads this drug as some other version is not a fact about
what you are looking at, and a card that lists them greyed is still a card listing them. Nothing is
lost from the page, because the Versions card directly above is where the other readings live and is
the control for getting to them -- the Tags card had been answering a question that card already
answers, badly.

*Compare all* is the exception and keeps every group, each linking to the reading it gives: every
version is on screen at once there, so nothing is *the* reading and hiding on that basis would empty
the card.

**And a cleared version stops being named.** `clearVariantLayer` now nulls any membership pointing
at the version it deleted, for the same reason migration 0016 nulls them when the tag itself goes:
the membership is still true, the reading is not. That is the *even after deleting, the tags stuck*
half of the report -- a pointer at wording that no longer exists, with every reader quietly falling
back to the drug's own words while the page went on claiming a version the drug had not got. Rule 1
above is the belt to that brace: a pointer that survives some other way is ignored rather than
honoured.

### One address, four spellings: matching a combination product (2026-11-10)

*A file had `"generic": "Amoxicillin/clavulanate"`; the app already held that drug; the import
refused with "A drug already exists at /drugs/amoxicillin-clavulanate".*

Two rules that each look reasonable, and the gap between them is exactly the width of one space:

- **Matching is whole-string, trimmed and lower-cased.** `matchDrug` tries `generic` then every
  alias against an index of generic names *and* brand names. Nothing inside the string is
  normalised.
- **A new drug's address is `drugSlug(generic)`**, which turns every run of non-alphanumerics into
  one dash.

So the library's `Amoxicillin/ Clavulanate` and the file's `Amoxicillin/clavulanate` are different
strings and the same address. No match, so a new drug; the address is taken, so `createDrug`
refuses -- and it refuses deliberately, because two drugs a slug apart is how the sildenafil
duplicate happened. `Piperacillin/Tazobactam` in the same file matched and updated fine, which is
the tell: the library is spelled both ways. Eight of its seventeen combination names have a space
after the slash and the rest do not, so *use the separator the library uses* is not advice anybody
can follow.

The guide now carries all of it: the exact comparison, the slug rule as a table of four spellings
reaching one address, a *What gets refused* row, and a checklist item that says to look the drug up
or to list every other spelling in `aliases` (the brand name included -- `Augmentin` would have
matched). A test reproduces the failure with the real names.

**Both importer changes are now made** (the first ask was the doc plus a verdict; the verdict was
yes to both).

**Match by address, after every name has had its exact try.** `readKnown` builds a second index,
`bySlug`, keyed by what each name reduces to: `drugSlug` of every generic and brand name, plus each
drug's own stored slug. `matchDrug` then runs two passes -- every name in the entry by string, then
every name by address -- and the order is the decision: a name the app holds exactly is a better
answer than a name that merely reduces to the same place, so an entry whose `generic` reduces onto
one drug while an alias names another outright means the one it names.

It is safe to match on for one reason, and it is the reason the refusal existed in the first place:
**the app cannot hold two drugs at one address**, because the slug column is unique. So a name whose
address is taken is a name for the drug that holds it -- there is no second candidate it could mean.
Precedence inside the index follows how strong a claim each name has: a drug's own slug is set
unconditionally (unique, so unambiguously its own), what its generic name reduces to gives way to
that, and a brand name is only indexed where nothing holds the key already. Checked against the live
260: the only key two drugs reduce to is `generic-no-brand-name`, from a seed placeholder brand
`Generic/No brand name` on folic acid, heparin and phenylephrine -- harmless because brands never
displace, and already true of the exact-name index.

What is left of the collision is one case, and it is now the table's row: **two entries in one file
reaching one address.** Matching compares against what the app held when the file was read, so the
second entry cannot see the drug the first one just created. Found while writing, named, skipped,
and the rest of the file lands -- which is the other fix.

**A report is not a refusal, and the box they share said it was.** `Problems` is rendered for a plan
and for a report, and the two mean opposite things by a problem: a refusal found while checking stops
the import, while a problem in the report is one entry that did not land out of a file that
otherwise did. The box told both *Nothing was written*, so the file that half-landed reported that it
had not -- which is the reading somebody re-imports on, and re-importing was the one thing that
would have made it worse. The note is a parameter now, and the planner's wording stays for the
planner.

Guarded statically, because it is copy in a client component and this suite has no DOM: the report's
branch must carry *everything else in the file was* and must not carry *nothing was written*, and
the planner's branch must still carry it. A narrow assertion for a narrow claim.

### Correcting a version instead of the drug (2026-11-10)

*For "correct the drug itself", if a drug is going to be changed on import by it and the drug has
variants, I want to choose what is being overwritten.*

A drug with versions has more than one thing that can be wrong, and *Correct the drug itself* assumed
it was always the drug. That assumption had a sharp edge: the correction landed on the drug's own
profile while a class's own wording went on **outranking** it wherever it had any, so the profile
read as fixed and studying that class still taught the old value. The mode most likely to be used on
a drug three lectures have already touched was the mode least able to say which of them was wrong.

So `base` now has a **target**, and the one concept it adds is *the version this import means*. The
planner already had that idea -- `plan.variant`, hard-coded to the narrowest scope -- so the change
is to let the screen name it instead, and to let `base` aim at it:

| | aimed at the drug (default) | aimed at a version |
|---|---|---|
| where the values go | the drug's own profile | that version's layer |
| the drug's own profile | overwritten | untouched |
| class and schedule | corrected | never |

Four decisions worth keeping:

- **The target must be one of the file's own scopes.** A layer keyed to a class these drugs are not
  tagged with is a layer no reader ever applies -- every one of them joins membership -- so it would
  be a write that vanishes. Refused, not ignored: a correction aimed at the wrong thing must not land
  somewhere else quietly.
- **The identity is never corrected through a version.** A class cannot differ about what a drug
  *is*, so correcting its wording is not a licence to rewrite the drug's class.
- **A drug the app has never held still takes everything as its own**, which is the existing rule and
  survives for the existing reason: there is no version of a drug that does not exist yet.
- **`from` is read off the layer, not the drug.** A preview that printed the drug's own value as the
  thing being replaced would be describing a different write from the one about to happen. Where the
  layer has nothing, the drug's own value *is* what that version reads as today, so that is what is
  shown.

Its own query rather than `allVariantLayers`, and the reason is worth writing down because it looks
like duplication: that reader joins membership on purpose, so no study session applies a layer the
drug has left. Right there, wrong here -- this import is *about to* add its scope's tags, so a drug
not yet tagged would have its layer hidden from the very preview meant to show it being overwritten.

The target is also deliberately **not** in the file format. Like `write`, it is a decision about this
database rather than a fact about the deck, and the file's author has no way to know this database
holds three readings of nivolumab already.

**And the choice is not defaulted** (same day, after the first cut shipped with one). The target
started at *the drug's own profile*, which quietly re-created the bug it was built for: the mode that
overwrites would still overwrite the drug by default, and the person importing need never notice
there was a question. So `TARGET_UNDECIDED` is its own value, distinct from `TARGET_DRUG` -- *nobody
has said* and *the drug itself* are different answers -- and `base` with nothing said refuses.

Three details carry the design:

- **Reported by the planner, refused by the apply.** `undecidedTarget` is deliberately *not* pushed
  into `plan.problems`, because the screen hides the preview whenever a problem is present, and the
  preview is how the choice gets made: it is where the versions in play and the fields at stake are
  listed. Blocking the check would leave nothing to decide with -- the scopes to choose between are
  read out of the file, so they are not even known until a check has come back.
- **Only asked when something is being replaced.** A drug the app has never held takes everything as
  its own whatever is picked, so a first load of two hundred new drugs is not stopped to answer a
  question whose answers are identical. There is always a version to choose *between*, because the
  format already refuses a file naming neither a course nor an exam -- so that half needs no guard,
  and a test pins the guarantee rather than the planner re-checking it.
- **The screen turns the button off; the server is the gate.** The client's rule reads facts off the
  last check -- drugs that already exist, scopes that exist -- and the file in the box may have been
  edited since, so `applyDrugImport` re-plans and refuses on its own. The disabled button is a
  courtesy, and the refusal names the options.

The parser still defaults `target` to the drug, which is not an inconsistency: a caller building an
`ImportFile` in code -- a script, a test -- has answered by not naming a version, and only a screen
with the question on it can have left it unanswered.

### A screen for undoing an import (2026-11-10)

*I need a way to bulk delete drugs in the case of a bad import — probably an admin area with all the
drugs and their variants listed as checks with a confirm.*

`/admin/remove`. Every drug, every version, a tick box each, a typed `DELETE`.

**Two kinds of thing on one list, because a bad import leaves two kinds of mess:** drugs that should
never have been created, and a version's wording written over drugs that were fine. The second is the
one nothing could fix before -- `/drugs/<slug>/edit` can delete a drug behind its own confirmation,
which is right for retiring one on purpose and no use for undoing twenty-four, and could not clear a
layer at all. `clearVariantLayer` had existed for months with nothing calling it; this is its caller,
and the tests are about its behaviour rather than about it being reached, because an unexercised
mutation is one nobody has checked.

Decisions:

- **A ticked version whose drug is also ticked is skipped**, and the screen says so. Deleting the
  drug takes its layers with it, so clearing one of those is a write racing its own cascade.
- **Clearing a version drops the wording and keeps the membership.** Two facts, and only one of them
  was wrong -- the same reasoning migration 0016 gives for `on delete set null`. **Reversed later
  the same day** for the class and exam tags that arrived with the version; see [A version's tags go
  out with it](#a-versions-tags-go-out-with-it-2026-11-10).
- **Tick every drug shown** is the control the screen exists for. Undoing a bad import means
  filtering to the tag it created and taking all of them, and doing that by hand twenty-four times is
  how the twenty-fifth gets missed.
- **The count is over every tick, not the shown ones.** A filter changing is not a reason for a tick
  to be forgotten, and a number that moved while you typed would be the one thing on a destructive
  screen nobody could trust. **The submission was not**, until later the same day, which is how a
  hidden tick deleted a drug nobody meant to delete; see [The panel deleted a drug nobody
  ticked](#the-panel-deleted-a-drug-nobody-ticked-2026-11-10).
- **One drug at a time, reporting per row.** `applyDrugImport` is not transactional either, and here
  it is the better behaviour rather than a compromise: a stale row -- two admins, or a double submit
  -- must not abandon the rest of the list, so each failure is named and the others still go.

**A class is a tag like any other on it** (same day, after the first cut). The filter was a single
select labelled *On a list*, and PHRM 535 was in it -- the facet is built from every membership, of
every kind -- but a course tag sitting in a box that says *list* tells the person undoing an import
that what they came for is not there. Worse, one at a time: an import tags what it touches with a
course **and** an exam, so *PHRM 535 and Heme/Onc Exam 3* is the exact slice a bad one left behind,
and a single select could only ever show half of it.

So it is the drug list's control, not a second design: add-and-pill, grouped by `TAG_KIND_GROUPS`,
an `and`/`or` toggle printed between the pills, and `matchesTags` as the shared rule -- `all` by
default here for the same reason as there, except that it matters more, because this list is what
gets deleted. Each tag on a row is also a button that adds itself to the filter, which is the motion
the screen is for: you find one drug an import should not have touched, and what you want next is
every other drug it tagged the same way. The count beside each option (*PHRM 535 (25)*) is the size
of the mistake, which is the thing to see before ticking two hundred boxes.

The guard is static, because the filtering is client state and this suite has no DOM. What it pins is
not that filtering works -- `matchesTags` is tested against real rows in `browse.test.ts` -- but that
this screen keeps asking the shared rule: a deletion list quietly filtering by *any* while the drug
list filters by *all* would mean pressing **Tick every drug shown** and taking more than was meant.

No soft delete, following `deleteDrug`'s existing reasoning: a `deleted_at` flag would have to be
filtered out of browse, search, every study scope, the card builder and the quiz pool, and forgetting
one means a deleted drug still being asked about. The safety net stays `/admin/data`, which exports
the whole database as one file, and the screen says so above the list.

### The guide now asks for a capitalised drug name (2026-11-10)

The guide said *the generic name, as the deck writes it: `"nivolumab"`*, and slide decks write generic
names in lower case. So the Heme/Onc import created 24 drugs -- `ipilimumab`, `talimogene
laherparepvec`, `interleukin-2` -- into a library whose other 236 all carry a leading capital. The
browse list shows both, interleaved and visibly inconsistent.

Nothing in the app was at fault: `createDrug` trims the name and stores it, and every screen prints
it back. There is no case-tidying anywhere, which is the right call -- a drug name is not a sentence
and no rule the code could apply knows that `"Fentanyl Transdermal Patch"` keeps three capitals while
`"Mycophenolate mofetil"` keeps one. So the fix is the instruction, not a normaliser.

The rule written down: capitalise the first word, leave the rest as the deck writes it, keep the
capitals a name has earned and invent none. Matching is case-insensitive -- `lower()` on both sides --
so getting it wrong never creates a duplicate drug; it only looks careless, which is exactly why a
guide has to ask for it rather than a refusal catching it.

Two places the examples had to follow, or the guide would contradict itself the way the `route` table
did: every `"generic"` in the worked example, and every regimen `"drug"`. The second is not cosmetic
-- `renderRegimen` prints a component's name **verbatim** into the Regimens field of every drug in
the protocol, so one lowercase component reads as `- ipilimumab — 3 mg/kg IV…` on four profiles. The
live database has exactly that.

Left alone: the 24 names already written. Renaming is a data change nobody asked for, and the slug --
which is what every URL and every card key is built on -- is derived from the name.

### A variant carries tags; a tag is not a variant (2026-11-10)

*Variants are getting written incorrectly — when it applied the PHRM 535 and Heme/Onc tags to
ipilimumab at import, it split them into a single copy per tag. It is meant to be that variants have
their own applied tags, not tags each constituting a variant.*

The **write** side was already right, which is worth stating first because it narrows the bug:
checked against the live database, the whole import produced exactly **one** layer -- prednisone, on
`heme-onc-exam-3`, the narrowest scope -- and ipilimumab got none, because the lecture worded nothing
about it differently. No copies were written.

**What was wrong was the profile.** `variantOptionsFor` returns one option per course or exam tag the
drug is tagged with, which is *membership*, and the Versions card printed every one of them as a
version. So ipilimumab, correctly tagged with the class and the exam, answered with two versions of
itself for a lecture that had agreed with the drug about everything.

And the rule it was breaking was **already written down twice in this codebase**, which is what makes
this an inconsistency rather than a design question:

- `numberedVariantsByDrug`: *a class that says nothing of its own is not another version of the drug,
  and offering it would be offering a choice that changes nothing.*
- `lib/drugs/browse.ts`: *only variants with stored values appear, so a drug merely tagged with a
  class is not a drug with another version.*

The browse count and the study pills had always obeyed it. The profile sidebar was the one place that
did not -- it already had `n` to tell the two apart, and used it only to decide whether to print a
number. So versions are now the ones that have said something, and the classes that have not are
offered to **admins only**, below a rule, as *write one* rather than as a version to read. A reader
with no admin rights sees no Versions card on a drug no class words differently, which is the honest
answer: there are none.

### The other half: the file's scope is the version's tags (2026-11-10)

Fixing the display alone would have left the deeper half of the owner's sentence unimplemented. A
lecture scoped to a class **and** an exam writes one layer, on the narrowest -- so studying Heme/Onc
Exam 3 read the lecture's wording while studying PHRM 535, the very class the lecture belongs to, read
the drug's own. One import, two answers to *what does this class teach*.

`drug_tags.variant_tag_id` is the column for this and has been since migration 0016 -- *on this list,
read the drug as that class words it* -- and `membershipVariants` already consumes it, so the study
path needed no new code. Only the importer was never setting it. It now points every other scope tag
at the layer it wrote, which is precisely *the variant having tags applied to it*.

Three decisions inside that:

- **Scope tags only.** Not `top-drugs-2026`: a curated syllabus must not have its wording hijacked by
  whichever lecture was imported last. The variant's tags are the ones the file declared as its scope.
- **Only where nothing is pointed yet.** A pointer set by hand on the tag screen is a curation
  decision, and re-running a lecture must not quietly undo it.
- **Set because the layer exists, not alongside writing it.** A second import of the same lecture
  writes no values -- they are all identical already -- so a pointer set next to a fresh write would
  never reach a drug imported before this existed. `pointTagsAtVariant` checks the layer itself and
  does nothing where there is none, which makes it safe to call for every drug and makes the import
  converge instead of only working the first time.

One thing found and left alone: re-importing a lecture whose wording genuinely differs from the drug
reports `toVariant` again each run, because `unchanged` compares against the drug's **own** value and
the lecture still disagrees with it. Nothing changes -- `patchVariantLayer` keeps the envelope of a
value whose text is the same -- so it is the report overstating a no-op rather than a write. Recorded
rather than fixed, because the fix is a second comparison against the layer and nobody has asked for
the count to be exact.

### Import it did nothing, and a submit button nobody read (2026-11-10)

*The actual import button in the drug import isn't working.*

It wasn't. The screen's two buttons post the same text and differ only by their own name and value
-- `intent=plan` and `intent=apply` -- which is a deliberate design and written down as one: *what
gets imported is always the text in the box rather than a plan held somewhere from a minute ago*.

But a submit button's name and value are contributed by the **submission**, not by the form's
controls, so `new FormData(form)` leaves them out. `submitTo` built its FormData that way, so
`intent` was never in it, `String(null) !== 'apply'` took the default branch, and **Import it**
planned the file again. The worst shape a bug can take: the button worked, the request succeeded, the
preview reappeared, and nothing said anything was wrong -- because a fresh preview is exactly what
`intent` being absent means.

Fixed in the helper rather than in that form, by handing `FormData` the submitter. The import screen
was the only form in the app that branches on which button was pressed, so it was the only one
affected -- but the next one would have inherited the same silence, and the helper is where the
reasoning about form submission already lives.

The guard is static, like the one above it about form actions and for the same reason: the condition
is *the helper passes the submitter*, which no node test can observe through a real DOM. It was
checked by reverting the fix and watching it fail, which is the only thing that makes a static guard
worth having.

### Tags on the drug list, and several at once (2026-11-10)

*The drug list page search filters should have one for tags like top drugs 2026, and should be able
to && search with like top drugs 2026 && heme/onc.*

There was a tag filter. It had never once been visible, which is the same thing as not having one.

The rail hides a control whose options cannot narrow anything -- `options.length > 1` -- and that
rule is right for schedule and for route, because those **partition** the drugs: if every drug in
the database is `IV`, filtering by `IV` is a no-op and the control is noise. It is wrong for tags,
because a tag **marks a subset**. The question is *which of these are on that list*, and it is worth
asking of one tag as much as of ten. With exactly one tag in the database the control vanished.

So tags show at `> 0`, like `blank` immediately above them, which marks a subset too.

**The axis takes several, and means all of them.** Browse defaults to the intersection where the
study screens default to the union, and the difference is the job rather than a slip: a study scope
*collects* material to revise, where *Exam 2 and Exam 3* means both and an intersection can hand back
an empty deck; a browse filter *narrows*, like every other control on the rail, and an over-wide
filter is only a longer list to read. The operator is a button printed between the pills -- you read
the filter as *Top Drugs 2026* **and** *Heme/Onc Exam 3* -- and it is named for the non-default
(`tagsany`) so the default carries nothing in the URL and every `?tag=` link already out there still
means what it did.

Add-and-pill rather than a column of checkboxes, because the rail is 15rem wide and the list is
sixty-seven long once the categories are seeded: the picked few belong on screen, the rest behind the
select, and the select empties itself after each pick so it reads as *add*.

The axis stays a comma-joined **string** rather than becoming an array, and that is the shape of the
whole filter object rather than laziness: three loops walk it generically -- the URL sync, the *is
anything on* check, the advanced-filter count -- and they only stay generic while every value is
falsy when unset. An empty array is truthy, and would have left the rail permanently in its filtered
state. A comma cannot collide with `[a-z0-9-]`.

The predicate moved to `lib/tags/constants.ts` so it could be tested at all -- it was four lines
inside a 600-line client component, reachable by no test -- and so the two screens that ask this
question cannot drift into answering it differently.

### A route written either way, and what the guide got wrong (2026-11-10)

The guide's field table called `route` a **list** and the worked example wrote it `"route": "IV"`.
Both were defensible and together they were a trap: `list` is the field's *type*, and the two core
list-typed keys -- `brand` and `indication` -- genuinely are arrays in a file, because they are
columns of their own named at the drug level. `route` is the only list-typed field that lives inside
`fields`, where every value was a string. So the table implied a spelling the reader refused.

**What the reader actually did, checked rather than assumed:** an array was *refused*, not dropped --
`drugs[0] (nivolumab).fields.route: A value is a string, null, or an object with a "value"` -- and a
single problem anywhere blocks the whole file, so nothing was written. Worth recording because the
bug report said the opposite (every drug imported with no route), and the live database agreed with
the code rather than the report: 236 of 236 drugs hold a route and there were no variant layers at
all. The file never landed. A refusal that is read as a silent failure is still a reporting problem,
but it is not the one it looks like.

**An array is now accepted anywhere a value is**, folded to the one string the column holds. Joined
with a newline, not `"; "`, and that was checked against the data rather than chosen: the drugs
already in the database that are given more than one way store `IV\nIM` and `IV\nIM\nSubcutaneous`,
because that is what the drug form's *one per line* textarea writes. So an imported route and a
typed one are the same bytes. `["IV"]` and `"IV"` are byte-identical too, which is what lets a file
be rewritten from one spelling to the other without the next import reporting an override.

**The type cannot be checked at parse time, and that is deliberate rather than missing.** A parse has
no database, and an existing field's type is known only once the plan reads it. So an array is taken
for any field, the same latitude a string already has -- nothing has ever stopped `"IV; PO"` going
into a markdown field. What *is* checked is the shape: every item a non-empty string, and the item
number named when one is not; an empty list refused in the same words as an empty string, since both
say neither *none* nor *not said*; and the refusal says what arrived (`This is a number.`) because
the old message only said what it wanted.

The guide also told people to declare a `boolean` field. The reader knows `bool`, and would have
refused it -- a second contradiction in the same table, found while fixing the first. The refusal
message already lists the real types, so the test now pins the wrong spelling to that message.

### Several lists at once, and which operator they mean (2026-11-09)

*I'd like the ability to select multiple tags in the flashcard and quiz creation menu, so it's
something like top drugs && cephalosporin antibiotics.*

The example already worked, and that is worth saying first: therapeutic categories are their own
axis, and across axes the rule has always been **and** -- *Top Drugs 2026* plus the *Cephalosporins*
category is the cephalosporins within that list. What did not work was the literal ask, because the
lists axis was a single `<select>` while `scope.tags` had been `string[]` all along.

So the axis became a `ScopePicker` like the two beside it, which brought the filter box, the count
summary and the *N picked -- up to M drugs* line with it for free. `ScopePicker` gained **groups** to
make it work: *Top Drugs 2026*, *P2*, *PHRM 535* and *Heme/Onc Exam 3* are four different questions
and a flat list of sixty reads as one. Grouped by a Map in the caller's order rather than by sorting,
so the headings stay widest-first instead of alphabetical.

**The operator is the real decision, and it is a control rather than a guess.** Within an axis the
rule is *any*; across axes it is *all*. That holds everywhere else because a drug has one class and
one list of uses, so *any* is the only reading that makes sense. It breaks on lists, which now hold
four kinds of thing at once:

- *Exam 2 and Exam 3* means the union -- you are revising both.
- *Top Drugs 2026 and PHRM 535* means the overlap -- the class's drugs that are also on the syllabus.

One fixed operator is wrong half the time, so the axis says which it is: a checkbox reading **only
drugs on every one picked**, visible next to the boxes, because an operator you cannot see is worse
than one you cannot change. It appears only once two are ticked -- with one pick the readings agree,
and a control that changes nothing is a control you have to think about for no reason.

Default `false`, which is load-bearing rather than arbitrary: saved setups are stored as JSON and one
written last week has no `tagsAll` in it, so the default *is* the behaviour of every setup already
saved. A single `tag=` still parses, so old links keep working too.

### A lecture's fields fold away (2026-11-09)

*Are additional fields showing up in their own collapsible dropdown so they don't clutter up the top
drugs specific information?*

They were not -- one flat row of checkboxes, the sheet's columns and anything an import declared
side by side. Which mixes two different study sessions: *what are the top drugs* and *what did one
class say about twenty of them*.

Told apart by `yearLevels`, which turns out to be the honest line the data already draws: a program
year is responsible for every column of the sheet, and for nothing a lecture declared -- the importer
sets `yearLevels: []` deliberately, and said why at the time. So *Added by a class* holds `regimen`
today and every imported field hereafter, folded shut.

A closed `<details>` still submits the boxes inside it, which is what makes folding safe -- the same
property the scope axes rely on. The summary counts the ticked ones and the section opens itself when
any are, so a folded field can never be a card in the deck you cannot see.

### The versions moved to the right, as pills (2026-11-09)

*Put the variants and compare on the right where the associated tags are displayed, in the same
format.*

Third placement for this control, and the first one that is obviously right. It began as a row of
pills at the top of the page, became a dropdown because a drug in two classes with three exams
apiece turned that row into a second navigation bar, and is now the same pills in the sidebar
column.

**The earlier objection was to the top of the page, not to pills.** A column absorbs eight wrapped
pills without pushing anything down, which is why the same shape that failed above the profile works
beside it. And sitting under the tags, it reads as the answer to them: the tags are the classes this
drug is in, these are what those classes say.

Links rather than a control, which the dropdown could not be: every version is already a URL, so the
client component and its `router.push` are gone and `?as=` is the whole of the memory. `.pill-on`
marks the one in force and `.pill-soft` quiets the neighbours' hover -- the same vocabulary the top
bar and the colour-axis switcher use for exactly this, a row where one pill is already filled.

The **table** stays in the main column, where there is width for it. *Compare all* is a pill like
the rest; what it opens is forty-odd characters across four columns, which a 15rem rail cannot hold
without becoming unreadable. Controls on the right, the thing they open in the middle.

### An identical value is not an override (2026-11-09)

Found by testing something that had never been tested: running the same import file twice.

`applyDrugImport` is not one transaction -- it declares the fields, then the tags, then writes the
drugs one at a time -- so the recovery path for a half-finished import is to run the same file
again. Nothing verified that a second run was safe.

It was not. The `unchanged` check sat *below* the `variant` branch, so in `variant` mode a value that
agreed with the drug word for word was still written into the class's layer. The class then claimed
its own wording for a field it worded identically; the profile offered a version that changed
nothing; the browse row grew a `V-1` for it. A re-run did it to every field at once -- five values in
the test, seventy-six in the melanoma deck.

Fixed by checking *the drug already holds this* before deciding anything is an override, which
restores the rule the rest of the feature is built on: **a class that says nothing of its own is not
another version of the drug.** `base` stays above the check deliberately -- *correct the drug itself*
is an instruction to rewrite, provenance included.

Three things the new tests pin, all of them behaviour I got wrong when guessing and had to read the
code to state correctly:

- A **new** drug's values go to the drug itself whatever the mode says, because a drug that exists
  because of this lecture has no curated profile to differ from. A layer would leave its own profile
  blank.
- In `variant` mode an existing drug's **gap** goes to the layer, not the drug. That is the whole
  difference from `fill`, and the reason the screen makes somebody choose.
- A layer is written to the **narrowest** scope in the file -- the exam, not the class.

### Every version side by side, from the dropdown (2026-11-09)

The variant index, placed where the owner put it: *its own thing at the top of the drop down, and
default to the first variant still.*

Proposed as a per-tag admin screen — *what did Heme/Onc Exam 3 write?* — and sited instead as an
entry in the control that already exists for choosing a version. That is the better call for a
reason worth writing down: a reader comparing versions is **already on the drug**, and a screen
reached from the tag admin page would have asked them to leave, pick the class, and find the drug
again. The dropdown is where the question is asked, so it is where the answer belongs. It also costs
no navigation: no bar entry, no route, one more `?as=` value.

`?as=~all` rather than `?as=all`, because a tag slug is `[a-z0-9-]` with no leading dash and a `~`
therefore cannot collide. A sentinel a user can hit by naming a class badly is not a sentinel.

**Not the default, deliberately.** It sits above *The drug's own profile* and the select still opens
on the drug's own. Landing on a comparison would put *how do these differ* in front of somebody who
opened the page to read what a drug does — and the table is the rarer question, asked on purpose.

Three rules about what the table shows, all the same rule: say the difference, not the data.

- **Only fields some version words its own way get a row.** Forty rows where every column repeats
  the drug's own value is a wall with the answer hidden in it. The count of untouched fields goes
  underneath, so nothing vanishes silently.
- **Only versions with a stored layer get a column.** An empty column implies a class disagreed when
  it has simply not been written up.
- **An absent key says "Same as the drug's" in words.** It is a different fact from a class
  recording that there is *none*, and both would otherwise render as an empty cell. `overlayFields`
  is the code that treats them differently; the table has to as well or it misreports it.

### V-n is the version, and the base profile is not one of them (2026-11-09)

Asked directly, and worth settling in writing: **V-1 is the first *variant*, not the drug's own
profile.** The base profile has no number — it is *The drug's own profile* in the dropdown and no
pill at all on a card. Numbering runs 1..n over the versions that have a stored layer, in overlay
order.

The alternative — base as V-1, first variant as V-2 — was considered and is worse for one concrete
reason: every drug would be V-1, so the browse pill would read `V-1` on all 236 rows and mean
nothing. The pill earns its place by being absent when there is nothing to say. Numbering the base
also implies a parity that does not exist: a variant is a layer *over* the drug, not a sibling of
it.

Two consequences now made true rather than assumed:

**A class with nothing of its own is unnumbered, not numbered-and-skipped.** It appears in the
dropdown (the drug is tagged with it, and *it says what the drug says* is a true answer) with no
number. Numbering it would make the next version V-2 in the dropdown and V-1 on a card.

**The dropdown shows the number.** It did not, which made the numbers useless in the one place they
were meant to be used: a card said *V-2 PHRM 535*, you opened the drug to find it, and the control
did not answer to that name. `variantOptionsFor` now carries `n`, numbered by the same two rules
`numberedVariantsByDrug` follows, and a test asserts the two agree rather than a comment claiming
they do.

**One `V-n` that is a count, not an index:** the browse pill. `V-3` there means *three alternate
versions exist*, which is what it was asked for. It reads like an identifier beside a card's `V-2`
and is not one. Left as it is, on the owner's spec, and noted here so the next person does not
"fix" one of them into the other.

### A layer outlives its membership, and had gone on being applied (2026-11-09)

Found while checking whether V-2 really does mean the same thing everywhere. It did not, in one
case, and the case was worse than a label.

Untagging a drug from a class leaves the stored layer behind — deliberately: the work is expensive
and the untagging may be a mistake. `variantLayerFor` already refused to serve such a layer, with a
comment claiming this *"keeps the picker and the browse filter in agreement"*. It did not. Neither
`numberedVariantsByDrug` nor `allVariantLayers` joined through `drug_tags`, so an outlived layer was
still counted on the browse row, still numbered, still offered by the list builder — and, the real
defect, **still applied by study sessions.** A drug removed from a class went on being taught in that
class's words, with no screen on which to notice.

Fixed by making membership the single gate: all three readers now join `drug_tags` on
`(drug_id, tag_id)`. Nothing is deleted, so the layer comes back intact if the drug is re-tagged —
which is the behaviour the original decision wanted and only half implemented.

The lesson is about the comment rather than the join. *Keeps X and Y in agreement* was written as an
observation, not checked, and three functions later it was false. A test asserting the agreement
would have failed the day the second reader was written.

### The bar had already lost the button (2026-11-09)

*The class sets button in the top bar should be gone since that whole system doesn't exist anymore.*

It was, already — `{ href: '/sets', label: 'Class sets' }` came out with the routes it pointed at,
which is most of why the bar fits half a screen now. It was still on screen because the running
container is the image built before any of this, which is the standing hazard of developing against
a built image: **the app you are looking at is a release, not the working tree.** Worth recording
because it will happen again and the answer is always the same one line of compose.

### Scrapped: the imported sets section (2026-11-09)

Owner's call, the same day the re-cut above was written up: *scrap the whole imported set feature,
it's not worth finishing at this rate.* So it is gone — the screens, the parser, the importer, the
adapter, the tables, the nav item, the authoring guide, and the bulk delete built an hour earlier.
What is left of it is this record and the migration that takes the database back.

**Why it is the right call, said plainly.** The section was two days old and had already been
redesigned once before it was finished: a table model justified entirely by generated distractors,
then a static-quiz re-cut that scrapped most of that justification, then a fork about what
flashcards even are. Three designs and one real imported set is a feature paying rent in decisions
rather than in studying. The drug section — 236 drugs, the dosing bench, the pairing queue — is the
thing being used, and the honest reading of *at this rate* is that attention spent on a second body
of material was being taken from the first.

**What went.** `app/sets/` and `app/admin/sets/` (nine files), `lib/sets/` (ten modules, ~2,100
lines), `docs/set-format.md`, and nine test files — `set-batch`, `set-delete`, `set-format`,
`set-import`, `set-render`, `set-scope`, `set-study`, `set-tree`, `study-subject` — which were 178
of the suite's 1,069 tests. The suite is 47 files and 891 tests, green.

**Migration 0013 takes the database back**, reversing 0011 and 0012. It is hand-written because the
order matters and two steps throw data away:

- A schedule or an answer **about a set item is deleted**, because it has nothing left to point at
  once the rows are gone. This is the one irreversible step in the whole removal.
- `study_cards.drug_id` and `quiz_answers.drug_id` go back to `not null`, which is only possible
  after that delete, and the one-subject check constraints go.
- `item_id` goes from both, and `distractor_rung` from `quiz_answers` — there is no ladder to record
  a rung of.
- `study_cards_unique` goes back to the plain `(user_id, drug_id, card_key)`. 0011 had to write it
  by hand as a coalesce over the zero uuid, because nulls are distinct in Postgres and a nullable
  `drug_id` would have stopped the index constraining anything; with `drug_id` not-null again the
  coalesce protects against nothing, and Drizzle can express the index itself. Dropping `item_id`
  usually takes the old index with it, since the index is over that column — hence `if exists`.
- `set_items`, `set_fields` and `sets` are dropped, children first by hand rather than with
  `cascade`, so a reference added since would break loudly instead of being quietly swept up.

**A past attempt keeps its score**, exactly as the single-set delete already decided: the person did
sit the paper, and deleting attempts that merely touched a set would take a mixed paper's drug
questions with it. **The audit log keeps its `set.import`, `set.reimport` and `set.delete` rows** —
they are a record of things that happened, and `target_type` is text, so nothing dangles.

**Verified on a seeded scratch database rather than only on a fresh one**, which matters because the
test database migrates from zero and so never exercises the two deletes: a container at 0012 with a
set, a column, a row, one drug card, one set card, one drug answer and one set answer. After 0013 —
one card, one answer, the attempt still scoring 5, no set tables, no `item_id`, no `distractor_rung`,
both `drug_id` columns `NOT NULL`, and `study_cards_unique` back to three plain columns.

**What the engine keeps, and it is the one thing worth keeping.** `StudySubject` / `DRUG_SUBJECT` in
`cards.ts` stay. They were written so a set of hormones could ask *Which hormone?*, but what they
actually did was give a name to the place the engine knew it was about drugs — the identity column,
the identity question, and the sharper question the brand/generic pair wants. One value now, and the
optional overrides are gone from `buildCards` and `QuizOptions`; the shape stays because it is where
that wording is written down. `priority.ts` keeps `subjectId` rather than `drugId`, which is honest
either way: that file is arithmetic over a history and does not need to know what the id names.

**Everything else reverted.** `recordGrade` and `recordAttempt` lost their `subject: 'drug' | 'item'`
parameter; `questionWeights` stopped coalescing two columns; `lib/data/backup.ts` lost the two
skip-and-say-so branches, so the export's *sets are not in this file yet* gap is closed by there
being no sets; `SessionRunner` lost the `onGrade` and `emptyHint` props that existed only so a set
page could pass its own; the *Class sets* nav item and the `/admin/sets` admin card are gone; the
home page no longer promises *and more*; `tests/chrome.test.ts` lost its six set screens; the README
lost the section and the two tree lines.

**If it ever comes back**, the design is not lost: *A second section: imported sets* has the
reasoning for every identifier, and *Sets, re-cut for a static quiz* has the static-quiz design and
the fork it was waiting on. The thyroid set's own file is still wherever it was authored, and git
holds every deleted module. What would be lost on a revival is the SRS history, which this
migration deletes — a handful of schedules on eleven rows.

### A course says it differently (2026-11-09)

**Generalised the same day — see *A class, an exam, a topic*.** Every argument below still holds; the
names moved. A course is one of three kinds of scope that can carry one of these, the table is
`drug_variant_values`, the module is `lib/drugs/variants.ts`, the route is
`/drugs/[slug]/variant/[variant]`, and the pill row described at the end is a dropdown.

Asked for straight after the scrap, and it is the same need arriving from the other side: *keep this
just for drugs instead of ancillary study info for classes. To achieve that, add a subclass type to
drug profiles so I can have variations of a drug profile for different classes. They are likely to
have the same info, but they will be specific class sourced.*

**The word "class" is already taken, twice, and the one that wins is the one already in the
database.** `drugs.drug_class` is the FDA Established Pharmacologic Class — the colour axis, the
near-miss axis, `scope.classes`. What the owner means by a class is a course they are taking, and
`tags.kind` has had a `course` value since migration 0000. So the code and the screens say
**course** throughout, and nothing collides.

**That decision is most of the feature.** A class is a `course` tag, which means membership is
`drug_tags`, the browse filter already groups courses as their own axis, and the study scope's list
dropdown already offers every non-system tag. None of that needed a line. What was missing is the
only genuinely new idea: a course's own **values**.

**A layer, not a copy** — `drug_course_values`, one row per (drug, course), holding only the fields
that course says differently. This is the whole design and it follows directly from *they are likely
to have the same info*: a copy of 236 drugs' profiles per class means every correction made twice,
and the second one forgotten. A layer means fixing the base profile fixes every class's view of it,
and `tests/course-profile.test.ts` pins that as a test rather than a hope — improve the drug's black
box warning and read it back through a class that never mentioned it.

So the reading rule, in `lib/drugs/course-values.ts`, is per **key**:

- A key the course does not mention is not blank, it is **the same**.
- A key whose stored value is null is skipped rather than applied, or *this class does not mention
  it* would quietly **erase** the drug's value — the one bug that would make the whole thing
  untrustworthy, and a test of its own.
- `status: 'none'` *does* apply, because "nothing to record" is an answer rather than a gap, which is
  the rule the sheet's `blankMeansNone` fields already follow one table over.
- Layers apply in the order given, so the last wins. Only reachable by studying two courses at once;
  written down rather than left to `Object.assign`'s accident.

**Same `FieldValue` envelope as `drugs.fields`**, and that is what makes the profile need almost no
new code: the formatter, the flag button and the *from …* provenance line all work unchanged, so a
course value says *from PSCI 413 — 14.Thyroid.pdf* on the page without the page learning anything.
One `source` for the whole layer rather than one per field, because the answer to *which class, and
from what* is the same for every fact read off the same deck.

**Core fields cannot be overridden, and that is a boundary rather than a gap.** `generic`, `brand`,
`indication`, `drug_class` and `controlled` live in their own columns and link rows, and a course
claiming a different generic name is not a variation of a drug, it is a different drug. Brands and
indications are entities with their own pairing rules, so a class differing on those is a larger
change, deliberately not this one. A core key in the payload **refuses the save** rather than being
dropped quietly: it can only come from a bug in the form, and a form that writes nine of ten fields
and says nothing is worse than one that stops.

**It changes the values, never the card.** `card_key` is built from field keys, so a mechanism
studied through a class is the *same card with the same schedule* as the drug's own. That is the
decision worth defending: the alternative is a second kind of study subject, which this database had
for exactly one day and dropped in migration 0013. Pinned by a test comparing the two card keys.
What the course changes is what the card says.

**The screens.**

- **The profile grows a pill row** — *Drug profile*, then one pill per course, each with the number
  of fields that course says differently, because *this class has its own wording for 3 fields* is
  the thing worth knowing before clicking. Shown only where the drug is in a course; a row holding
  one pill called *Drug profile* is a control that does nothing. Reading through a course marks each
  overridden row with the course's name, since a course profile and the drug's own otherwise look
  identical and seeing the difference is the entire point of opening it.
- **`/drugs/[slug]/course/[course]` edits one class's version**, and is a screen of its own rather
  than a layer switch inside the drug editor. That form owns the drug — its brands, its indications,
  its dosing prose and the regimens parsed out of it — and none of those can be differed on, so this
  is a list of exactly the fields that can be: the drug's own value shown quietly beside a box for
  what this class says instead. **An empty box clears the override**, which is the only reading that
  makes the fall-through work, and the screen says so. A box typed identical to the drug's own value
  gets a nudge rather than a refusal — a class really can source the same sentence separately.
- **Both study screens say what picking a course does**, in one line under the list dropdown. The
  dropdown already offered courses and silently studied the sheet's wording, which is the kind of
  thing nobody discovers.

**It joins the backup**, unlike the sets section ever did. A course layer is hand-typed off a slide
deck, so it is exactly what a backup is for — nothing re-derives it. Keyed by the course's tag slug,
like every other natural key in that format, and the restore replaces a drug's layers wholesale
rather than merging field by field, for the reason the regimens already do: a layer is one statement
about one drug, and half of two versions is a profile neither file described. **Absent is not
empty** — a file written before today says nothing about courses and must not wipe layers typed
since, while an empty array *is* an instruction and clears them. Both pinned.

**Found while building it, and worth the warning.** `CORE_FIELD_DEFS` is the whole sheet field set —
mechanism, dosing, the black box warning — and only five of its rows are `isCore`. Building the
"cannot be overridden" set from all of it made *every* field unoverridable, and the symptom was a
save that reported success and stored nothing. The name reads like it means the core ones; it means
*the defs the sheet defines*.

**Verified:** `tsc` clean, `next build` clean, and the suite at **48 files / 923 tests**, of which 28
are new in `tests/course-profile.test.ts` and 4 in `tests/backup.test.ts`. Not yet exercised in a
browser — it needs `docker compose up -d --build` to be visible at all.

**Still worth doing, and small:** a screen listing everything one course says of its own (the
`drug_course_values_tag_idx` index is there for it), so a class's work can be reviewed in one place
rather than a drug at a time; and the browse list showing a course's own values when a course filter
is on, which today shows the drug's.

### The dosing review bench (2026-11-03)

The one queue in this app that has ever had real work in it. **76 of 252 regimens** carry a reading
the parser would not stand behind, across **72 drugs**, and until this screen existed nothing listed
them — known and unreachable at the same time, which is the worst state for a to-do to be in.

It is a queue rather than a report, which is the whole design. Every row opens onto the two things
that settle it:

- **Rewrite the prose**, which re-reads it. The readback is live while you type, because the parser
  is pure and client-safe, so what is on screen is the reading the save will store rather than an
  approximation of it. The indication form is explained right there, under the box, since it is the
  one screen where somebody will want it and an unmentioned syntax is an unusable one.
- **"The source really is like that."** Seventeen of these drugs are dosed *individualised* or
  *titrated to effect*, which is the true answer and has no sig. Saying so leaves the wording
  untouched and takes the row out of the queue — because *nobody has looked at this* and *somebody
  looked and this is the answer* are different states that otherwise look identical. The page says
  out loud that emptying the queue is not the goal, since a third of it should end this way.

Both go through `setDrugField` + `rebuildRegimens` and `setDosingUnique` — **the drug editor's own
writers, in the drug editor's own order**. One parser, one writer, one audit trail whichever screen
you came from; a bench with an insert of its own would be a second way for dosing to reach the
database and the two would drift. A test asserts `app/admin/dosing/actions.ts` contains no
`db.insert` or `db.update` at all, and that `lib/dosing/bench.ts` contains no write of any kind.

**Three kinds, worst first, and "worst" is what it costs to leave:**

1. **Indication not recognised** — a dosing line names a condition the drug is not recorded as being
   for. The only kind where the *data* is wrong rather than merely unread, and the fastest to fix.
2. **No sig at all** — nothing machine-readable came out, so multiple choice cannot ask it. 36 rows.
3. **Read, with a caveat** — components came out and the parser noted something. Often needs nothing
   but a human saying so. 36 rows.

Within each kind, **the drugs somebody has actually been asked about lead**. That is the rule the
flagged queue states for fields, one table over: a bad reading that has already reached a person
costs more than one that has not. Counted off `quiz_answers` by a key match on `dosing`, which also
catches the branch-keyed questions the indication split introduced. Everything untouched falls back
to alphabetical, which is where the queue starts life with one user and no history.

Collapsed rows, because 72 prose boxes with live readbacks is a page nobody scrolls and a queue's
first job is to be countable. Three figures at the top: rows to look at, rows settled, and drugs
whose dosing is split by indication.

Verified on the running container: 76 / 176 / 1 on the figures, the filters returning 36, 36 and 0,
a bogus `?kind=` falling back to everything rather than erroring, no form action on the page, and
the write path exercised end to end on Midazolam — queue 76 → 75 on marking it read, back to 76 on
undoing it, with the row restored exactly. (Left as it was: Midazolam's *Individualized* dosing
stays ungated by the owner's standing decision.)

### A dose can belong to one indication (2026-11-03)

Raised by the owner: *sildenafil being in two brands both on top drugs with different dosing means
that needs to be fixed*. It did. The sheet gives sildenafil one dosing line — *20 mg by mouth three
times a day* — which is **Revatio's** pulmonary-hypertension dose. **Viagra's** *50 mg an hour
beforehand* was recorded only on the brand row, where the profile shows it and no card or question
ever could. So the app drilled the less familiar half of a drug whose two brands are both on the
list, and never mentioned the other.

**The branch lives in the prose, not in a column somebody ticks.** Dosing prose is the source and
`dosing_regimens` is a *reading* of it, replaced wholesale every time the prose is edited — so an
indication assigned beside those rows would be lost on the next re-read, which is the "leave this
one alone" flag the old comment in `rebuildRegimens` anticipated needing. Putting it in the sentence
instead means there is still one source of truth, and the branch is where the person editing the
dose is already looking:

```
Pulmonary hypertension: 20 mg by mouth three times a day

Erectile dysfunction: 50 mg by mouth 1 hour prior to sexual activity
```

`parseDosing` recognises that form **only** when every non-blank line is `<words>: <dose>` and no
heading is one of the phase words the step segmenter already owns (*Initial*, *IV bolus*,
*Continuous infusion*, *Extended release*). All-or-nothing is what makes it safe to add to a parser
with 236 live inputs: the five colon-bearing dosings the sheet ships are all phases or product forms
on a **single line**, so nothing that already exists can be misread, and nothing half-written is
half-read. Each branch is then parsed by the same function — one level of recursion, which cannot be
more, since a branch has no newline and the form needs two lines to be recognised — so alternatives
and sequences go on working inside a branch with no second implementation.

**A branch that cannot be read keeps its place.** This is the whole-prose rule applied one level
down, and sildenafil is why it has to be: the pulmonary branch reads cleanly, and *50 mg by mouth 1
hour prior to sexual activity* does not, because "1 hour prior to sexual activity" is a timing the
model has no shape for. Weakening the parser to fit one drug is exactly what it refuses to do — but
failing the pair would have thrown away the good branch *and* the split, which was the thing being
fixed. So a refused branch stores as one row with no components carrying its own wording, and the
whole dosing is `refused` only when every branch was.

`dosing_regimens.indication_id` points at **`drug_indications`**, not at the shared vocabulary, so a
dose can only be filed under an indication *this drug has* — the same choice `brand_indications`
made, for the same reason. The heading is matched through the alias table, so a line written
*Seizure* reaches the row stored as *Seizures*. A heading that matches nothing is **not** dropped and
not guessed at: the row stores with no indication and says so in its review notes, which is how it
reaches the dosing bench rather than quietly becoming a dose for the whole drug.

Migration 0010 also had to rewrite the unique index. In Postgres nulls are distinct, so simply
adding the nullable column would have stopped the index constraining the *unscoped* case — which is
235 of 236 drugs and the case the index was added for. It is now over
`coalesce(indication_id, zero-uuid)`; Drizzle cannot express that, so the schema states the columns
and a test reads `pg_indexes` to check the database has what the comment claims.

**What the quiz does with it.** `atomsOf` gives a split drug one atom per branch, and the option is
the **bare dose** — prefixing it with the condition would put a `Something: ` on exactly one of four
options, which is a tell. The branch goes in the *prompt* instead: *How is Sildenafil dosed for
erectile dysfunction?* with four plain doses under it. Asked the other way round the prompt
deliberately does **not** say which branch, because there the clue is already a dose and naming the
condition would all but answer it; the question *key* carries the branch either way, or history
would file two different questions under one name and report a single thing getting better and
worse.

The other branch is always in `acceptable` and can never be drawn as a distractor. That is the
tirzepatide rule one field over — a dose that is true of the drug must not be marked wrong, whichever
branch was asked — and it comes free from the mechanism already built for a drug with several
indications.

Two things went wrong on the way and are worth keeping:

- **Notes are per row, by structure.** `ParseResult.notes` is one flat list and a split dosing stores
  one row per branch, so handing every row the whole list marked the branch that read *perfectly* as
  review work — phantom work in the one queue meant to hold real work. The first fix tagged the note
  strings `"<Indication>: <note>"` and read them back with a regex, which broke on contact: notes
  carry colons of their own, so `Left unread: kg.` parsed as a branch called *Left unread* and a
  genuinely refused dosing came out looking settled. `ParseResult.branches` now carries the per-branch
  notes as structure, and `notes` keeps the prefixed strings for the reader alone.
- **The data edit is attributed to a person.** `audit_log.actor_id` is a foreign key to `users`, so
  `scripts/split-dosing-by-indication.ts` resolves the env-seeded admin rather than inventing a
  name — and it is idempotent on the *result*, not just on the prose, because the first run left
  matching prose with no branched rows behind it when the audit write failed after the field had
  saved. A script that called that state done would have left it broken for good.

The prose edit lands with `updatedBy` set, which is what stops the next `npm run seed` putting the
sheet's single line back: the importer keeps a human's value over the sheet's unless forced.

Verified on the running container: two rows, each under its own indication, the pulmonary one clean
and the erectile one carrying its own note; and the quiz drawing
*How is Sildenafil dosed for erectile dysfunction?* with tadalafil's *10 mg one hour prior to sexual
activity* as a distractor and the pulmonary dose held in `acceptable`.

### Nothing drifts behind text (2026-11-03)

The first season shipped with motes crossing the page, and a leaf drifting through a paragraph makes
the paragraph harder to read. Lowering the opacity does not fix it — **the eye follows the moving
thing** — so the fix is occlusion, not subtlety.

`<header>` and `<main>` now paint their own opaque ground, and both decoration layers pass behind
them. Two elements, not a rule per card, because every page in this app is one centred
`<main className="mx-auto max-w-...">`: giving it a background occludes exactly the reading column,
at whatever width that page chose, with no per-page work and nothing to forget on the next page.
What is left for the weather is the gutters either side — which is where weather belongs, and which
quietly becomes nothing at all on a phone, where there is no room for it beside the words.

The wash is repainted on those two elements as a flat gradient of the same colour, so the column and
the gutters are the same shade and there is no seam down the edge of the text. With no season set,
`--season-wash` is undefined, the gradient is invalid at computed-value time, and `background-image`
falls back to `none` — which is exactly the behaviour wanted, and the reason it is written as a
gradient rather than as a second background colour.

**Then the owner asked for the home page back** (2026-11-03): the motes should reach the middle of
that page, just not the blocks holding the text. So the blanket rule gained an opt-out and a
counterpart. `main.open` drops the opaque ground, and `.plate` paints it locally -- the same colour
and the same wash, invisible as a box, its whole job being to stop a mote where the words start.
Open a column and the weather gets the gaps *between* the blocks as well as the gutters, which on
the home page is a grid of cards and is exactly where a drifting leaf belongs.

It is opt-in, and only the home page opts in, because it holds only while **every** block in that
column paints its own ground: a card already does, with `--surface`, and anything that is bare text
carries `.plate`. An unplated paragraph in an open column puts the leaf straight back in the
paragraph. Two guards in `tests/seasons.test.ts`: exactly one file may open a column, and the
plates in it are counted; and `.plate` may not carry padding or margin, because an unlayered
`.plate` margin beats the Tailwind `mt-*` on the same element and a plate that bled past its box
would silently eat the page's spacing.

### The season, let into the chrome (2026-11-03)

A second switch, `season_tint`: whether the season stays the wash and the motes, or reaches the page
ground, the card surfaces and the borders. Its own column rather than four more season labels, for
the same reason `season` is its own column rather than four more themes — "autumn, background only"
and "autumn, everything" are a season *plus a depth*.

**The grounds move barely at all** — off-whites and near-blacks, a cast rather than a colour. **The
borders move a lot**, because a border is not text and carries no contrast duty here (the plain
`--border` manages 1.27:1 against its surface), and the borders are what actually make the app read
as seasonal. `--accent` is deliberately left alone: it is link text *and* a button fill, so four
seasonal variants would be four more contrast pairs to defend for no gain the borders do not already
give.

This is the one decoration allowed to redefine `--bg`, `--surface` and `--border`, and a test holds
that line: any rule in the decoration sections touching a ground must say `[data-tint]` in its
selector, and no rule anywhere in them may touch an ink. The contrast argument is then re-made on
the tinted grounds against **the worst case the app can actually produce** — a tinted ground, under
a season wash, under a daypart wash — which measures **4.62:1**.

One knock-on worth knowing: `SURFACE_LIGHT` / `SURFACE_DARK` in `lib/theme/palette.ts` are the
*untinted* surfaces, and the palette editor prints every categorical fill's contrast against them.
A test now pins the tolerance — every hue in `CATEGORICAL_RAMP`, on every tinted surface, within
0.15 of its untinted figure — so the editor cannot start reporting a different number depending on
the month.

### The light and the dark get their own weather (2026-11-03)

Seven effects, from the list put to the owner, split by whether a preference for them earns its
keep.

**Under one switch, `ambience`** — because four switches for four decorations is a settings page
nobody reads:

- **A starfield, in dark.** 14 stars, 1–3px, that do not move: only their opacity does, on long
  unequal cycles so no two breathe together. A star that travelled would be a firefly, and summer
  already has those.
- **A sunbeam and its dust, in light.** One wide diagonal band sweeping over two minutes, with 8
  motes taking 90–150 seconds to cross. Dust in a shaft of light barely moves, and hurrying it ruins
  the whole effect.
- **Paper grain, in light.** An inline-SVG turbulence at 2%, static. A study aid should read as
  paper rather than as a lit screen, and this is the only decoration in the app that never moves —
  which also makes it the only one that survives `prefers-reduced-motion` untouched.
- **Warmth by the clock.** Four buckets — morning, day, evening, night — as another measured
  overlay rather than a token change, so it composites through the same contrast test as everything
  else. Buckets rather than a curve, because a curve has to be re-rendered to be seen, and a page
  that restyles itself while you read it is worse than one that does not.

**Which half shows is a CSS question, not a server one.** A theme of `system` means the server does
not know whether it is light or dark — only `prefers-color-scheme` does — so both mote sets render
and the stylesheet hides the wrong one. Twenty-two spare spans, most of them `display: none`, beats
either choosing wrong for half the readers or flashing the other one on every load. An explicit
`light` choice has to put the light set *back* over a dark system preference, which is a third block
and a test.

**With no switch at all**, each for its own reason:

- **A focus ring.** `:focus-visible`, two pixels of `--accent`, offset. An accessibility improvement
  should not be something anyone can turn off, and the app had only the browser default — which on a
  light ground is a thin dark outline that is easy to lose. Keyboard-only, so a mouse click does not
  ring the thing it clicked.
- **A pill on the study streak**, its fill deepening with the run and capped at six. The only
  decoration in the app driven by data — and the data is printed *inside* it in words, which is what
  keeps it decoration. **Static, not pulsing**: a fill cannot be animated on the compositor any more
  than a shadow can, and the intensity scaling with the run was always the interesting half.

  It took three attempts and the first two are the argument for the third. A bare `text-shadow` glow
  was invisible and was reported as missing — correctly, because a one-day run is `--streak: 1` and
  three pixels of blur behind five small words is nothing. A hard ring plus a growing halo was
  visible and looked bad: an orange outline around five words with a smear outside it that got
  muddier the better you were doing. What is left is the thing this app is already made of — a pill
  — carrying the run in the only property a pill has to spare, how strongly it is filled: 7.5% at
  one day, 20% at six. No blur anywhere, and the whole phrase inside it, because a pill around half
  a sentence reads as a box somebody forgot to close.

  Two details are load-bearing. The hairline edge carries **no** `var(--streak)`, so there is an
  edge at one day as well as at six — an edge that faded in would read as a rendering fault at the
  low end. And the fill is written `rgb(var(--streak-ink) / calc(...))` rather than with
  `color-mix`, because `color-mix` makes the minifier emit a **solid-colour fallback** for older
  browsers, and a solid fill under `--fg` is the one version of this that fails contrast.

  The words keep `--fg` throughout, so the pill can warm up without moving any ink. `--fg` on the
  deepest fill measures **12.93:1** on the light page ground and **11.53:1** on the dark one;
  11.98:1 with an autumn wash underneath as well. `tests/seasons.test.ts` composites the deepest
  fill over every season wash on both grounds and checks it, and reads both the ink channels and the
  alpha ramp out of the stylesheet rather than restating them — so moving either is a failure that
  says so. Planted a solid fill and a blurred edge; four guards fired and only they.
- **An idle tilt on the wordmark.** Two degrees, eleven seconds, `rotate` so it composites. Enough
  to notice once, not enough to watch.

**A second pre-existing contrast problem surfaced, the same way the first did.** Light `--accent`
was `#1f6feb`: **4.52:1** on `--bg`, two hundredths above the line, for the colour every link in the
app is drawn in. It is now `#1560cc` — 5.73 unwashed, 5.17 with a tint and both overlays stacked,
and white on it goes from 4.63 to 5.87. Two near-misses found by one composite test is the argument
for having written it.

Verified on the running container: migration 0009 applied on boot, all 12 tint blocks survive
minification with the right values, and every combination stamps exactly the attributes the
stylesheet has rules for — season with tint and ambience in dark giving all five, season off with
ambience giving no `data-season` or `data-tint`, `auto` under a `system` theme giving `data-season`
alone. Each guard was then proved by planting its violation: a season moving a ground without a
tint, an ink redefined by a decoration, a tint that fails contrast, and the occlusion removed. All
four failed, and only they.

### A season is not a theme (2026-11-03)

Four seasonal decorations — spring petals, summer fireflies, autumn leaves, winter snow — and the
first decision is the one everything else follows from: **a season is a separate setting from
light-or-dark, not four more values on it.**

Light-or-dark is a *brightness*, and every contrast figure in `app/globals.css` is measured against
it. A season is a layer on top of whichever brightness is in force. Folded together, choosing
autumn would have chosen a brightness for somebody, and "autumn, but dark" would have needed eight
enum values to say. So migration 0008 adds `season_pref` and a column on `user_preferences` — plus
`site_settings.default_season`, since "the whole site goes autumn in October" is a thing somebody
would actually want. Default `off` on both: an upgrade must not start animating under anyone who
did not ask.

**What a season is allowed to touch is exactly three values**: a low-alpha `--season-wash` painted
over the page ground, and `--season-ink` / `--season-ink-2` for the motes. It may not redefine
`--fg`, `--muted`, `--border`, `--accent` or anything else text or a control edge is drawn in —
asserted, because that is what lets every existing contrast guarantee stand unexamined.

The wash does move the effective background, so `tests/seasons.test.ts` composites each wash over
each ground in each theme and re-checks every text ink against the result. **That check found a
real pre-existing problem.** Light `--muted` was `#6b7280`, which measures **4.72:1** on `--bg` —
a fifth of a point above the line, for the token carrying most of the explanatory prose in the app.
Any wash pushed it under. It is now `#5b6270`: 5.98 unwashed, 5.49 under the heaviest wash, and
still plainly quieter than `--fg`. The season is what surfaced it; the fix is an improvement for
everybody, season or not.

**The ornament cannot carry information, and that is enforced rather than intended.** It is one
layer in the root layout, built from one value, identical on every page — so it cannot differ
beside a question and cannot hint at an answer. The mote table in `lib/theme/seasons.ts` is a
**fixed list, not randomised**, for that reason first (a varying ornament could in principle encode
something), and secondarily because generating it per render changes it under every navigation
while generating it in the browser means a flash of nothing. A test walks `app/study` and
`lib/study` for any mention of the layer and expects none.

Mechanics worth keeping:

- Only `translate`, `rotate` and `opacity` are animated — never a layout property — so the whole
  layer runs on the compositor. A test parses the keyframes and fails on a fourth property.
  `translate` and `rotate` as separate CSS properties rather than one `transform` is what lets a
  fall and a tumble be two independent animations instead of fighting over one declaration.
- Drift is in `vw`, not a percentage: a percentage on `translate` resolves against the element's own
  8px width, which would be no drift at all.
- Twenty motes is the ceiling. Past that it stops reading as weather and starts reading as a fault.
- Every delay is negative, so the screen arrives populated instead of filling up over the first
  half-minute, and no larger than its own duration, so it reads as a phase inside one trip.
- `prefers-reduced-motion` hides the motes but keeps the wash, which does not move. Hidden rather
  than frozen: a frozen mote is not weather, it is a speck of dirt nobody can wipe off. Printing
  drops the layer entirely.
- `pointer-events: none`, `aria-hidden`, `contain: layout paint`, and z-index 0 against the
  content's 1 — a decoration must never sit on top of the page it decorates.

`auto` reads the season off the date by whole months, December through February being winter.
Meteorological rather than astronomical because the equinoxes drift by a day or two a year and
would need a table, and nobody will dispute that the 21st of September is autumn-ish. Northern
hemisphere; the four explicit choices are the whole hemisphere setting.

Verified on the running container: the migration applied on boot (`season_pref` with its six
labels, both columns defaulting to `off`), `off` puts no `data-season` on `<html>` and renders no
layer at all, and each season renders its own ornament and nothing else — winter 20 flakes falling
without spin, summer 16 sparks rising, spring 14 petals, autumn 14 leaves, `auto` resolving to
autumn on 3 November. The preference was set back to `off` afterwards.

### The only way back in (2026-11-03)

`/admin/users`, built next because of one fact about this deployment rather than because a roster
of one needed managing: **there is no mailer, so an admin setting a password here is the only route
back into a locked-out account.** `/account` can change a password you still know. Nothing could
change one you had forgotten. That made this screen a prerequisite for inviting anybody, not a
convenience.

**One rule prevents lockout, and it is a rule about the actor, not a count.** You may not change
the role on, disable, or delete *your own* account. No "is this the last admin?" check is needed:
the only account that can remove the last admin's access is that admin's own, and it is refused.
A count would be the thing that got it wrong — it has to be right about disabled admins, about the
row being deleted, and about two admins demoting each other at once. The actor check is right
without knowing any of that. Every action re-reads the session rather than taking an actor from the
form, because an actor the browser supplies is not a guard.

Your own row therefore *offers less*, rather than offering controls that will refuse: role and
status render as text and Delete is absent. A disabled control reads as broken; an absent one reads
as deliberate.

The rest of the decisions:

- **Disabling drops every session immediately.** `lib/session.ts` already revokes them on the
  account's next request, which covers a status changed by hand in the database — but an open tab
  doing nothing might never make one.
- **Setting a password drops them too.** Whoever is being given a new password either has no
  session, which is why we are here, or should not keep the old one.
- **The new password is shown as it is typed**, because an admin setting somebody else's has to
  read it back to them. It is never written to the audit row, hashed or otherwise.
- **Sign out is allowed on yourself**, unlike the three above, and keeps the session doing the
  asking — otherwise the click would end on the login page.
- **Delete is hard, and takes the study history with it**: schedules, quiz attempts, saved setups
  and preferences all cascade. That history is theirs and nobody else's, so the footprint is counted
  first and written into the audit row, which is all that will be left to say how much there was.
  The copy points at disabling, which keeps everything.
- `audit_log.actor_id` is `set null`, so what a deleted admin did stays recorded without a name on
  it. There is a test for that, because it is the one reference that does not cascade.

Searching escapes `%` and `_` before building the `ILIKE`, the same rule the drug lookup follows:
unescaped, searching for a percent sign returns the whole roster.

Verified against the live database on a throwaway classmate account created and deleted by the
check: self role-change and self-delete both refused by message, promote and demote, disable
dropping 2 sessions and enable dropping 0, force-logout dropping 1, a password set whose hash the
sign-in verifier accepts, then the footprint, the delete, and the roster back to 1. The served page
with two accounts showed the role select, Disable and Delete on the classmate's row and none of the
three on the admin's own.

### Changing the address you sign in with (2026-11-03)

Asked for, and the interesting part is what cannot come with it. **The email is the sign-in name**,
and there is no mailer — so the new address cannot be verified before the switch and the old one
cannot be told the switch happened. What is left is proving ownership: the **current password is
required**, and that is the whole protection. Without it, a session left open on a shared laptop
would be enough to move somebody's account to an address they do not own.

better-auth's own `changeEmail` is not used. It is built around sending a verification link, which
is the one thing this deployment cannot do; with no sender configured it would either fail or
quietly change nothing. So the column is written directly, and the password is checked against
better-auth's hash with **its own verifier** — `verifyPassword` from `better-auth/crypto`, the
counterpart of the `hashPassword` that `lib/users.ts` already uses — so this does not become a
second opinion about how a password is stored.

`email_verified` goes to **false**. That is honest rather than convenient: nobody confirmed the new
address. If a mailer is configured later and verification is turned on, this account will be asked
to verify, which is exactly right.

The address validator is deliberately not an RFC-complete grammar. An exhaustive pattern accepts
things no mail server would and rejects things it should not, and the only real test — sending to it
— is the one this app cannot run. So it catches what a person mistypes (a missing `@`, a space, a
bare hostname) and the page says plainly that nothing will be sent to either address.

An audit row is written, because this is the one self-service change that moves who can get into
the account. The unique constraint is caught and reported as *another account already uses that
address*, since claiming an old address or a classmate's is a thing people do by accident.

Still not possible, and still stated on the page: resetting a **forgotten** password. That is the
admin screen above.

### A front door, and a face on it (2026-11-03)

The home page said *"Scaffold is up. Drug browser, flashcards, and quiz come next."* for five
phases after all three had landed. What replaces it answers the two questions somebody opening the
site actually has — **is there anything to do**, and **can I start what I did last time without
setting it up again** — and then gets out of the way with a card per area.

**The figures are counted, not stored.** `lib/home/overview.ts` is one round of parallel queries:
the catalogue, the user's own cards and due count, their quiz totals, their last attempt, their
weakest field and their active days. Nothing is cached and no counter column was added, because a
counter is a second answer to a question the rows already answer, and it is the one that goes wrong.

Three of the four tiles are records. The fourth is an instruction: the **weakest field** carries its
own key, so the tile links to a quiz on exactly that field. It needs at least eight answers before
it will name anything — without a floor the answer is whatever you got wrong once, and the page
would send you to a quiz about a single unlucky guess — and it will not nominate a field you have
never missed. Accuracy is read off `quiz_answers` rather than off the attempts' scores, because an
abandoned attempt is 0 of 0 and would drag an average down for nothing; and it is **withheld**
rather than shown as 0% before a first answer, since a new account has no record and printing one
reads as a verdict on it.

**Last-used setups are a new thing, and deliberately not a saved setup.** `study_presets` holds
setups you *named*, which is a deliberate act most sessions never get; without something else, the
home page could only offer a blank form to someone who sits the same quiz every evening. So each
study page records what it was started with in `user_preferences.study_defaults` — a jsonb column
unread since phase 0, so no migration — as the page's own query parameters, through the same
whitelist a saved setup goes through, in both directions.

Two decisions in that, both about where the write happens. It is recorded **from the browser**, by a
component that renders nothing, rather than in the page's own render: the study pages are GETs, and
a GET that writes is a GET a link prefetch performs. And it is a **jsonb merge**, not a
read-modify-write, so a deck opened in one tab and a quiz in another both survive — read-then-write
would have the second overwrite the first's surface with nothing. The action revalidates nothing, for
the same reason every study action revalidates nothing.

**The top bar.** Five destinations as underlined accent links read as five unrelated interruptions,
and none of them could say which one you were looking at. They are pills now, the filled one being
where you are (prefix-matched, so a drug profile keeps *Drugs* lit). The email — a third of the bar
spent saying something the reader already knows — became the avatar, which is the same information
on hover and a way into the account when you do not want it.

### An account is not a setting (2026-11-03)

`/account` is the name on your account, the picture beside it and the password behind it.
`/settings` stays what it was: how the site looks to you. The split is *who the setting is about*,
and it is worth the extra route — the password is the one irreversible control in the app, and it
should not sit on the page people open to try colour schemes.

**The password goes through better-auth.** It owns the hash format sign-in verifies against, so
`auth.api.changePassword` does it. `lib/users.ts` reaches for better-auth's hasher only because
account *creation* has no endpoint to call — sign-up is disabled — and changing a password does, so
re-implementing it would be a second answer to how a password is stored. The current password is
required and better-auth is what checks it: not belt-and-braces, since a signed-in session on a
shared laptop would otherwise be enough to lock the owner out of their own account. *Sign out
everywhere else* defaults to **on**, because the usual reason to change a password is thinking
somebody else has it.

**The picture lives in the row, as a data URL.** There is no object storage here and no upload
directory in the compose file; adding one would mean a second thing to back up, where
`/admin/data`'s single-file export already carries a column. The cost is that the bytes ride along
with every page that renders the header, which is what the 160px square and the 64 KB cap are for —
about 8 KB of base64 in practice. It is resized **in the browser**: a phone camera's four-megabyte
JPEG has to become a 160px square, and sending it whole would mean carrying four megabytes through
a server action and adding an image decoder to a project with no other use for one. Centre-cropped,
not letterboxed, because the result is drawn in a circle.

Raster only — PNG, JPEG, WebP. **SVG is refused**: it is an image to a browser and a script host to
an attacker, and this string goes into an `<img src>` other people's pages will render once the
users admin exists. The regex and the cap are the whole guard, since nothing server-side decodes the
image, and a test plants an SVG and an over-cap string to prove neither lands.

What is still not possible, and says so on the page: **resetting a forgotten password**, and
**changing an email**. Both need a mailer. The page states it rather than leaving someone waiting
for an email that is never coming.

Verified against the live database on a throwaway account created and deleted by the check: the name
stored trimmed and collapsed, an SVG refused without disturbing the picture already stored, a wrong
current password rejected as better-auth's `APIError` (which the action turns into a sentence rather
than a 500), and after the change the new password signed in 200 while the old one got 401.

## Study configuration (inclusive vs exclusive)

Flashcards and quiz share one config object, so the two modes are built once:

```ts
{
  scope:     { tags: [], categories: [], indications: [], classes: [], schedules: [], dueOnly: bool },
  maxCards:  0,   // 0 = the whole deck; lower it and that many are sampled at random
  yearLevel: "P1" | "P2" | "P3" | null,   // preselects fields from field_defs.year_levels
  fields:    ["moa", "indication", "adverse_effects"],   // any defined field
  mode:      "inclusive" | "exclusive",
  direction: "drug→fields" | "fields→drug" | "field→field",
  blockSize: number,   // 0 = off, otherwise cards per block
  grading:   "binary" | "four-point",
}
```

`yearLevel` is a shortcut over `fields`, not a separate mechanism: picking **P2** selects generic,
brand, indication, dosing, and controlled — exactly the columns the sheet makes P2 responsible for —
and leaves MOA and black box out. You can still hand-adjust the field list afterward. This is the
single most useful control on the page, because it matches how the course actually tests you.

**Exclusive** — selected fields expand into one card/question *each*. Three fields over 50 drugs =
150 cards, each scheduled independently in `study_cards`, so MOA recall and adverse-effect recall
advance at their own rates. Better default for spaced repetition.

**Inclusive** — selected fields collapse into *one* card/question per drug, all shown together. One
`study_cards` row per drug for that field set; `card_key` is a stable hash of the sorted field list,
so changing the selection and changing back doesn't corrupt existing schedules.

**Direction** applies to both:

- `drug→fields` — "Metoprolol: MOA? Adverse effects?" → reveal or choose.
- `fields→drug` — show the field values, name the drug. Inclusive mode makes this the strongest
  mode available: three clues at once is genuine differential reasoning. Exclusive is one clue,
  harder.
- `field→field` — brand→generic, or class→MOA, with no drug name shown.

For multiple choice, distractors come from `lib/quiz/`: **hard** mode draws the three wrong answers
from the same `drug_class` (so "which cardioselective beta blocker…" is a real discrimination),
**easy** mode draws at random. In inclusive `fields→drug` questions the wrong options are *coherent
composites* — all fields taken from one wrong drug — never a scramble across drugs, which would be
spottable without knowing any pharmacology.

### A capped quiz asks what you got wrong first (2026-11-02)

A quiz with a cap samples the pool at random, which spends a 20-question paper on 20 arbitrary
questions when the app already knows which 14 you have missed. So the draw is weighted, by
`lib/study/priority.ts`:

| last answer | weight |
| --- | --- |
| wrong | 4 |
| never asked | 2 |
| right once | 1 |
| right twice | 0.67 |
| right three or more | 0.5 (floor) |

Four things in that table are decisions rather than numbers.

**Nothing is ever zero.** Worst to best is 8:1, not infinity-to-one. Without a floor a cap of 20
over a pool of 236 becomes the same 20 questions forever and you never meet the rest of the sheet
— the feature would quietly turn a quiz into a grudge list. At the floor a question you have aced
still turns up, an eighth as often as one you missed.

**Never-asked outranks answered-correctly.** Coverage first. You have demonstrated something about
the one you got right, and nothing at all about the one you have not seen.

**One right answer does not clear it.** Four options is a 25% guess rate, so a single correct
answer is weak evidence; it takes a run of two or three to reach the floor. A miss resets to 4
whatever came before, because the latest result is the one that matters — right nine times and
wrong once, most recently, is a question to ask again, and a lifetime average would bury it.

**Skipped is not missed.** `quiz_answers` keeps `answered_at` null to tell "ran out of time" from
"got it wrong", and the weighting honours that: an unanswered row carries no weight at all, so
abandoning a quiz does not reorder the next one.

The weight is keyed on **drug + field, not direction**. "Amiodarone's mechanism is shaky" is a fact
about the material, not about which way it was asked — and a paper on mixed directions decides each
question's direction by coin toss, so a direction-keyed weight would match about half the time and
the mechanism would visibly half-work. Per-drug mode separates itself regardless, since its field
key is the joined selection (`moa+dosing`).

Deliberately **not** wired into the SM-2 schedule in `lib/study/srs.ts`. A quiz answer is a
four-way guess and a flashcard grade is self-report; letting a lucky guess push a card three weeks
out would corrupt the one signal that is currently honest. This weighting is quiz-local.

Mechanically: `weightsFromHistory` folds the answer history newest-first and stops at each
question's most recent wrong answer, which is both what makes it answer to the latest result and
what lets the query be bounded — rows past the limit had stopped counting anyway. `capQuiz` orders
by an Efraimidis-Spirakis key (`-log(u) / weight`, ascending), which is one pass, exactly
proportional to the weights, and decidable in a test, since a constant rng orders by weight alone.
It orders the **whole** pool rather than picking the top N, because the order is worth having even
with no cap: a quiz abandoned halfway should have spent that half on the shaky material.

It is a setting — *Priority* on the quiz page, on by default — and the read-only summary says
"13 you've missed before" when it is on, so the paper never silently reshapes itself. Measured on
real history, a 20-question paper over all 236 mechanisms: **1.9** of the 20 were previously-missed
questions drawing evenly, **5.5** weighted, which is 80/296 of the pool's weight and so exactly
what the table predicts.

### A study setup is a name you can click (2026-11-02)

`study_presets` had been in the schema since phase 0 and nothing read or wrote it, so every quiz
and every deck started from a blank form and eight controls. `/study/setups` is the manager, and
both study pages carry a read-only bar of the setups saved for them.

**What is stored is the page's query, not a `StudyConfig`.** Both forms are GET forms whose state
*is* the URL, and a config cannot hold all of it: `direction` has no value for "mixed, decided per
question", and priority is not a config field at all. Keeping the query reproduces the page
exactly, and a setting added later needs no migration. The cost is that a renamed parameter is now
a decision about saved setups too, which is why the whitelist in `lib/study/presets.ts` is written
out by hand rather than inferred.

**The whitelist runs both ways.** Saving keeps only the parameters that surface reads; so does
loading. A restored backup, or an export from an older version, is not a reason to put an unknown
key into a URL — and a row that does not say which page it belongs to is not offered at all,
because a link to nowhere is worse than a missing row.

**A setup can be saved before anything starts**, which the first version could not do: the bar
reads the URL, and the URL holds the settings only once the form has been submitted. So *Save this
setup* is a **second submit button on the settings form** (`app/study/_components/save-setup-button.tsx`)
with `formaction` pointing at the manager — the browser then sends the controls as they are right
now rather than as the URL last recorded them. Plain HTML, no JavaScript and no client boundary,
and `formtarget="_blank"` so the form you are filling stays as you left it and a session already
running is not navigated away from. The surface rides as a hidden field rather than in the
`formaction` query, because a GET submission replaces the action's query string with the form data;
the cost is a `surface=quiz` on the Start URL, which that page ignores and `setupParams` never
stores.

The bar keeps its own link, relabelled *Save what's running*, for the case the button cannot serve
without a detour: mid-session the panel is collapsed and warns that changing it abandons the quiz,
so a one-click path that touches none of that is worth keeping.

**The bar sits above the settings panel, not inside it.** It shipped inside, which made it
invisible at the only moment it mattered: the panel collapses as soon as a session starts, and a
session starting is what puts the settings in the URL and so makes there be anything to save. The
markup was verified and the path a person walks was not — which is the whole difference between
"the link renders" and "the link can be reached".

**Writes live on the manager page, never on a study page.** This is the one real constraint. A save
button on the quiz page would have to re-render that page to show its result, and re-rendering a
study page redraws the deck or the paper underneath a session in progress — the exact bug that
scored a finished quiz 0 of 83. So the study pages only ever *link*: loading a setup is a plain
navigation, since that is a deliberate "start something else", and *Save this setup* opens the
manager in a new tab for the same reason the profile links do.

**Saving over a name replaces it**, which is how a setup is edited and how it is renamed. One
statement against a unique index on `(user_id, name)` (migration 0007), so two tabs cannot both win
and leave two rows called "P2 drill" with different filters and no way to tell them apart. Per
person, not globally: two students naming a setup "Exam 2" is two people, not a collision.

A setup with no fields and no year is refused rather than saved: both pages key off the field list,
so that is a blank form under a name. Each row also carries a summary read off its parameters —
*Brand names · P2 · per fact · mixed directions* — because a name is what you pick a setup by and a
summary is how you remember which one it was, three weeks after naming two of them "dosing".

### Review and cram

Two session modes, after the Obsidian spaced-repetition plugin's:

| | cards in the session | grading | the schedule |
|---|---|---|---|
| **Review** | only what is due | Again / Hard / Good / Easy | moves |
| **Cram** | everything in scope, due or not | Again / Good | untouched |

Those three columns travel together, which is why `sessionMode` is one setting rather than three
flags a caller has to keep in step. Cram exists to skip the waiting, so it ignores `dueOnly`
however the saved scope has it; and a cram pass that quietly rescheduled would flatten weeks of
spacing into one evening, which is the whole reason to separate the modes.

**Review** is the schedule doing its job, and the four-point scale is what lets it adapt: Easy
stretches the interval, Hard shrinks it, and that signal is per card rather than per deck.

**Cram** is the night before. Two buttons and no introspection — the question when you are going
through 200 drugs is whether you knew it, not how comfortably — and fewer decisions per card means
more cards per sitting. The two buttons are labelled **Again** and **Good** — the same words they
map to on the long scale, so the short scale reads as the long one with the middle removed rather
than as a second vocabulary to learn.

Each mode brings its own buttons by default, and either can be overridden: the full scale while
cramming, or two buttons on a due review, if that is what suits.

The two scales are a display choice over one mechanism, not two systems:

```
Good   (quality 4)   the only "knew it" the short scale offers
Again  (quality 1)   the only "missed it"
```

So a card keeps one `study_cards` row and one schedule whatever scale graded it last. Switching
scales mid-week neither resets progress nor needs a second set of intervals: a card graded Good on
the short scale is the same row, the same interval and the same claim as one graded Good on the
long scale. The short scale simply never offers Hard or Easy.

For [blocks](#blocks-cram-inside-a-session), **Good clears a card from its block** and **Again
requeues it**, on either scale. Blocks work in either mode — they pace
a long cram, and they equally pace a review with 80 cards due.

### Blocks (cram inside a session)

`blockSize` chops the session's cards into consecutive blocks of N. A block does not advance until
**every card in it has been graded good at least once in this session**; cards graded below good go
back into the block's queue and come round again. Block 2 is not shown — not even previewed — until
block 1 is clear. `blockSize: 0` turns this off and the session is one flat pass.

This is the Obsidian spaced-repetition plugin's cram mode, with one deliberate difference: that
plugin groups by tag, so you finish all the cardiology cards before any endocrine ones appear. Here
the grouping is **positional, not semantic** — just the next N cards of whatever the config already
selected. Tags, class and year level are already scope filters on the session, so making blocks a
second semantic axis would mean two different groupings fighting over the same session. An integer
keeps it a pacing control: "20 at a time until I know them" composes with any scope.

Three things this needs deciding before it is built:

1. **Does a block pass touch the schedule?** Settled by the mode rather than by blocks: cram never
   reschedules and review always does, so blocks are free to pace either. A cram pass still records
   `last_result` and `review_count`, so the history knows you saw it.
2. **What counts as "good"?** Settled: a card leaves the block on Good or Easy. Again and Hard put
   it back.
3. **Order within a block.** Failures should not reappear immediately — the answer is still on
   screen. Requeue them behind the block's remaining unseen cards, and only reshuffle once the
   block has nothing unseen left.

Blocks are a session-time construct: nothing about them belongs in `study_cards`. The chosen size
lives in the config object, and so travels into saved presets and `user_preferences.study_defaults`
like every other setting.

### Dosing is stored twice: prose to read, structure to compare

A dosing question cannot draw its wrong answers the way the others do. Two drugs often share a
dose: "10 mg by mouth once a day" is true of a good many of these 236. Pull another drug's dosing
string at random as a distractor and it may be **also correct for the drug being asked about** —
the student who knows the answer picks it and is marked wrong, and the question quietly has two
right answers. Worse, two distractors can be identical to each other.

String comparison does not catch this, because the same fact is written several ways: *10 mg by
mouth once a day*, *10mg PO daily*, *10 mg QD PO*.

**Decision (2026-11-01): sig is stored, not derived at read time.** The earlier plan kept the prose
as the only stored truth and re-parsed it whenever something needed structure. That was the wrong
split. Prescription sig is a closed vocabulary — a survey of all 237 dosing strings found 12
frequency phrasings, 11 routes and 14 dose units, nothing more — so the structure is stable enough
to be data. Two forms are stored side by side:

| Stored | Role | Who owns it |
|---|---|---|
| `dosing` field (prose) | What a profile shows. The sheet's own wording | The class sheet |
| `dosing_regimens` rows (structure) | What the quiz compares, and what prints as sig | Backfilled once, then human-correctable |

The comparable form is the **components**, not a sig string. Storing `100 mg QD PO` as text and
comparing with `=` only moves the normalisation problem from read time to authoring time, where it
is less enforceable: `100 mg PO QD` is the same fact and a different string. Components compare
field-wise and exactly, and the canonical sig is *printed* from them, so it cannot drift:

```
amounts[]   low · high · unit · per_kg · per_time
            a list, because a combination product has two: carbidopa/levodopa 25/100 mg
unit        code + CLASS (mass | volume | count | activity)
            never compared across classes, never converted: 15 mg and 15 mL are
            different facts, so a unit swap is a good distractor and never an equivalence
routes[]    PO IV IM SC INH NEB OPH OTIC NAS TOP TD SL PR PV
            a list where the sheet offers a choice: naloxone IV/IM/subQ
site        region (eye | ear | nostril | skin | mouth | rectum | vagina)
            basis  (each | affected)   -- "2 sprays per nostril" is two each, four in total
frequency   per_day(n) | interval(every n[-m] min/h/d/wk/mo) | once | continuous | unspecified
modifiers[] PRN · HS · AC · PC · AM · PM · EVENING · WITH_FOOD
            orthogonal to frequency and combinable, which is the point: "three times a
            day as needed" is TID *and* PRN, and 12 drugs here are written that way
duration    for 10 days · 6-12 weeks · 12 days every 28-day cycle
ceiling     MAX 900 mg/day -- a limit, never a dose
qualifiers  free text, stored and rendered, never compared: titrated to clinical effect
```

**No laterality.** Right versus left is a property of the patient, not of the drug, and no row
in this data set states one -- the sheet writes "affected eye(s)", declining to pick a side. What
those ten rows actually encode is whether the amount is per site or in total, which `site.basis`
carries. If per-side dosing ever matters it belongs to the per-route variant subsystem, additively.
This also drops the ISMP-flagged AD/AS/AU and OD/OS/OU codes, whose ambiguity (OD is both "right
eye" and "once daily") is itself an argument for storing components rather than abbreviations.

Rules that follow:

1. **A distractor must differ from the correct answer on the components**, not on its wording. The
   same check keeps the three wrong options distinct from each other.
2. **A regimen with no components is still stored, still asked, and marked** (decided 2026-11-01).
   Every one of the 236 drugs has a `dosing_regimens` row; the 29 whose wording the parser cannot
   decompose arrive with empty components, `needs_review` set, the reason recorded, and their prose
   in `source_text`. The information is therefore present and askable rather than absent, which is
   what was wanted: *"I want all the current information working quizzes and flashcards."*

   What such a row cannot support is the strict distractor check — with nothing to compare, the
   engine cannot prove a wrong option is not also right for this drug. So phase 6 compares the
   **wording** for these rows, requiring a candidate to differ from the answer on every number it
   contains, and the `needs_review` flag is what tells it to take that path. That is weaker than
   comparing components, and the trade was made deliberately: a question that needs a correction is
   better here than a drug missing from the deck. Where the sheet gives no dose at all — rivaroxaban's
   *"Extremely variable (reference indication and renal function)"*, vancomycin's *"Individualized
   doses"* — the wording **is** the right answer, and a specific numeric distractor is plainly wrong,
   so those are safer than they look.
3. **Sig is a rendering, never a second source of truth.** `100 mg QD PO` is printed from the
   components, so a card can ask either way round: prose to sig, or sig to prose. The abbreviations
   are themselves worth drilling — QD, BID, PRN, PO — and that is a card type the structure gives
   for free, with no new content to author.
4. **A near-miss distractor is better than a random one.** Wrong options vary one component
   deliberately: right dose, wrong frequency. That is the discrimination the exam actually tests,
   and it is only possible with a parse.
5. **A re-run never clobbers a human.** Stored structure is no longer re-derivable from prose — a
   parser improvement cannot silently repair rows, and a hand-correction must survive the next
   import. Since verification was removed, the prose is simply the source and a re-parse replaces
   these rows.

   **A complicated sig is marked, not rebuilt** (2026-11-02). The regimen editor was considered for
   this and rejected as the wrong shape of answer: a staged infusion does not need its components
   entered by hand, it needs someone to say *this is simply what the sig looks like*. So
   `drugs.dosing_unique` is a checkbox on the dosing field, and ticking it keeps the prose, keeps
   the card, and clears `needs_review` -- because "nobody has looked at this" and "somebody looked
   and this is the answer" are different states that otherwise look identical in the database.
   Acetylcysteine's 21-hour three-stage infusion is the case, and is ticked.

   The dosing box's border colour therefore means only what it says: feedback while typing prose
   that is *meant* to decode. Ticking the box turns it off, since nagging about wording nobody
   expects to parse is noise. Multiple choice still leaves a component-less row alone -- it cannot
   prove a wrong option is not also right -- so a unique sig is asked as free recall.

   A hand-built multi-step regimen editor (and the `pinned` flag that would protect it from a
   re-parse) stays unbuilt and, for now, unwanted.

**Why a table rather than another field.** Dosing is not one value per drug. The real data needs
multiplicity four ways, and only rows give it: alternative regimens (9 drugs — *10 mg daily OR 70 mg
once weekly*), sequenced regimens (5 — azithromycin's day 1 then days 2–5), and later the
per-route and per-population variants [already recorded as unbuilt](#route-is-recorded-per-route-and-per-population-detail-is-not-yet).
Keying rows by `(drug_id, route, population, step)` means that subsystem is already shaped: today
every drug has one adult row at its standard route. **A fifth axis landed on 2026-11-03** —
the indication — for the one drug whose dose depends on which condition it is being given for; see
[A dose can belong to one indication](#a-dose-can-belong-to-one-indication-2026-11-03).

**What the 237 look like**, from the survey that informed this:

| Shape | Count | Quizzable |
|---|---|---|
| Single regimen, single dose | 145 | yes |
| Single regimen, dose range | 58 | yes — range compares as an interval |
| Alternative regimens (`OR`) | 9 | yes, one row each |
| Sequenced / loading dose | 5 | yes, one row per step |
| Continuous weight-based infusion | 3 | yes |
| Individualized / titrated to effect | 17 | **no** — prose only, flashcards only |

So ~203 of 237 parse mechanically, 17 are honestly unquizzable, and the remaining handful need a
human in the drug editor. The backfill reports every row it refuses rather than guessing.

The parser lives in `lib/dosing/` — `parse.ts` reads prose, `sig.ts` prints the canonical string,
`compare.ts` answers equivalence for the distractor engine. The profile wants it too, to show sig
shorthand beside the prose, so it is not inside `lib/quiz/`.

The field picker saves as a named preset ("P2 midterm — MOA + AE, exclusive, 40 cards"). Missed
quiz questions push their cards to due in `study_cards`.

---

## Features

**Browse & search** (`/drugs`) — fuzzy search over generic, brand, class. Filter rail: class,
schedule, tags grouped by `kind`, needs-attention (flagged / has gaps / complete), and
missing-field (find everything with no
MOA yet). Dense table on laptop / card list on phone from one responsive component. Filter state in
the URL so views are bookmarkable.

**Drug profile** (`/drugs/[slug]`) — header with generic, brands, class chip, schedule badge. Body
renders `field_defs` in `sort_order`, grouped, honoring per-user visibility and ordering. Each field
shows its source note, its flag if it carries one, and a one-click flag. Sidebar: tags, and other drugs
in the same class for contrast-and-compare.

**Drug editor** (admin) — create/edit a card field by field, with the lookup panel alongside. Pull a
suggestion into a field, rewrite it into exam language, and record what you read it in.

**Flashcards** (`/study/flashcards`) — the note's "T/F", self-graded. Build a deck from the config
above, then prompt → reveal → right/wrong. Keyboard on laptop (space flips, ←/→ grades), full tap
targets on phone. Scheduling is a trimmed SM-2 in `lib/srs/`: correct advances interval by ease,
wrong resets to same-session and lowers ease. Small and readable — "show me what I'm about to
forget", not an Anki clone.

**Quiz** (`/study/quiz`) — same config, multiple choice, scored, per-question review linking to
profiles. History in `quiz_attempts` with per-field accuracy, so weak areas are visible by field.

**Home** (`/`) — what is due, how the quizzes are going, the weakest field with a link to a quiz
on it, the catalogue's size, one-click restarts of the last deck and the last quiz, the saved setups,
and a card per area. Every figure is counted per request in `lib/home/overview.ts`.

**Account** (`/account`) — display name, profile picture, email change and password change.
Distinct from `/settings`, which is how the site looks; this is who you are. Changing the email or
the password requires the current password, since the email is the sign-in name. No forgotten-
password reset — that needs a mailer, so it is the admin screen's job.

**Seasonal decoration** (`/settings`, `/admin/look`) — spring, summer, autumn or winter, or
`auto` to follow the date. A wash over the page ground and a handful of drifting motes, layered over
whichever theme is in force rather than replacing it; `off` by default. A second switch lets the
season reach the chrome — grounds, surfaces and borders — instead of staying a wash. The **filled
button** takes the season either way, since it paints its own opaque fill: icy blue, petal pink,
sunny yellow, burnt orange. See
[A season is not a theme](#a-season-is-not-a-theme-2026-11-03) and
[The season, let into the chrome](#the-season-let-into-the-chrome-2026-11-03).

**Ambient decoration** (`/settings`, `/admin/look`) — a starfield in dark; a sweeping sunbeam, its
dust and a faint paper grain in light; and a warmth that follows the clock. One switch, `off` by
default, independent of the season. See
[The light and the dark get their own weather](#the-light-and-the-dark-get-their-own-weather-2026-11-03).

Everything in both is pure CSS behind two inert layers in the root layout, identical on every page so
neither can become a study cue — and **nothing drifts behind text**: `<header>` and `<main>` paint
their own grounds and the layers pass behind them, leaving the gutters to the weather. See
[Nothing drifts behind text](#nothing-drifts-behind-text-2026-11-03).

**Theming & per-user color** (`/settings`) — light/dark/system, persisted per user, applied
server-side to avoid a flash on load. Choose the **color axis** (drug class, schedule, a tag kind, or
off) and **override any individual color** in a palette editor. Admin sets the site default palette;
per-user overrides layer on top. The picker validates each color against both light and dark
surfaces and warns below 4.5:1 rather than silently allowing unreadable text. Color is never the only
signal — every badge carries text, which also covers color-vision deficiency. Reset-to-default per
entry and for the whole palette.

**Admin** (`/admin`) — a grid of cards grouped into the content, the people who reach it, and the
site itself; it was a bulleted list of blue links until 2026-11-04, the last screen in the app not
taking part in the look:

- **Users** — list, search, change role, disable/enable, force-logout, set a new password, delete.
  **Done 2026-11-03.** "Trigger password reset" became "set a new password" because there is no
  mailer, which also makes this the only recovery path there is. You cannot change the role on,
  disable, or delete your own account — see
  [The only way back in](#the-only-way-back-in-2026-11-03).
- **Invites** — generate (max-uses, expiry, note), revoke, see who redeemed what.
- **Fields** — create, rename, reorder, regroup, retype, set enum options, mark quizzable, set the
  prompt template and lookup mapping, soft-delete.
- **Drugs** — create/edit/delete with lookup panel, bulk tag, bulk field-set, merge duplicates, run
  the sheet importer.
- **Tags** — CRUD, kind, default color, merge.
- **Flagged queue** — every field anyone has flagged, most-quizzed first: the fields where a wrong
  value costs most. **Done 2026-11-08**; see [The last three screens of phase 8](#the-last-three-screens-of-phase-8-2026-11-08).
- **Dosing review** — the regimens the parser could not fully read, worst first, with the prose
  editable in place and a live readback. **Done 2026-11-03**; see
  [The dosing review bench](#the-dosing-review-bench-2026-11-03).
- **Who else the answer is right about** — a wrong *and* a right answer name every drug they belong
  to, which for the controlled schedule is nine. **Done 2026-11-04**; see
  [An answer that belongs to nine drugs](#an-answer-that-belongs-to-nine-drugs-2026-11-04).
- **Therapeutic categories — removed 2026-11-04.** The 65 category tags were pruned at the owner's
  request; `Top Drugs 2026` is the only tag left. The category *scope axis* still works and the
  pickers still render when there is anything to render — there is simply nothing in it. See
  [Four screenshots and what they cost](#four-screenshots-and-what-they-cost-2026-11-04).
- **Again** — a new paper from the settings the last one was drawn with, from the results screen.
  **Done 2026-11-04.**
- **Site** — the name, who may register, and the disclaimer. **Done 2026-11-04**; the default
  theme and palette are next door in **Look**, because a preference and a lock are not the same
  kind of setting. See [What the site is called](#what-the-site-is-called-2026-11-04).
- **Data** — JSON export/backup and restore.
- **Audit log** — who changed what, with diffs. **Done 2026-11-08**; see
  [The log that nobody could read](#the-log-that-nobody-could-read-2026-11-08).
- **Activity log** — what has been happening: signed in, started a quiz, finished one, changed a
  password, flagged a value. A separate screen from the audit log, deliberately; asked for
  2026-11-04 and **for later, after 1.0**. See [Two logs, not one](#two-logs-not-one--planned) for
  the split, what the schema already covers, and the three events nothing records yet.
- ~~**Imported sets**~~ — a second section beside the drugs, studied by the same engine. Asked for
  2026-11-08, built 2026-11-09, **scrapped 2026-11-09** at the owner's call: three designs and one
  imported set in two days was a feature paying rent in decisions rather than in studying. See
  [Scrapped: the imported sets section](#scrapped-the-imported-sets-section-2026-11-09).

---

## Prerequisites

Neither is installed on the dev machine as of 2026-10-28 — `node`, `npm`, `pnpm`, and `docker` are
absent from both PowerShell and Git Bash. Until they are present, phase 0 cannot be run or verified,
only written.

- **Node.js 22 LTS** — needed to install dependencies, generate the first Drizzle migration, and run
  the dev server. The Docker image pins `node:22-alpine`, so matching locally avoids drift.
- **Docker Desktop** (with Compose v2) — needed to bring up Postgres and to build the image the
  server will run.

First run, once both exist:

```
cp .env.example .env          # then edit the secrets
npm install
npm run db:generate           # creates db/migrations from db/schema.ts
docker compose up --build
```

`db/migrations/` was generated against the installed drizzle-kit rather than hand-written, so it
cannot drift from the schema. Regenerate with `npm run db:generate` after every `db/schema.ts` change.

### Deploying to a real server (2026-11-09)

**`docs/deploy.md` is the runbook.** Nothing had to be added to deploy this — phase 0 already
settled the shape (two services, one named volume, both ports on loopback, migrations in the
entrypoint, a healthcheck that does a real `select 1`), so the document is the *order* plus the
values that stop being right once the address is no longer `localhost`.

The three decisions in it worth having here rather than only there:

1. **The app stays on loopback and a reverse proxy faces the internet.** Nothing in the stack
   terminates TLS, so exposing 3000 is not a shortcut, it is the whole security boundary gone.
   Caddy is the recommendation because it gets the certificate itself and sets `Host` and
   `X-Forwarded-Proto` without being told.
2. **`BETTER_AUTH_URL` is the one value that fails silently.** `lib/auth.ts` passes it as
   better-auth's `baseURL`, so a mismatch with the browser's address issues cookies for the wrong
   origin — login appears to work, then does not.
3. **Moving the database and seeding it are different jobs.** `npm run seed` fills a fresh server
   from the committed `data/drugs-seed.json`. Carrying over real work is `pg_dump -Fc`, because the
   JSON backup deliberately will not create accounts (`lib/data/backup.ts` matches progress to
   users by email and reports an email it cannot find).

**`deploy/zimaos/` is a second compose file, not a copy of the first.** ZimaOS and CasaOS install
an app by *pulling an image*, so `build: .` cannot work there and nothing interpolates `${VAR}`
from a `.env` — the YAML is pasted into a text box. That forces four changes, each of which is a
small decision rather than a translation: a pinned `image:` tag (built elsewhere, pushed to GHCR
or side-loaded with `docker load` plus `pull_policy: never`); literal secrets in the file; bind
mounts under `/DATA/AppData/enkephalin` so ZimaOS's file manager can see the database; and the web
port published to the LAN instead of loopback, which is the point of a home server and also the
reason the README says plainly that this is plain HTTP and belongs behind Tailscale if it ever
leaves the house. Postgres publishes no port there at all — the host scripts that wanted
`127.0.0.1:5432` cannot run on ZimaOS anyway, since there is no Node on it.

## Build sequence

| Phase | Deliverable |
|---|---|
| 0 | **done — first run verified 2026-10-29** — scaffold, theme tokens, Dockerfile, compose, Drizzle schema, migrate-on-start, healthcheck. Node 26.13 + Docker 29.9 installed; first migration generated (21 tables) and applied on boot; `docker compose up` serves `/` and `/api/health` with both services healthy |
| 1 | **done — 2026-10-29** — better-auth, login, invite-gated register, roles, admin seeded from env, `/admin/invites`. No migration needed: the auth tables already matched better-auth 1.7. See [Phase 1 plan](#phase-1--auth-invites-and-roles) |
| 2 | `field_defs` + dynamic field rendering + admin field editor — **before** any content lands |
| 3 | **done — imported 2026-10-29, classes corrected 2026-11-01** — `extract-top-drugs.py` (237 drugs), `fetch-drug-classes.py` (237 resolved, 217 classed, 20 uncategorized), `build-seed.py` → `data/drugs-seed.json`, `sync-content.ts` → Postgres: 236 drugs, 352 brands, 249 indications. Re-running writes nothing |
| 4 | **done — 2026-10-29** — browse + search + filters + drug profile. Client-side Fuse over a 236-drug payload, filters in the URL, per-field markers, brand→indication pairing shown |
| 5 | **done — 2026-11-01** — shared study config in `lib/study/config.ts`, card builder, SM-2, [blocks](#blocks-cram-inside-a-session), [review and cram modes](#review-and-cram), `/study/flashcards`. Defaults: one card per drug, blocks of 10, review mode. Config lives in the URL; `card_key` is stable across field reselection. Scope axes since: therapeutic categories and indications, each a collapsible multiselect |
| 6 | **done — 2026-11-02** — `dosing_regimens` (migration 0001), `lib/dosing/` parse + sig, `scripts/backfill-dosing.ts`: all 236 drugs carry a regimen, 251 rows. `/study/quiz` on `lib/study/quiz.ts`: four options (answer + one class-mate + two from the whole database), both directions, scoring, per-field history in `quiz_attempts`/`quiz_answers`. Live: 236 askable on mechanism, 12 on a statins × 3-field paper |
| 7 | **theme and palette done — 2026-11-02** — `/settings`: light/dark/system stamped on `<html>` during the render, colour axis (class / schedule / tag / off), and a per-value colour editor with live contrast figures. Categorical colour moved out of CSS into `lib/theme/palette.ts` so the editor and the page cannot disagree. See [One colour per value](#one-colour-per-value-and-31-not-451-2026-11-02). Responsive pass done 2026-11-02 — see [Where it did not fit](#where-it-did-not-fit-2026-11-02). `/admin/look` done 2026-11-02 — the site default theme and palette, every axis editable, same editor as `/settings`. **Phase 7 complete** |
| 8 | **drug + tag editors done — 2026-11-02** — `/drugs/[slug]/edit` and `/drugs/new` write through `lib/drugs/mutations.ts`: identity, brands, indications, assignable tags and every stored field with its own source and status, plus a live sig/readback preview beside the dosing prose. `/admin/tags` and `/admin/tags/[slug]` write through `lib/tags/mutations.ts`: create, rename, delete, and set membership from a columned checklist of all 236 drugs. `/admin/data` exports and restores the whole database as one JSON file (`npm run export` / `npm run restore` for a timer). Dosing: a *unique/complicated sig* checkbox settles a sig the parser cannot read, rather than leaving it as review work forever. Lookup panel done 2026-11-02 — see [A lookup you cannot reach mid-question](#a-lookup-you-cannot-reach-mid-question-2026-11-02). Delete and merge done 2026-11-03 — see [Two rows that should never have been two](#two-rows-that-should-never-have-been-two-2026-11-03). Home page, the pill nav, the avatar and `/account` done 2026-11-03 — see [A front door, and a face on it](#a-front-door-and-a-face-on-it-2026-11-03) and [An account is not a setting](#an-account-is-not-a-setting-2026-11-03). Users admin done 2026-11-03, and the self-service email change with it — see [The only way back in](#the-only-way-back-in-2026-11-03) and [Changing the address you sign in with](#changing-the-address-you-sign-in-with-2026-11-03). Dosing review bench done 2026-11-03 — see [The dosing review bench](#the-dosing-review-bench-2026-11-03). Site settings done 2026-11-04 — see [What the site is called](#what-the-site-is-called-2026-11-04). **Phase 8 is complete, 2026-11-08.** The audit UI — see [The log that nobody could read](#the-log-that-nobody-could-read-2026-11-08) — and the last three screens, the flagged queue, the brand pairing editor and bulk field set — see [The last three screens of phase 8](#the-last-three-screens-of-phase-8-2026-11-08). The pairing editor turned out to be a missing *writer* rather than a missing screen: `brand_indications` could only be written by the importer. |

Phase 2 sits ahead of content deliberately — authoring profiles against a schema about to change
wastes the work. Phases 0–2 need nothing external. Phase 3 needs the class sheet.

**Phase 9 is removed** (2026-11-02, the owner's call). It was "content elaboration in batches
against the real sheet", and the measurement that killed it had already been made and written down
below: every defined field is fully populated — dosing 236/236, mechanism 236/236, route 236/236,
black box 90 warnings and 146 correctly none — so there was nothing to elaborate. Elaboration is
what *defining a new field* means now, which is phase 2 machinery plus authoring, not a phase of its
own.

### Phase 1 — auth, invites, and roles

No migration. `users`, `sessions`, `accounts` and `verifications` already match better-auth 1.7's
models, and `invites` + `invite_redemptions` already support multi-use codes. Every env var the
flow needs is passed through compose.

**Decisions** (2026-10-29)

| Question | Choice | Why |
|---|---|---|
| Where the admin seed runs | In-process on boot, from `instrumentation.ts`, skipped if an admin already exists | The password must be hashed by better-auth or login silently fails, and better-auth is only resolvable inside the bundled server — the runner image copies just `tsx`, `drizzle-orm` and `postgres` |
| Roles | Our own `users.role` + `users.status` | better-auth's admin plugin would need `banned`/`banReason`/`banExpires` added, leaving `banned` and `status` as two answers to "can this person log in". Phase 8's user management is a few lines against our columns; only impersonation is unique to the plugin, and it is not a feature here |
| Email verification | Off; the seeded admin is marked verified | No SMTP is configured. Phase 8's "trigger password reset" became *an admin sets a new password*, since nothing can be sent; and a self-service email change writes `email_verified = false`, because nobody confirmed the new address |

**Build order** — each step verifiable before the next:

1. **Auth core** — `lib/auth.ts` (drizzle adapter with `usePlural: true`, since our tables are
   plural; `role` and `status` declared as additional fields so they ride along in the session),
   `lib/auth-client.ts`, `app/api/auth/[...all]/route.ts`. Bootstrap seeds the `site_settings`
   singleton, which no row exists for yet, and the admin from env.
2. **Session helpers and guards** — `lib/session.ts` exposing `getSession`, `requireUser` and
   `requireAdmin`. `middleware.ts` does only the cheap cookie redirect; the authoritative check
   lives in layouts. A disabled user's session is revoked on its next request, and a student
   reaching `/admin` gets a real 403 page.
3. **Login page** — `app/(auth)/login`, plus sign-out. Register moved to step 4: a register
   page that ships before the invite gate is open registration, and `redirect('/login')` in the
   guards cannot typecheck under `typedRoutes` until the route exists, so login landed with step 2.
4. **Invite gate and register** — `lib/invites.ts` and `app/(auth)/register`. Claiming a code is one atomic statement
   (`update invites set uses = uses + 1 where id = ? and uses < max_uses and revoked_at is null
   and (expires_at is null or expires_at > now()) returning *`) so two classmates racing the last
   use of a code cannot both win. Registration honours `site_settings.registration_mode`.
5. **Minimal `/admin/invites`** — generate, list, revoke. Pulled forward from phase 8 because an
   invite gate with no way to mint a code cannot be tested.
6. **Tests** — `npm test` runs vitest against a throwaway Postgres container that global setup
   starts, migrates and drops, so a run can never touch the development database. Mocking it
   would defeat the point: only a real database can show that the invite claim is atomic.
   Guard behaviour (redirects, 403, session death on disable) is covered over HTTP rather than
   in vitest, since it needs the Next request context; see Verification.

Password reset, email change, the full user admin and the audit-log UI stay in phase 8.

A minimal app shell landed alongside phase 1: a site header with session-aware links, so the
pages are reachable without typing URLs. It links only to routes that exist, which `typedRoutes`
enforces for us. Reading the session there makes every page dynamic — accepted deliberately,
since nothing here benefits from being static. Real navigation, theming and the responsive pass
remain phase 7.

---

## Verification

**Infrastructure** — `docker compose up --build` brings `web` and `db` up healthy with migrations
applied; `down` then `up` preserves data in the named volume.

**Auth** — registration without a code is rejected; with a code it succeeds and decrements uses; a
spent or expired code fails; logged-out `/drugs` redirects; a disabled user's session dies on next
request; a student hitting `/admin` gets 403, not a blank page.

**Dynamic fields** — a field added in admin appears on profiles, in the field picker, and in the
registry without a restart. Renaming preserves existing values (keyed by stable id, not label).
Soft-delete retains values and restores them on undelete.

**Importer** — `sync-content.ts` run twice produces no diff the second time; editing one content
file updates exactly that drug; a value carrying an `updatedBy` is never clobbered without `--force`.

**Lookup panel** — a lookup writes nothing until a Use click; an inserted value lands in exactly one
field with the right `source`; a provider being down degrades to an inline
error on the panel and never blocks saving the drug; repeat lookups hit `lookup_cache` rather than
the provider.

**Study config** — the area to test hardest, since this is where a silent bug hides:
- Exclusive, 3 fields × 50 drugs → 150 distinct cards, each grading and scheduling independently.
- Inclusive, same selection → 50 cards, all three fields visible on each.
- Changing the field selection and returning resumes the original schedule rather than restarting
  (`card_key` stability).
- Hard-mode distractors all share the correct drug's class; the correct answer never appears twice.
- Inclusive `fields→drug` wrong options are single-drug composites, not cross-drug scrambles.

**Unit tests** (Vitest) on logic invisible in the UI: `lib/srs/` transitions, `lib/quiz/` distractor
selection, `lib/fields/` hot-column sync and `card_key` hashing, `lib/lookup/` response mapping,
`lib/dosing/` parsing and sig rendering.

**If `npm test` ever reports "No test files found", read this before believing it.** That message,
together with a `code.charCodeAt is not a function` stack out of Vite's sourcemap reader, is
vitest's error *printer* crashing while trying to print the real error — so the real error is never
shown, and the one you see is unrelated to what went wrong. **`npx vitest run --reporter=json`
prints the real error**, which is how the two causes below were found after a long and avoidable
detour chasing the test container, the published port, and the transform cache. None of those were
ever involved.

1. **A syntax error anywhere in `tests/global-setup.ts`** fails this way, since globalSetup is
   loaded before test discovery. It reports as zero test files rather than as a parse error.
2. **The config's own imports.** `vitest.config.mts` and `tests/test-db.mjs` carry those
   extensions deliberately. As `vitest.config.ts` importing `./tests/test-db` with no extension,
   the chain went through Vite's CommonJS config-loading path — which vite 8 warns is going away —
   and crashed vitest's startup on roughly half of all runs.

**It is reduced but not gone.** Making those extensions explicit cleared the vite warning and took
the failure from about one run in two to roughly one in three, and an earlier revision of this note
claimed it was fixed — it is not. When it strikes, `--reporter=json` reveals nothing underlying,
which distinguishes it from the two causes above: this residue is a vitest/vite 8 startup bug
rather than anything in this repo. **Re-run; it passes.** Do not read a single "No test files
found" as a broken suite, and do not go looking for the cause in the test container, the published
port, or the transform cache — all three were chased and none was ever involved.

**Per-user color** — overriding a class color changes it on browse, profile, and quiz for that user
and *not* for a second test account. Reset restores the admin default. The picker warns on a
sub-4.5:1 choice in either theme.

**Responsive** — every page at 390 px and 1440 px with no horizontal scroll; flashcard grading
reachable one-handed; browse table degrades to cards.

---

## Open items

**Queued by the owner, 2026-11-02** — in their words, to be worked after the quiz modes:

- **done — 2026-11-02.** ~~Saved study setups~~, picked off the list of what was left because
  `study_presets` had been sitting unread since phase 0 while every session started from a blank
  form. See *A study setup is a name you can click* above. Checked live: each page lists only its
  own setups, loading one starts the session it describes, saving the same name twice leaves one
  row, and a setup with nothing in it is refused.

  Also measured while picking: the flagged queue, the brand→indication pairing editor and the
  users admin are all listed as remaining work and all have nothing to act on — 0 flagged fields,
  0 brands needing pairing review, 1 user, 13 audit rows. Every defined field is fully populated
  (dosing 236/236, mechanism 236/236, route 236/236, black box 90 warnings and 146 correctly
  none), so there is nothing to elaborate until a new field is defined — which is what later
  removed the content-elaboration phase outright. What is genuinely left:
  **phase 7** (`/settings`: the theme toggle, the colour axis and the palette editor — nothing
  reads `user_preferences` yet) and **a dosing review bench** (71 of 236 drugs carry a regimen the
  parser could not fully decompose, 36 have no printed sig at all, and no screen lists them).

  Left alone by the owner's decision: Midazolam and Methylprednisolone sodium succinate both have
  dosing recorded as *Individualized*, which makes a question that teaches nothing. Keeping them.

- **done — 2026-11-02.** ~~The explanations under *Question shape*, *Direction* and *Priority*
  should appear on hover, and the `?` beside the title should be the only thing that opens them~~.
  They are long enough to be honest and so long enough to bury the controls they describe.
  `app/study/_components/hint.tsx` puts the prose in an absolutely-positioned popover — absolute
  so the form does not jump under the cursor, and anchored to the title row rather than to the
  mark, since anchored to the mark it would start halfway across the column and run off the right
  of a two-column form. No client boundary: hover and focus state on the mark.

  The mark is a real `<button>`, and it sits *outside* the `<label>`. Both are load-bearing. Hover
  alone would make the explanation unreachable for anyone not using a mouse — Tailwind compiles
  `group-hover` inside `@media (hover: hover)`, so on a phone it would never fire at all — and a
  button takes focus in sequence, which covers tabbing to it and tapping it alike. Inside the
  label, a tap would be forwarded to the select and open its options instead of the hint.
  `aria-describedby` on the control points at the hint, so a screen reader reads it with the field
  whether or not it is on screen.

- **done — 2026-11-02.** ~~Priority: a question you got wrong should be likelier to come back~~.
  Asked for, and worth having, because a capped paper was spending its 20 questions on 20
  arbitrary ones while the app already knew which 14 had been missed. See *A capped quiz asks what
  you got wrong first* above for the weights and the four decisions in them — the floor being the
  one that matters, since without it priority degenerates into re-sitting the same corner of the
  sheet forever. On by default, visible in the summary line, and off in one control.

- **done — 2026-11-02.** ~~Three wordings the sheet got wrong, left sitting in the data~~. Asked
  why an obvious error would not simply be fixed, which was the right question: a repair bench had
  just been built and nobody had yet *read the 92 words with it*. Two were the source PDF breaking
  a word across a line with the extractor keeping the break —
  `Keratoconjuncti vitis sicca` (p6) and `Ophthalmic anti- inflammatory` (p19) — and one was the
  sheet's own misspelling, `Pruritis` for pruritus (p12). All three went into the alias table in
  `lib/drugs/indications.ts` rather than being renamed in the database, because the sheet still
  says the wrong thing and a rename alone would let the next `npm run seed` file the sheet's
  spelling as a second row; migration 0006 corrected the rows already stored. Re-seeded to
  confirm: 0 new wordings.

  The editor now also warns when a new wording is **within two edits of one that exists** —
  "Dyslipidimia" is a character from "Dyslipidemia", which 10 drugs have. It only ever warns:
  nothing can tell a typo from an indication the vocabulary has not met, and a silent fold would
  file a drug under the wrong condition, which is worse than the untidiness. Note what this does
  *not* catch, and did not catch here — all three of these were one-off wordings with no
  near-neighbour to be near. That class needs a person reading the list, which the admin screen
  now makes a half-minute job.


- **done — 2026-11-02.** ~~A quiz finishes and the page breaks~~: `finishQuizAction` called
  `revalidatePath('/study/quiz')`, and that page is `force-dynamic` with a randomised draw. So
  finishing re-rendered the route, handed the runner a **different quiz**, and graded the answers
  just given against questions nobody was asked — `0 of 83`, `0%`, and a "what you missed" list
  from the new draw. The attempt row itself was always correct, which is why it looked like two
  bugs. The revalidate is gone (recent quizzes pick the row up on the next navigation, which is
  what the "Another quiz" link is), the runner now takes its questions once and never retakes them
  from props, and each draw carries its own `id` that keys the runner — so starting a quiz starts
  one and nothing else can swap it.
- **done — 2026-11-02.** ~~Per-drug and per-fact quiz modes~~: *Question shape* on the quiz page,
  the same `inclusive` / `exclusive` the flashcards use. Per fact is the default and asks each
  field on its own. Per drug puts every selected field into one question, so the options are whole
  *profiles* and the ask is which of four drugs this is — 472 questions over moa + dosing became
  236, with four facts' worth of evidence in each.

  A drug needs a value for **every** selected field to appear: a bundle short of a line is not
  merely incomplete, it is a tell. Two bundles are the same answer when every field's key matches,
  so the existing meaning-not-spelling comparison carries straight over, and the schedule *stays*
  in a bundle even though it is no question on its own — "not controlled" is a fine line of a
  profile, and the question here is whose profile it is. Both shapes go through the same two
  builders: a bundle is a candidate with one atom, which is why this cost almost no new code.
- **done — 2026-11-02.** ~~Controlled-schedule questions should only be asked of scheduled
  drugs~~: 212 of the 236 are not, so the quiz filled with questions whose answer was the same
  word and the 24 real schedules drowned in them — and asked the other way round, *"Not
  controlled — which drug?"* has 212 right answers. `askable()` in `lib/study/quiz.ts` now gates
  it, so the field is asked only of a scheduled drug and the options are therefore other
  schedules. 236 questions became 24. Nothing changed about what is stored: "not controlled" is
  still recorded and still stated on a flashcard.
- **done — 2026-11-02.** ~~A drug profile, reachable mid-session~~: both runners open it in a new
  tab. A session is in-memory, so navigating there and back would lose the quiz or restart the
  block.
- **done — 2026-11-02.** ~~Say "Correct" and "Your answer"~~, and on a wrong answer say what it
  *was* right about. Which half is missing depends on the direction: shown a drug and picking the
  wrong fact, the fact belongs to another drug, so name the drug; shown a fact and picking the
  wrong drug, name that drug's own value for the field. `QuizQuestion` carries `fromGeneric` and
  `fromFact` per option for it. Marked wrong teaches nothing on its own — the distractor was
  drawn from a real drug, usually a class-mate, which is exactly why it was tempting.
- **done — 2026-11-02.** ~~Quiz settings get out of the way once a quiz starts~~: a one-line
  read-only summary, with the form behind *"Change these and start a new quiz"* — which is honest
  about what changing one does, since it redraws the questions.
- **done — 2026-11-02.** ~~"Paper" is the wrong word~~: *Quiz settings*, *Previous quizzes*,
  *Another quiz*.
- **done — 2026-11-02.** ~~A sig glossary on the drug editing screen~~: a collapsed panel under
  the dosing preview on both the edit and the add screens, every row read off `lib/dosing/model.ts`
  rather than retyped — so the codes a person is shown and the codes the printer writes cannot
  drift apart. `PER_DAY_CODES` and `INTERVAL_LETTERS` moved out of `sig.ts` into the model for
  that reason, which is the only change to the printer. The panel explains the *output*: you write
  prose and the sig is printed from it, so the point being made is that `10 mg by mouth once a day`
  is what produces `10 mg PO QD`, and a word missing from the sig is a word the parser did not
  understand.

**Queued by the owner, 2026-11-03** — the home page, the top bar, and the account screen:

- **done — 2026-11-03.** ~~Spruce up the home page with stats, links that restart the last deck and
  the last quiz instantly, and buttons to each area~~. Four counted tiles, a *Pick up where you left
  off* pair, the saved setups as chips, and a card per area. See
  [A front door, and a face on it](#a-front-door-and-a-face-on-it-2026-11-03) for the two decisions
  worth keeping: the weakest-field tile is the only one that is an instruction rather than a record,
  and "last used" needed somewhere new to live — a named setup is a deliberate act and most sessions
  never get one.

  Measured on the running app while building it: 3 cards due of 3 scheduled, 84% over 88 answers and
  2 quizzes, weakest field *Brand names* at 18 of 23, 236 drugs across 119 classes and 352 brands.

- **done — 2026-11-03.** ~~The top bar links should be more stylish, and the email should be a
  profile circle that opens account settings~~. Pills with the current one filled; the email became
  the avatar, which falls back to initials off the display name, or off the **local part** of the
  email so a classful of `@gmail.com` accounts do not all read "G".

- **done — 2026-11-03.** ~~Account settings: display name, password change, profile picture~~.
  `/account`, kept apart from `/settings` — see
  [An account is not a setting](#an-account-is-not-a-setting-2026-11-03). The picture is a 160px
  square resized in the browser and stored on the user's own row; SVG is refused because the string
  ends up in an `<img src>` other people will render.

  **Asked at the same time, and the answer was no:** there is no admin account-management screen,
  and before this there was no password change anywhere. There is now, for your own password. What
  is still missing is the admin side — listing users, changing a role, disabling an account,
  force-logout, and setting a new password for somebody who has forgotten theirs. That last one is
  the only route a forgotten password has, since there is no mailer, so the users admin is now the
  gap with a real consequence rather than a tidy-up.

- **done — 2026-11-03.** ~~The users admin~~, picked up immediately after, for the reason the
  paragraph above gives: it is the only route back into a locked-out account. `/admin/users` lists,
  searches, changes a role, disables and enables, signs an account out everywhere, sets a new
  password, and deletes. See [The only way back in](#the-only-way-back-in-2026-11-03) — the rule
  worth remembering is that lockout is prevented by *who the actor is*, not by counting admins: you
  cannot change the role on, disable, or delete your own account, and your own row simply does not
  offer those three.

  Verified live on a throwaway classmate account created and deleted by the check, with the real
  admin row only ever read: every write exercised, both self-guards refusing by message, a set
  password whose hash the sign-in verifier accepts, and the roster back to one account.

- **done — 2026-11-03.** ~~Seasonal themes with dynamic elements~~. Four of them plus `auto`, in
  `/settings` and as a site default in `/admin/look`. The decision that shaped it:
  [A season is not a theme](#a-season-is-not-a-theme-2026-11-03) — it is a second setting, layered
  over light-or-dark rather than replacing it, touching only a wash and two ornament colours. The
  contrast check written for it found that light `--muted` had been sitting at 4.72:1 all along;
  it is now 5.98.

  Asked for alongside it, and built the same day once the owner said yes to all seven: the
  light-and-dark decorations. See
  [The light and the dark get their own weather](#the-light-and-the-dark-get-their-own-weather-2026-11-03).

- **done — 2026-11-03.** ~~Let the wider theme match the season too~~, and ~~stop the motes
  drifting behind text — a leaf through a paragraph makes it harder to read~~. The second is the one
  worth remembering: the fix is occlusion, not a lower opacity, because the eye follows the moving
  thing. `<header>` and `<main>` paint their own grounds and the layers pass behind them, which
  leaves the weather in the gutters and nothing on a phone. See
  [Nothing drifts behind text](#nothing-drifts-behind-text-2026-11-03) and
  [The season, let into the chrome](#the-season-let-into-the-chrome-2026-11-03).

  Also **done — 2026-11-03**: ~~all seven of the light/dark dynamic elements~~ from the list put up
  the same afternoon — starfield, sunbeam, dust, paper grain, clock warmth, focus ring, streak glow,
  idle wordmark. Four under one `ambience` switch, three with no switch at all. The contrast test
  written for the seasons caught a *second* pre-existing near-miss while they went in: light
  `--accent` had been sitting at 4.52:1, and every link in the app is drawn in it.

- **done — 2026-11-03.** ~~Change the associated email~~. On `/account`, and it needs the current
  password — the email *is* the sign-in name, so a borrowed session must not be able to move the
  account to somebody else's address. See
  [Changing the address you sign in with](#changing-the-address-you-sign-in-with-2026-11-03) for
  why better-auth's own `changeEmail` is not used (it is built around a verification email) and why
  `email_verified` goes to false (nobody confirmed the new address). Nothing is sent to either
  address, and the page says so rather than leaving someone waiting.

**Queued by the owner, 2026-11-03** — three things found by using it:

- **done — 2026-11-03.** ~~The quiz screen does not need a Flashcards link at the top right~~.
  Gone. It was a leftover from when the two study pages were new and needed pointing at each other;
  the top bar now carries both, and a cross-link in the corner of a page you are already on is one
  more thing between the heading and the form.

- **done — 2026-11-03.** ~~Theme and cosmetic choices do not stay put in the selectors after
  saving~~, even though the page visibly changes. Not this app's bug, but this app's to fix: React
  resets a form after its action resolves, and a `<select>`'s `defaultValue` is never reapplied
  after mount, so an uncontrolled select snaps back to what it was first rendered with. See
  [A form action resets the form](#a-form-action-resets-the-form-2026-11-03) — including the two
  editors that have the same bug and were deliberately left for their own pass.

- **answered — 2026-11-03.** *Does a dosing question name the drug in a way that fits the
  brand↔indication links, and is the question side randomised between brand and generic?* **No to
  both, and the second is why the first has not bitten.** Every prompt in both study modes is built
  from `{{generic}}`: *How is Sildenafil dosed?*. A brand is only ever the **answer** (generic →
  brands) or the **clue** (brands → generic), which is the safe direction down the fan in
  *Direction decides what counts as correct* — so no question currently crosses from one brand's
  branch to another's, because no question starts at a brand at all. `drug_brands.dosing_override`
  reaches the profile screen and nothing else.

  Randomising the stimulus would land straight in the fan rule, and the data was not ready for it.
  Of 352 brands, 15 are narrowed to a branch, covering 6 drugs, and only 4 are genuinely split
  (bupropion, fluoxetine, sildenafil, tirzepatide — albuterol and digoxin turned out uniform).
  **That is a count of brands partitioning indications, not of doses that differ** — a distinction
  worth keeping straight, since only sildenafil needs its dose split. See
  [Only one drug splits its dose by brand](#only-one-drug-splits-its-dose-by-brand-2026-11-04).

  **The dose half of that is now built**, on the owner's call the same day: see
  [A dose can belong to one indication](#a-dose-can-belong-to-one-indication-2026-11-03).
  `dosing_regimens` carries an indication, sildenafil's two doses are two rows, and the quiz asks
  *How is Sildenafil dosed for erectile dysfunction?* rather than keying one branch as the answer.
  Randomising brand-for-generic on the *stimulus* is still not built and still wants the fan rule
  thought through properly.

**Queued by the owner, 2026-11-03** — a second pass over the same two screens:

- **done — 2026-11-03.** ~~The selectors still do not stay put, on the settings page and the admin
  page both~~. The first fix was wrong: controlled state does not survive `form.reset()`, because
  the reset dispatches no change event for React to restore from and changes nothing in state to
  re-render from. Fixed properly by not using `action` at all. Written up in full, including what I
  got wrong and why no test could have caught it, in
  [A form action resets the form](#a-form-action-resets-the-form-2026-11-03).

- **done — 2026-11-03.** ~~The streak visual is not there~~. It was, and it was invisible: a
  one-day run drew three pixels of blur. Now a chip with a ring that does not depend on the run
  length. See *The light and the dark get their own weather* above.

- **done — 2026-11-03.** ~~Centre the top-bar links~~. A three-column grid at `sm` and up, outer
  columns at `1fr`, so the pills are centred on the *page* rather than in whatever is left beside
  the wordmark — which is what `mx-auto` on a flex child gives, and which drifts as the account end
  changes width (the Admin pill is not always there). Below `sm` it is a centred wrapping flex row
  again, because five pills, a wordmark, an avatar and Sign out do not fit on a phone in any
  arrangement.

- **done — 2026-11-03.** ~~Drop the saved-setups section and the admin card from the home page, and
  redo the resume wording~~. The setups list and its two queries are gone — `/study/setups` and
  each study page's own setup bar still have them, and the home page was a third place to read the
  same list. Admin goes for the reason it was the fifth of four: the pill is in the top bar on
  every page already, and a fifth card turned a row of four into 3 + 2.

  The wording was three metaphors for one thing — *Pick up where you left off*, over *Sit that quiz
  again* and *Carry on with that deck* — and it promised something it does not do: nothing is
  resumed here, a fresh session is started with the settings used last. It now says **Start
  another**, names the thing (*Quiz*, *Flashcards*), and states what is being reused (*Same
  settings as last time*) above the settings themselves in words.

- **done — 2026-11-03.** ~~Let the season show through the middle of the home page, but not behind
  the blocks of text~~. `main.open` and `.plate`, written up under
  [Nothing drifts behind text](#nothing-drifts-behind-text-2026-11-03).

- **done — 2026-11-03.** ~~The streak chip looks bad, redesign it~~. It did. Replaced with a pill
  whose fill deepens with the run and which blurs nothing — third attempt, written up with the two
  failed ones under *The light and the dark get their own weather* above, since what each got wrong
  is the reason the third is shaped as it is.

**Queued by the owner, 2026-11-03** — the brand dosing, the reset everywhere, and the bench:

- **done — 2026-11-03.** ~~Fix the brand dosing problems, because sildenafil being in two brands
  both on top drugs with different dosing needs fixing~~. A dose can now belong to one indication,
  read out of the prose rather than assigned beside it. See
  [A dose can belong to one indication](#a-dose-can-belong-to-one-indication-2026-11-03) — including
  the two things that went wrong on the way, one of which (tagging notes into strings and reading
  them back with a regex) broke on contact with a note that had its own colon in it.

- **done — 2026-11-03.** ~~Fix the reset bug everywhere~~. It was live in seven more forms, the
  worst being the tag member picker: its 236 membership checkboxes are controlled, and a reset
  leaves a controlled checkbox unchecked in the DOM with state still holding it, so *saving a list
  appeared to clear it*. One helper now carries the explanation,
  `app/_components/submit.ts`, and `tests/form-reset.test.ts` enumerates every
  `<form action={...}>` left in `app/` and requires each to be one of six with a written reason —
  all of them create forms or bare buttons, where the reset is the behaviour rather than the bug.

- **begun — 2026-11-03.** ~~Begin the dosing review bench~~ — built and working, at
  `/admin/dosing`. See [The dosing review bench](#the-dosing-review-bench-2026-11-03). What is
  deliberately *not* in this first pass: editing a single regimen row rather than the whole prose
  (the prose is the source, so per-row editing needs the "leave this one alone" flag first), the
  per-route and per-population axes, and any bulk action. The queue is 76 rows and the work is
  reading, not clicking.

**Queued by the owner, 2026-11-04** — one correctness report and six rounds of polish. All done;
see [An answer that belongs to nine drugs](#an-answer-that-belongs-to-nine-drugs-2026-11-04) and
[The chrome the browser was drawing](#the-chrome-the-browser-was-drawing-2026-11-04).

- **done — 2026-11-04.** ~~The disclaimer box on the home page looks gross; minimalist, bottom
  centre~~.
- **answered — 2026-11-04.** *"So a confirm box will be in the check queue for doses that don't
  have a sig translation, like individualized and titrations?"* — yes, and it was already there:
  **The source really is like that** on each row of `/admin/dosing`. It leaves the wording exactly
  as written and takes the row out of the queue, which is the difference between *nobody has looked
  at this* and *somebody looked and this is the answer*. Seventeen drugs want it, and the page says
  out loud that emptying the queue is not the goal.
- **done — 2026-11-04.** ~~A schedule question marked wrong shows only methylphenidate, not all
  the CII meds~~. Fixed at the question rather than at the sentence: an option now carries every
  drug it is true of.
- **done — 2026-11-04.** ~~Shrink the area above the question in quiz and flashcard mode; bump the
  smallest text site-wide; make the brand name on a profile more visible~~.
- **done — 2026-11-04.** ~~Theme the scrollbar everywhere including the decorations, and make the
  top-bar selected indicator match rather than being blue~~.
- **done — 2026-11-04.** ~~Restyle the drug info panel after a question or card, and the drug
  profile view, without compromising readability~~.
- **done — 2026-11-04.** ~~Add an *Again* button on the quiz results screen, beside *Another
  quiz*, that starts a new quiz with the same parameters~~.

**Queued by the owner, 2026-11-04 (second pass)** — four screenshots and six notes. All done; see
[Four screenshots and what they cost](#four-screenshots-and-what-they-cost-2026-11-04).

- **done.** ~~Every link that looks like the *Another quiz* button should be a button like
  *Again*~~, and ~~every button should match the current theme — *Again* is the wrong colour~~.
- **done.** ~~The brand-name redundancy on the profile is unnecessary; remove the *Sold as* line
  and the Identity section, and replace it with a drug class section~~.
- **done.** ~~Remove all but the Top Drugs 2026 tag~~ — the 65 therapeutic categories were a
  judgement nobody asked for. Reversible: `scripts/seed-categories.ts`, or the file
  `scripts/prune-tags.ts` wrote to `backups/`.
- **done.** ~~In the lookup panel, drop the band and the *Sold as* line for a brands line more
  like the profile's~~ — which also restored the indications the panel had never shown.
- **done.** ~~The opaque boxes behind the heading text on the home page look weird; remove them~~.

**Queued by the owner, 2026-11-04 (third pass)** — the buttons:

- **done — 2026-11-04.** ~~Make the buttons like *Again* follow the theme more closely: icy blue for
  winter, petal pink for spring, sunny yellow for summer, an autumn orange or red for autumn, with
  light and dark left to me~~. Those four, plus a cool slate and a cool near-white for the two
  seasonless themes. The design is one decision and the rest follows from it: the fills are pale,
  so the button needs a third token for its boundary or it cannot be told from the page. See
  [The button gets a colour of its own](#the-button-gets-a-colour-of-its-own-2026-11-04).

- **done — 2026-11-04.** ~~Hovering the pfp and the Sign out button does not follow the
  theme/season~~, and ~~there is still blue link text in the drug profile and the quiz screen that
  should be pills — do a once-over for more, like the admin UI~~. One cause for both: `--accent` is
  the link colour and the seasons never move it, and everything that was not quite a button was
  wearing it. `.pill` is now shared by every target in the app, the hovers point at `--btn-edge`,
  and the admin index is a grid of cards like every other index. See
  [The rest of the blue](#the-rest-of-the-blue-2026-11-04) — including the two guards that keep it
  from coming back, and the three kinds of link the line is drawn between.

- **done — 2026-11-04.** ~~Site settings~~, picked off the list of what is left because
  `registration_mode` is a lock the app could not turn: the register page refuses a stranger because
  of it, and changing it meant SQL or a restore. `/admin/site` edits the name, the mode and the
  disclaimer. The name needed wiring before it could be a setting at all — it was stored and read
  nowhere, with all eighteen page titles appending the default themselves. See
  [What the site is called](#what-the-site-is-called-2026-11-04).

  What is left after this: **the audit UI**, which is the last gap in phase 8 with anything in it
  (seven modules write `audit_log`, nothing reads it, and the site-settings rows above are the
  newest entries); the flagged queue, bulk field-set and the brand↔indication pairing editor, all
  three screens over queues that are empty today; and the one non-code item, a reverse proxy
  terminating TLS on the server, which compose assumes and the repo does not contain.

  **The TLS item is closed, 2026-11-04**, on the owner's call: the server already runs a reverse
  proxy, and terminating TLS there is that proxy's job rather than this repo's. Nothing to build,
  and nothing was ever going to be — `docker-compose.yml` already binds both services to
  `127.0.0.1` with the comment saying why. What remains is a deployment note, not work, and it is
  one line: **`BETTER_AUTH_URL` must be the public `https://` origin**, because `lib/auth.ts` passes
  it straight to `baseURL` and that scheme is what decides whether the session cookie is marked
  `Secure`. Left at the dev value, sign-in would work and the cookie would travel in clear. The
  loopback bindings keep the containers themselves unreachable off-box. So the list is three screens
  and the audit UI — all code, all in this repo.

  **The activity log asked for the same day is deliberately not on this list.** It is a second
  screen over a different question, it needs writes in the auth path that do not exist yet, and 1.0
  does not want to grow. After. See [Two logs, not one](#two-logs-not-one--planned).

  **All four are done, 2026-11-08, and 1.0 is complete.** The audit UI, then the flagged queue, the
  brand pairing editor and bulk field set — see
  [The log that nobody could read](#the-log-that-nobody-could-read-2026-11-08) and
  [The last three screens of phase 8](#the-last-three-screens-of-phase-8-2026-11-08). 855 tests
  across 44 files, every screen driven on the running container.

  Worth saying plainly, since the owner's reason for pushing through was *I need to study*: **none
  of these four screens is a study feature.** They are the tools that keep the content honest — a
  queue for doubted values, an editor for an assertion that could not be corrected, a safe way to
  record a fact 180 times, and a readable history of all of it. The studying was already built. What
  comes next was going to be [imported
  sets](#a-second-section-imported-sets--planned), which was where new material would have got in;
  that was built and then scrapped on 2026-11-09, so what comes next is whatever the drug section
  still needs.


0. **Read the URL the form produces, not the one you typed** (2026-11-02). Both study pages parsed
   `fields` as a comma-joined string, but the field picker is a checkbox group: it submits
   `fields=moa&fields=dosing`, which arrives as an *array*. One field worked and two threw
   `.split is not a function`, so the Start button 500'd for any real selection -- on the quiz and
   on the flashcards both. Every live check I had run used a URL I wrote by hand, which is the one
   shape that never fails. `lib/study/search-params.ts` now parses both shapes in one place, tested,
   and the live check is the exact query string the form emits.


1. **20 drugs show as *Uncategorized*, and that is their answer for now** (2026-11-01). They are
   not unresolved: all 237 resolve to an RxCUI, and each of the 20 has an ATC or VA candidate
   recorded. What they lack is an FDA **EPC**, the one class vocabulary this project trusts —
   vitamins and electrolytes (folic acid, phytonadione, potassium chloride, omega-3, icosapent),
   anticonvulsants with no EPC entry (gabapentin, pregabalin, topiramate, levetiracetam,
   divalproex), drugs that are their own class (lithium, buspirone), newer CNS agents and a
   biologic, chlorhexidine, and methenamine.

   Promoting their ATC or VA candidate was considered and rejected: class drives colour coding
   *and* same-class distractor generation, so mixing EPC's `HMG-CoA Reductase Inhibitor` with VA's
   `ANTICONVULSANTS` would give an incoherent axis and unreliable "same class" grouping.
   `drug_class` therefore stays null, `lib/drugs/drug-class.ts` renders null as *Uncategorized*,
   and the browse filter offers it as its own option. `class_candidates` and `class_suggestion`
   are kept for whenever someone wants to revisit. **16 of the 20 still carry a ranked hint.**
2. **done — 2026-11-01.** ~~7 drugs need brand↔indication pairing confirmed~~: the five that
   reached the database (albuterol, bupropion, digoxin, fluoxetine, tirzepatide) are paired, and
   the four suspect brand defaults cleared, by `scripts/fill-review-gaps.ts` — Mounjaro→diabetes,
   Zepbound→weight management and OSA, the Wellbutrin family→depression, Zyban→smoking cessation,
   Prozac→depression, Sarafem→PMDD. Albuterol and digoxin turned out to be uniform rather than
   split: every brand carries the same label. The same script fills the **18 routes** the sheet
   never stated, which had cost those drugs their route card.

   Both sets are assertions from FDA labelling rather than sheet facts, so each value carries its
   own reason in `source`, and the whole set is one reviewable table in that script rather than
   being folded into `drugs-seed.json`. A later `npm run seed` leaves it alone — checked by
   re-running: `236 unchanged, 0 brand links`. (These landed `unverified` at the time; the status
   became `ok` when verification was removed on 2026-11-02, and the reason in `source` is what
   carried the meaning anyway.)

   **Study coverage, measured on the running app after this:** every one of the 236 drugs now
   produces a card for brand, indication, route, dosing, MOA, black box warning and controlled
   schedule. Drug class covers 216, and the 20 it misses are the *Uncategorized* drugs from
   item 1 — a consequence of that decision rather than a separate gap. No drug is excluded from
   a deck any more. The one exclusion still ahead is phase 6's: the 31 dosing strings that do not
   parse cannot be asked as *multiple choice*, though they remain fine as free recall.
3. **Estradiol's variant dosing is not imported.** The sheet gives it newline-separated product
   families (Vivelle-Dot / Alora / Climara, then Femring / Estring / Vagifem / Divigel) against
   "product dependent" dosing. The importer refuses to turn that into brand rows rather than
   guess; `drug_brands.dosing_override` is where a human puts it in the drug editor.
4. **done — 2026-11-02.** ~~No way to create a tag yet~~: `/admin/tags` creates, renames and
   deletes lists, and `/admin/tags/[slug]` sets membership from a columned checklist of every drug
   in the database. The whole roster rather than a search-and-add, because the only way to see
   whether a list is right is against the drugs that are *not* on it. Categories appear there
   read-only, for the reason in the decision above.
5. **Librarian email** re: Micromedex API entitlement. If yes, another `lib/lookup/` adapter.
6. **Tag labels** — the sheet supplies the 2026 list edition and the P1/P2/P3 year levels, so the
   remaining question is only whether individual courses get their own tags.
7. **done — 2026-11-03.** ~~Sildenafil's dosing question teaches one branch as the whole
   answer~~. Fixed properly rather than patched: a dose can now belong to one indication. See
   [A dose can belong to one indication](#a-dose-can-belong-to-one-indication-2026-11-03).
6. **Not in v1, deliberately:** PWA/offline, pill images, interaction checking, shared classmate
   decks, analytics dashboards. All additive on this schema.
