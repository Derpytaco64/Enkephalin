-- Sildenafil is 20 mg three times a day for pulmonary hypertension and 50 mg
-- an hour before sex for erectile dysfunction, and both brands are on the
-- top-drugs list. Before this column the drug carried one dosing row -- the
-- pulmonary one -- and the quiz keyed it as *the* answer, so the app taught the
-- less familiar half and never mentioned the other.
--
-- Nullable, and null is the overwhelmingly common case: it means "this dose is
-- the drug's dose", which is true for 235 of 236. A row only carries an
-- indication where the source actually splits by one.
--
-- The reference is to drug_indications rather than to indications, so a dose
-- can only be attached to an indication *this drug has* -- the same choice
-- brand_indications made, and for the same reason: a dose for a condition the
-- drug is not for is not a fact, it is a mistake.
alter table dosing_regimens
  add column if not exists indication_id uuid
    references drug_indications(id) on delete cascade;

create index if not exists dosing_regimens_indication_idx
  on dosing_regimens (indication_id);

-- The old index could not see the new column, so two branches of one drug
-- collided on (drug, route, population, alternative, step).
--
-- Coalesced rather than listing the column plainly, because in Postgres nulls
-- are distinct: a plain index would stop constraining the unscoped case, which
-- is every drug but one and is exactly what the index was added for. (PG 15+
-- could say NULLS NOT DISTINCT instead; this spelling needs no version floor
-- and says what it means where it is read.)
drop index if exists dosing_regimens_unique;

create unique index dosing_regimens_unique
  on dosing_regimens (
    drug_id,
    coalesce(indication_id, '00000000-0000-0000-0000-000000000000'::uuid),
    variant_route,
    population,
    alternative,
    step
  );
