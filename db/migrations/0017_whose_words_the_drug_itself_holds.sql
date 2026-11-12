-- Whose words the drug's own profile is.
--
-- A lecture imported into a drug the app had never held writes everything to
-- the drug itself -- `import.ts` says so in as many words, because a brand-new
-- drug whose mechanism went into a class layer would have a blank profile of
-- its own. So the base *is* that class's wording, and nothing recorded it. The
-- picker then read "The drug's own", "V-1 Exam 2", "V-2 Exam 3": three
-- versions, two of them named, and the unnamed one was Exam 1.
--
-- Nullable, and null is the normal case -- the 236 drugs off the class sheet
-- are nobody's version in particular. `on delete set null` for the same reason
-- as `drug_tags.variant_tag_id`: deleting a class must not delete the drug, and
-- the attribution is the only fact about that class here.
ALTER TABLE "drugs"
  ADD COLUMN IF NOT EXISTS "base_variant_tag_id" uuid
  REFERENCES "tags"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drugs_base_variant_idx" ON "drugs" ("base_variant_tag_id");
