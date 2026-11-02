-- Indications become rows of their own.
--
-- They were free text on each drug, which made "Hypertension" sixteen
-- unrelated strings: a typo forked a new study filter of one drug silently,
-- and renaming one meant finding every drug carrying it. Tested on the live
-- data first -- typing "Panic disorderr" really did create a 93rd filter entry
-- with nobody warned.
--
-- The wording was already settled by migration 0004, so this only has to
-- gather the distinct labels and repoint the rows. drug_indications keeps its
-- id, so the 24 brand/indication pairings that reference it survive untouched.
CREATE TABLE "indications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "label" text NOT NULL,
  CONSTRAINT "indications_slug_unique" UNIQUE("slug")
);--> statement-breakpoint

-- The same slug rule as lib/drugs/indications.ts: lowercase, every run of
-- anything else becomes one dash, no dash at either end.
INSERT INTO "indications" ("slug", "label")
SELECT
  trim(both '-' from regexp_replace(lower(t.text), '[^a-z0-9]+', '-', 'g')) AS slug,
  min(t.text) AS label
FROM (SELECT DISTINCT "text" FROM "drug_indications") AS t
GROUP BY 1;--> statement-breakpoint

ALTER TABLE "drug_indications" ADD COLUMN "indication_id" uuid;--> statement-breakpoint

UPDATE "drug_indications" AS di
SET "indication_id" = i."id"
FROM "indications" AS i
WHERE i."slug" = trim(both '-' from regexp_replace(lower(di."text"), '[^a-z0-9]+', '-', 'g'));--> statement-breakpoint

-- Fails loudly rather than dropping the column over an unmatched row.
ALTER TABLE "drug_indications" ALTER COLUMN "indication_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "drug_indications"
  ADD CONSTRAINT "drug_indications_indication_id_indications_id_fk"
  FOREIGN KEY ("indication_id") REFERENCES "public"."indications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drug_indications_unique" ON "drug_indications" ("drug_id","indication_id");--> statement-breakpoint
ALTER TABLE "drug_indications" DROP COLUMN "text";
