-- An indication belongs to the version that taught it.
--
-- `drug_indications` said "this drug is for this", with no room to say who
-- says so. Every lecture that imported a drug therefore appended to one shared
-- list: doxycycline ended up with 26 indications on its own profile, written by
-- five different exams, while each of those five versions held none -- reported
-- 2026-11-16 as "a bunch of indications got piled on the Top drugs 2026
-- version without the other ones", which is precisely what had happened.
--
-- Nullable, and null is the common case: it means "this is the drug's own",
-- which is what the class sheet's 237 rows are and what a drug a lecture
-- created holds. A row names a version only where that version is the one
-- teaching it.
--
-- `on delete cascade`, like drug_variant_values.tag_id and unlike
-- drug_tags.variant_tag_id. That column is a *pointer* at a class's wording, so
-- losing the class should leave the membership and drop the pointer. This is
-- the class's own content: deleting Infectious Disease Exam 3 should take away
-- what Exam 3 taught, and a `set null` would instead move 262 indications onto
-- the drugs' own profiles, which is the state this column exists to get out of.
alter table drug_indications
  add column if not exists variant_tag_id uuid
    references tags(id) on delete cascade;

create index if not exists drug_indications_variant_idx
  on drug_indications (variant_tag_id);

-- The old index could not see the new column, so two versions teaching the
-- same drug for the same condition collided -- and they genuinely do: Exam 1
-- and Exam 3 both have doxycycline for community-acquired pneumonia, in their
-- own wording, and that is the whole point of a version.
--
-- Coalesced rather than listing the column plainly, because in Postgres nulls
-- are distinct: a plain index would stop constraining the drug's-own case,
-- which is most of the table and is what the index was added for in migration
-- 0005. Same spelling as dosing_regimens_unique, for the same reason.
drop index if exists drug_indications_unique;

create unique index drug_indications_unique
  on drug_indications (
    drug_id,
    indication_id,
    coalesce(variant_tag_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
