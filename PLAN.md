# Enkephalin — Pharmacy Drug Study Site

> Working plan. This file is the canonical record — update it as decisions change.
> Last revised: 2026-11-03

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
| Container | `docker compose`: `web` + `db` + volume | Reverse proxy (Caddy/Traefik/nginx) assumed already on the server |

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
season reach the chrome — grounds, surfaces and borders — instead of staying a wash. See
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

**Admin** (`/admin`):

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
  value costs most.
- **Dosing review** — the regimens the parser could not fully read, worst first, with the prose
  editable in place and a live readback. **Done 2026-11-03**; see
  [The dosing review bench](#the-dosing-review-bench-2026-11-03).
- **Who else the answer is right about** — a wrong *and* a right answer name every drug they belong
  to, which for the controlled schedule is nine. **Done 2026-11-04**; see
  [An answer that belongs to nine drugs](#an-answer-that-belongs-to-nine-drugs-2026-11-04).
- **Again** — a new paper from the settings the last one was drawn with, from the results screen.
  **Done 2026-11-04.**
- **Site settings** — name, registration mode, default theme and palette, disclaimer text.
- **Data** — JSON export/backup and restore.
- **Audit log** — who changed what, with diffs.

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
| 8 | **drug + tag editors done — 2026-11-02** — `/drugs/[slug]/edit` and `/drugs/new` write through `lib/drugs/mutations.ts`: identity, brands, indications, assignable tags and every stored field with its own source and status, plus a live sig/readback preview beside the dosing prose. `/admin/tags` and `/admin/tags/[slug]` write through `lib/tags/mutations.ts`: create, rename, delete, and set membership from a columned checklist of all 236 drugs. `/admin/data` exports and restores the whole database as one JSON file (`npm run export` / `npm run restore` for a timer). Dosing: a *unique/complicated sig* checkbox settles a sig the parser cannot read, rather than leaving it as review work forever. Lookup panel done 2026-11-02 — see [A lookup you cannot reach mid-question](#a-lookup-you-cannot-reach-mid-question-2026-11-02). Delete and merge done 2026-11-03 — see [Two rows that should never have been two](#two-rows-that-should-never-have-been-two-2026-11-03). Home page, the pill nav, the avatar and `/account` done 2026-11-03 — see [A front door, and a face on it](#a-front-door-and-a-face-on-it-2026-11-03) and [An account is not a setting](#an-account-is-not-a-setting-2026-11-03). Users admin done 2026-11-03, and the self-service email change with it — see [The only way back in](#the-only-way-back-in-2026-11-03) and [Changing the address you sign in with](#changing-the-address-you-sign-in-with-2026-11-03). Remaining: the dosing review bench, bulk field-set, the brand↔indication pairing editor, the flagged queue, site settings, the audit UI |

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
