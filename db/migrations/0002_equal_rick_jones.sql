ALTER TABLE "dosing_regimens" DROP COLUMN "status";--> statement-breakpoint
DROP TYPE "public"."verification_status";--> statement-breakpoint
-- Verification is gone: a value in the database is a value to study. The three
-- old statuses that said how much to trust a value collapse into "ok", the one
-- that said there was nothing to record becomes "none", and "flagged" stays
-- what it was -- a to-do, not a quarantine.
UPDATE "drugs" SET "fields" = (
  SELECT jsonb_object_agg(
    key,
    CASE value->>'status'
      WHEN 'verified' THEN jsonb_set(value, '{status}', '"ok"')
      WHEN 'unverified' THEN jsonb_set(value, '{status}', '"ok"')
      WHEN 'not_applicable' THEN jsonb_set(value, '{status}', '"none"')
      ELSE value
    END
  )
  FROM jsonb_each("fields")
)
WHERE "fields" <> '{}'::jsonb;
