-- The imported sets section is scrapped, so the database stops holding a
-- second kind of subject.
--
-- This reverses 0011 and 0012. It is written out rather than generated because
-- the order matters and two of the steps throw data away: a schedule or an
-- answer about a set item has nowhere to point once the rows are gone, so it
-- is deleted *before* `drug_id` can be made not-null again. Nothing else in
-- either table is touched -- a drug card keeps its ease, its interval and its
-- review count, and an attempt keeps its score.
--
-- The audit log keeps its `set.import`, `set.reimport` and `set.delete` rows.
-- They are a record of things that happened, and the target type is text, so
-- nothing dangles. See PLAN.md -> *Scrapped: the imported sets section*.

/* ---- the history on set items, which has nothing left to point at ------ */

delete from study_cards where item_id is not null;
delete from quiz_answers where item_id is not null;

/* ---- one subject per row again, so the constraints go back ------------- */

alter table study_cards drop constraint if exists study_cards_one_subject;
alter table quiz_answers drop constraint if exists quiz_answers_one_subject;

drop index if exists study_cards_item_idx;
drop index if exists quiz_answers_item_idx;

alter table study_cards drop column if exists item_id;
alter table quiz_answers drop column if exists item_id;

-- Which rung of the distractor ladder the options came from. There is no
-- ladder now: a set's wrong answers were going to be written into the file,
-- and then there are no sets either.
alter table quiz_answers drop column if exists distractor_rung;

alter table study_cards alter column drug_id set not null;
alter table quiz_answers alter column drug_id set not null;

-- Back to the plain spelling, which is the one Drizzle can express and the one
-- `db/schema.ts` now carries. 0011 had to coalesce over the zero uuid because
-- nulls are distinct in Postgres, so `(user_id, drug_id, card_key)` stopped
-- constraining anything the moment `drug_id` could be null. With `drug_id`
-- not-null again, the coalesce protects against nothing.
-- `if exists` because dropping `item_id` above has usually already taken this
-- with it: 0011's version indexes a coalesce over that column, so the column
-- cannot go without the index. Verified both ways on a seeded scratch database.
drop index if exists study_cards_unique;

create unique index study_cards_unique
  on study_cards (user_id, drug_id, card_key);

/* ---- and the tables themselves ---------------------------------------- */

-- Children first, by hand, rather than leaning on `cascade`: a `drop table
-- cascade` would also have taken anything added to reference these since, and
-- a migration should break loudly rather than quietly widen.
drop table if exists set_items;
drop table if exists set_fields;
drop table if exists sets;
