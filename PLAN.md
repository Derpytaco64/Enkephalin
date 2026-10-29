# Enkephalin — Pharmacy Drug Study Site

> Working plan. This file is the canonical record — update it as decisions change.
> Last revised: 2026-10-28

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
Converting Enzyme Inhibitor* — rather than in database register. **216 of 237 (91%)** have one. ATC,
MoA, and VA classes are captured alongside as candidates but are not promoted automatically: ATC
classifies by *product*, so it mislabels topiramate as an anti-obesity drug via its
phentermine/topiramate combination sibling. The remaining **21 drugs fall to a human pick** from the
captured candidates rather than being guessed.

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

This produces a **hint, never an assignment** — 17 of the 21 get one; `drug_class` stays null and
the drug stays in the review queue either way. The remaining 4 (buspirone, chlorhexidine,
phytonadione, potassium chloride) have no defensible hint and are left blank rather than guessed.

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

**Micromedex's legitimate role is human verification**: look a drug up, write the fact into the
profile *in your own words*, record `Micromedex, accessed <date>` in that field's source note. Facts
aren't copyrightable; only expression is. That is ordinary studying with a citation trail, and it is
what the verification workflow below exists for.

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
`source: dailymed` (or `rxnorm`/`openfda`) and `status: unverified`. Nothing is written without an
explicit click. Label prose is long, so each suggestion shows a trimmed preview with the full text
expandable, and the field stays editable after insertion — the normal workflow is pull, then
rewrite into exam-shaped language.

Brand↔generic and drug class from RxNorm are the exception worth trusting nearly as-is; MOA, dosing,
and adverse reactions from SPL labels always need hand-trimming.

### Accuracy guard

Content starts as sheet-derived, AI-elaborated, or label-derived. Two mechanisms, built in from the
start:

1. **Per-field** `verification_status` (`unverified` / `verified` / `flagged` / `not_applicable`) —
   not per-drug. A drug's MOA can be trusted while its renal dosing is still unchecked. Unverified
   values render with a marker; study sessions can be filtered to verified-only.

   `not_applicable` exists because of the sheet: 62% of drugs have no black box warning and 90% are
   not controlled. Those blanks are *answers*, not gaps. Without the distinction the verification
   queue would show 147 phantom missing warnings, and a flashcard would ask for a black box warning
   that doesn't exist. Blank-but-applicable and blank-because-none-exists must not look alike.
2. **Per-field source note** recording where it was confirmed.

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
per-field verification and citations live.

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
drug_indications  id, drug_id, text, sort_order
drug_brands       id, drug_id, name, route, form, dosing_override, sort_order, note
brand_indications brand_id, indication_id
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
  scope:     { tags: [], classes: [], schedules: [], verifiedOnly: bool, dueOnly: bool },
  yearLevel: "P1" | "P2" | "P3" | null,   // preselects fields from field_defs.year_levels
  fields:    ["moa", "indication", "adverse_effects"],   // any defined field
  mode:      "inclusive" | "exclusive",
  direction: "drug→fields" | "fields→drug" | "field→field",
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

The field picker saves as a named preset ("P2 midterm — MOA + AE, exclusive, verified only"). Missed
quiz questions push their cards to due in `study_cards`.

---

## Features

**Browse & search** (`/drugs`) — fuzzy search over generic, brand, class. Filter rail: class,
schedule, tags grouped by `kind`, verification status, and missing-field (find everything with no
MOA yet). Dense table on laptop / card list on phone from one responsive component. Filter state in
the URL so views are bookmarkable.

**Drug profile** (`/drugs/[slug]`) — header with generic, brands, class chip, schedule badge. Body
renders `field_defs` in `sort_order`, grouped, honoring per-user visibility and ordering. Each field
shows its verification marker, source note, and a one-click verify. Sidebar: tags, and other drugs
in the same class for contrast-and-compare.

**Drug editor** (admin) — create/edit a card field by field, with the lookup panel alongside. Pull a
suggestion into a field, rewrite it into exam language, mark verified when confirmed against
Micromedex or lecture.

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
- **Verification queue** — sorted by most-quizzed-but-unverified: the fields where a wrong value
  costs most.
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
| 3 | **done** — `extract-top-drugs.py` (237 drugs), `fetch-drug-classes.py` (237 resolved, 216 classed), `build-seed.py` → `data/drugs-seed.json`. Remaining: `sync-content.ts` to load it into Postgres |
| 4 | Browse + search + filters + drug profile (bulk of the UI) |
| 5 | Shared study-config component + flashcards + SRS |
| 6 | Quiz + distractor generation + scoring + history |
| 7 | Per-user palette editor, theming pass, responsive polish at both breakpoints |
| 8 | Admin: drug editor + **lookup panel**, users, invites, tags, verification queue, settings, audit, export |
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
file updates exactly that drug; a `verified` field value is never clobbered without `--force`.

**Lookup panel** — a lookup writes nothing until a Use click; an inserted value lands in exactly one
field with the right `source` and `status: unverified`; a provider being down degrades to an inline
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
selection, `lib/fields/` hot-column sync and `card_key` hashing, `lib/lookup/` response mapping.

**Per-user color** — overriding a class color changes it on browse, profile, and quiz for that user
and *not* for a second test account. Reset restores the admin default. The picker warns on a
sub-4.5:1 choice in either theme.

**Responsive** — every page at 390 px and 1440 px with no horizontal scroll; flashcard grading
reachable one-handed; browse table degrades to cards.

---

## Open items

1. **21 drugs need a drug class confirmed** — 17 arrive with a ranked hint (topiramate →
   *ANTICONVULSANTS*, gabapentin → *ANTICONVULSANTS*, mirtazapine → *ANTIDEPRESSANTS,OTHER*); 4 need
   a manual pick. One click each in the verification queue.
2. **7 drugs need brand↔indication pairing confirmed**: albuterol, bupropion, digoxin, divalproex,
   fluoxetine, lamotrigine, tirzepatide. Tirzepatide is the one that matters most —
   Mounjaro/Diabetes vs Zepbound/Weight management. Four brands additionally carry a
   `default_pairing_suspect` warning.
3. **Librarian email** re: Micromedex API entitlement. If yes, another `lib/lookup/` adapter.
4. **Tag labels** — the sheet supplies the 2026 list edition and the P1/P2/P3 year levels, so the
   remaining question is only whether individual courses get their own tags.
5. **Not in v1, deliberately:** PWA/offline, pill images, interaction checking, shared classmate
   decks, analytics dashboards. All additive on this schema.
