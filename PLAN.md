# Enkephalin — Pharmacy Drug Study Site

> Working plan. This file is the canonical record — update it as decisions change.
> Last revised: 2026-11-01

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
every drug has one adult row at its standard route.

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

**Theming & per-user color** (`/settings`) — light/dark/system, persisted per user, applied
server-side to avoid a flash on load. Choose the **color axis** (drug class, schedule, a tag kind, or
off) and **override any individual color** in a palette editor. Admin sets the site default palette;
per-user overrides layer on top. The picker validates each color against both light and dark
surfaces and warns below 4.5:1 rather than silently allowing unreadable text. Color is never the only
signal — every badge carries text, which also covers color-vision deficiency. Reset-to-default per
entry and for the whole palette.

**Admin** (`/admin`):

- **Users** — list, search, change role, disable/enable, force-logout, trigger password reset, delete.
- **Invites** — generate (max-uses, expiry, note), revoke, see who redeemed what.
- **Fields** — create, rename, reorder, regroup, retype, set enum options, mark quizzable, set the
  prompt template and lookup mapping, soft-delete.
- **Drugs** — create/edit/delete with lookup panel, bulk tag, bulk field-set, merge duplicates, run
  the sheet importer.
- **Tags** — CRUD, kind, default color, merge.
- **Flagged queue** — every field anyone has flagged, most-quizzed first: the fields where a wrong
  value costs most.
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
| 7 | Per-user palette editor, theming pass, responsive polish at both breakpoints |
| 8 | **drug + tag editors done — 2026-11-02** — `/drugs/[slug]/edit` and `/drugs/new` write through `lib/drugs/mutations.ts`: identity, brands, indications, assignable tags and every stored field with its own source and status, plus a live sig/readback preview beside the dosing prose. `/admin/tags` and `/admin/tags/[slug]` write through `lib/tags/mutations.ts`: create, rename, delete, and set membership from a columned checklist of all 236 drugs. `/admin/data` exports and restores the whole database as one JSON file (`npm run export` / `npm run restore` for a timer). Dosing: a *unique/complicated sig* checkbox settles a sig the parser cannot read, rather than leaving it as review work forever. Remaining: **lookup panel**, drug delete/merge, the brand↔indication pairing editor, bulk field-set, users, flagged queue, settings, audit UI |
| 9 | Content elaboration in batches against the real sheet |

Phase 2 sits ahead of content deliberately — authoring profiles against a schema about to change
wastes the work. Phases 0–2 need nothing external. Phases 3 and 9 need the class sheet.

### Phase 1 — auth, invites, and roles

No migration. `users`, `sessions`, `accounts` and `verifications` already match better-auth 1.7's
models, and `invites` + `invite_redemptions` already support multi-use codes. Every env var the
flow needs is passed through compose.

**Decisions** (2026-10-29)

| Question | Choice | Why |
|---|---|---|
| Where the admin seed runs | In-process on boot, from `instrumentation.ts`, skipped if an admin already exists | The password must be hashed by better-auth or login silently fails, and better-auth is only resolvable inside the bundled server — the runner image copies just `tsx`, `drizzle-orm` and `postgres` |
| Roles | Our own `users.role` + `users.status` | better-auth's admin plugin would need `banned`/`banReason`/`banExpires` added, leaving `banned` and `status` as two answers to "can this person log in". Phase 8's user management is a few lines against our columns; only impersonation is unique to the plugin, and it is not a feature here |
| Email verification | Off; the seeded admin is marked verified | No SMTP is configured. Defers phase 8's "trigger password reset", which needs a mailer first |

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
  none), so phase 9 has nothing to elaborate until a new field is defined. What is genuinely left:
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
6. **Not in v1, deliberately:** PWA/offline, pill images, interaction checking, shared classmate
   decks, analytics dashboards. All additive on this schema.
