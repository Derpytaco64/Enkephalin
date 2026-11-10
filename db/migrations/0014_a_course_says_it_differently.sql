-- One course's own wording for a drug.
--
-- A layer, not a copy: only the fields a course differs on are stored, and
-- everything else falls through to `drugs.fields`. A class teaches
-- levothyroxine too and says mostly the same things about it, so a copy would
-- mean the same correction made twice -- and the second one forgotten.
--
-- A "class" is the `course` tag that already exists, so membership
-- (`drug_tags`), the browse filter and the study scope need no change at all.
-- This table is the only new thing.
--
-- The tag has to be of kind `course`, and that is enforced in
-- `lib/drugs/course-values.ts` rather than here: a check constraint cannot
-- reach another table, and a trigger to say it would be a second place the
-- rule lives.
create table if not exists drug_course_values (
  drug_id uuid not null references drugs(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,

  -- Same envelope as drugs.fields -- value, status, source, updated_at,
  -- updated_by per key -- so the formatter, the flag and the "from X" line on
  -- the profile work with no special case.
  fields jsonb not null default '{}'::jsonb,

  note text,

  updated_at timestamptz not null default now(),
  updated_by text references users(id) on delete set null,

  primary key (drug_id, tag_id)
);

-- "Everything this course says differently", which is the screen that lists a
-- course's own work.
create index if not exists drug_course_values_tag_idx
  on drug_course_values (tag_id);
