-- Imported sets: the second section, and the first time this database holds a
-- subject that is not a drug.
--
-- A set is a *table*, not a list of cards. The quiz is built from an axis
-- shared across many subjects -- every wrong option is another row's answer to
-- the same column -- so a front/back import would leave nothing to draw
-- distractors from but unrelated backs.

create table if not exists sets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,

  -- The course's own words for where this sits, because that is how somebody
  -- says what they want to study: this topic tonight, all of Exam 3 by Friday.
  -- `unit` rather than a generic level: deck 14 calls itself "Unit 5: Thyroid"
  -- and that is the string a person will look for.
  course text,
  exam text,
  unit text,
  topic text,

  source_file text,
  source_pages text,

  -- The drug section's IDENTITY_FIELD, made a property of the subject rather
  -- than a constant in the engine.
  identity_key text not null,
  identity_label text not null,
  identity_kind text not null,

  -- Names a column that is the near-miss axis. Maps onto drug_class in the
  -- study adapter, which is one line for the near-miss rule, the scope filter
  -- and the colour coding all three.
  group_key text,

  kinds text[] not null default '{}',

  imported_at timestamptz not null default now(),
  imported_by text references users(id) on delete set null,
  updated_at timestamptz,
  updated_by text references users(id) on delete set null
);

create index if not exists sets_scope_idx on sets (course, exam, unit);

-- A set's columns, deliberately not field_defs: that table's `key` is globally
-- unique, which is exactly wrong when two sets both want a column called
-- `definition`, and it carries sheet baggage a set has no use for.
--
-- answers_type is the distractor pool key and is NOT the column name. Three of
-- the nine source decks call one thing Mechanism, Principle mechanism and
-- Target. Headings are local; the pool they draw from has to be shared.
create table if not exists set_fields (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references sets(id) on delete cascade,
  key text not null,
  label text not null,
  data_type field_data_type not null default 'text',
  answers_type text,
  enum_options text[],
  prompt text,
  asks boolean not null default true,
  reversible boolean not null default false,
  -- Not `unit`: the scope above took that word, and it is the course's.
  measured_in text,
  ordinal boolean not null default false,
  sort_order integer not null default 0,
  deleted_at timestamptz
);

create unique index if not exists set_fields_unique on set_fields (set_id, key);

create table if not exists set_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references sets(id) on delete cascade,
  name text not null,
  slug text not null,
  kind text not null,

  -- Folded into the answer key: offering T4 and thyroxine as two options is a
  -- question with two right answers.
  aliases text[] not null default '{}',

  -- Both or neither. One set holds more than one sequence -- T4 synthesis and
  -- the GPCR cascade are both "Step / Detail" tables -- and a bare position
  -- number would silently interleave them.
  sequence text,
  sequence_order integer,

  recall_only boolean not null default false,

  values jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,

  updated_at timestamptz,
  updated_by text references users(id) on delete set null,

  constraint set_items_sequence_pair
    check ((sequence is null) = (sequence_order is null))
);

create unique index if not exists set_items_unique on set_items (set_id, slug);
create index if not exists set_items_sequence_idx
  on set_items (set_id, sequence, sequence_order);

-- Two rows at the same position in one sequence is a set that cannot answer
-- "what follows step 3". The importer refuses it; this makes it impossible.
create unique index if not exists set_items_sequence_position
  on set_items (set_id, sequence, sequence_order)
  where sequence is not null;

/* ---- the study tables learn a second kind of subject ------------------- */

alter table study_cards alter column drug_id drop not null;
alter table study_cards
  add column if not exists item_id uuid references set_items(id) on delete cascade;

alter table quiz_answers alter column drug_id drop not null;
alter table quiz_answers
  add column if not exists item_id uuid references set_items(id) on delete cascade;

-- Which rung of the distractor ladder the options came from. Rung 5 is the
-- random fallback, and recording it is what makes "how many questions needed
-- it" a number a screen can show rather than something nobody finds out.
alter table quiz_answers add column if not exists distractor_rung integer;

-- Exactly one subject per row. Without this, "neither" is representable and a
-- card about nothing would sit in somebody's deck forever.
alter table study_cards
  add constraint study_cards_one_subject
  check (num_nonnulls(drug_id, item_id) = 1);

alter table quiz_answers
  add constraint quiz_answers_one_subject
  check (num_nonnulls(drug_id, item_id) = 1);

create index if not exists study_cards_item_idx on study_cards (item_id);
create index if not exists quiz_answers_item_idx on quiz_answers (item_id);

-- THE TRAP, and this project has already fallen into it once -- see migration
-- 0010. In Postgres nulls are distinct, so the moment drug_id can be null,
-- (user_id, drug_id, card_key) stops constraining the set-item case at all:
-- every set card would look unique to the index and a person's deck would grow
-- a duplicate on every rebuild.
--
-- Coalesced over both columns instead, so one spelling constrains both kinds of
-- subject. (PG 15+ could say NULLS NOT DISTINCT; this needs no version floor
-- and says what it means where it is read.) Drizzle cannot express it, so it
-- lives here and tests/study-subject.test.ts reads pg_indexes to pin it.
drop index if exists study_cards_unique;

create unique index study_cards_unique
  on study_cards (
    user_id,
    coalesce(drug_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid),
    card_key
  );
