# Enkephalin

A self-hosted drug study site for pharmacy school. Flashcards and multiple-choice
quizzes over a drug database you own and edit, running as two containers on your
own hardware.

## The idea it is built around

**A study set is a table, not a deck of cards.** That one decision is where
most of the behaviour comes from.

Flashcard apps store a front and a back. This stores drugs with columns —
generic name, brand, indication, dosing, mechanism, controlled schedule, black
box warning — and *generates* the cards. Which means:

- **Wrong answers are other drugs' real answers.** A question about
  methimazole's mechanism draws its distractors from the mechanism column of
  other drugs, preferring ones in the same class. Nothing is invented, and
  nothing is implausible.
- **You pick the axis, not the deck.** Any set of columns, in either direction
  (drug → facts, or facts → drug), scoped by drug list, therapeutic category,
  indication, route, schedule or program year.
- **One fact, one schedule.** In exclusive mode every column gets its own card
  and its own spaced-repetition state, so the dosing you keep missing comes back
  without dragging the mechanism you already know along with it.
- **A question refuses rather than lies.** If a column has nothing to put beside
  the right answer, no question is produced. It will ask with two real options
  before it will pad with a fake one.

## What is in it

**Browse and profiles** — `/drugs`, filterable by list, category, indication,
route and schedule, colour-coded by class; a profile page per drug with every
field, its brands, and where each value came from.

**Study** — `/study/flashcards` and `/study/quiz`. Cram (everything, schedule
untouched) or review (what is due). Binary grading when cramming, four-point when reviewing. Saved setups
at `/study/setups`, so a configuration you liked is one click away.

**Imported sets** — `/sets`. Lecture material that is not a drug table:
hormones, lab values, pathways, anything with a shared axis. A JSON file per set
(`docs/set-format.md` is the authoring guide, written to be handed to a model
along with your slides), imported at `/admin/sets`, then studied by the *same*
engine — sets needed an adapter, not a second engine.

**Editing** — every field is editable in the app, with an on-demand lookup panel
that queries DailyMed, RxNorm and openFDA and lets you pull one value into one
field with the citation recorded. Nothing is ever bulk auto-filled.

**Admin** — fields (the schema is *data*: add half-life, renal dosing, kinetics
without a migration), drug lists and categories, indication vocabulary,
dosing-by-indication, bulk edits, flagged values, pairing review, invites, users,
audit log, and backup/restore.

**Accounts** — invite-code registration only; better-auth with roles. There is
no public sign-up path, deliberately: better-auth's own endpoint is disabled and
accounts are created only after a code is claimed.

## Stack

Next.js 15 (App Router, server components and actions, `output: 'standalone'`,
typed routes) · React 19 · Drizzle ORM · Postgres 17 · better-auth · Tailwind 4 ·
Vitest.

Two containers, one volume, migrations run from the entrypoint on every boot.
No build step on the server beyond `docker compose up --build`.

## Running it locally

Needs Node 22+ and Docker with Compose v2.

```bash
cp .env.example .env     # then edit the secrets -- see the comments in it
npm install
docker compose up -d --build
```

Then <http://localhost:3000>. The first boot migrates the schema, seeds the core
field definitions, and creates one admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
Fill it with content from the committed sheet extract:

```bash
npm run seed             # safe to re-run: fills gaps, never blanks a value
```

**The app runs as a built image, so source edits are invisible until you
rebuild.** `docker compose up -d --build`, every time.

| | |
|---|---|
| `npm test` | 987 tests in 51 files, against a real throwaway Postgres per run |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | regenerate migrations after a `db/schema.ts` change |
| `npm run export` | write a JSON backup to `backups/` |
| `npm run restore -- <file>` | put one back |

## Deploying it

- **[`docs/deploy.md`](docs/deploy.md)** — an ordinary Linux server: getting the
  code there, the `.env` values that change once the address is not `localhost`,
  Caddy or nginx in front, moving your data over, backups.
- **[`deploy/zimaos/`](deploy/zimaos/)** — ZimaOS or CasaOS. Either clone and
  build on the box with a small port override, or, if it has not the RAM for
  `next build`, ship it a prebuilt image and use the compose file there — the
  App Store importer only *pulls* images, so it cannot build one for you.

The thing that catches everyone, in both: **`BETTER_AUTH_URL` must be exactly
the address you type in the browser**, scheme and port included. Otherwise the
session cookie is issued for an origin you are not on, and signing in appears to
work and then does not.

## Content and provenance

The drug data began as an extract of a course document — the class's own list of
drugs to know — and has since been edited by hand in the app. **The database is
the content now; the sheet was the baseline.** `data/drugs-seed.json` is that
baseline as it stood, kept so a fresh install has something in it; the sheet is
no longer re-run and the app is not rebuilt from it. The source PDF itself and
the handwritten note the design came from are both gitignored and stay out of
the repository.

This repository is public, and there is no license file, which means the
ordinary default: the code is mine and all rights are reserved. Read it, learn
from it, open an issue — but it is published to be looked at rather than
offered for reuse, because the subject matter is a school's course list and the
code and the content are not cleanly separable.

**Nothing here is clinical reference.** It is one student's revision material.
Every value carries a status and a source and the lookup panel records
citations, because a drug fact with no provenance is not a fact worth revising
from — but the authority is the course and the label, not this database. Do not
make a dosing decision from a flashcard app.

## Where things live

```
app/            routes -- (auth), drugs, study, sets, admin, account
lib/            the logic, by area:
  study/          card and question builders, SRS, priority weighting
  sets/           parser, importer, and the adapter onto the study engine
  fields/         the field registry
  data/           backup and restore
  content/        the one-time sheet sync
db/             schema.ts, migrations/, migrate.ts
tests/          vitest, against real Postgres -- not mocks
docs/           set-format.md (authoring guide), deploy.md
deploy/zimaos/  compose file + guide for ZimaOS/CasaOS
PLAN.md         the canonical record of what was decided and why
```

**[`PLAN.md`](PLAN.md) is the real documentation.** It is a working design
record rather than a changelog: every decision with the reasoning, the
alternatives rejected, and what measuring it showed. Start there if you want to
know why something is the way it is.
