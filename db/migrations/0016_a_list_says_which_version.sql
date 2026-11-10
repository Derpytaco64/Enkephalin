-- A list can name which version of a drug it means.
--
-- `drug_tags` said "this drug is on this list". It now also says "and read it
-- as this class teaches it" -- so Top Drugs 2026 can hold amoxicillin as the
-- Infectious Disease class words it, while the drug's own profile stays the
-- drug's own.
--
-- Nullable, and null is the normal case: the drug's own profile. `on delete set
-- null` rather than cascade, because deleting a class should drop the pointer
-- and leave the drug on the list -- membership and wording are two facts, and
-- only one of them is about that class.
ALTER TABLE "drug_tags"
  ADD COLUMN IF NOT EXISTS "variant_tag_id" uuid
  REFERENCES "tags"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drug_tags_variant_idx" ON "drug_tags" ("variant_tag_id");
