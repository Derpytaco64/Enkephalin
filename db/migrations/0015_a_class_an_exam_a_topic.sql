-- A variant of a drug profile is addressed by a tag, and three kinds of tag
-- can carry one: the class, the exam, the topic. Migration 0014 allowed only
-- `course`, which was the right first cut and the wrong vocabulary -- the
-- material arrives addressed as "PHRM 535, Heme/Onc Exam 3, Melanoma", and all
-- three are real scopes somebody studies.
--
-- So the enum grows by two and the table loses the word "course" from its name.
-- Renaming rather than creating anew: 0014 is one day old and may or may not
-- have been applied yet, and a rename is correct in both worlds.

ALTER TYPE "tag_kind" ADD VALUE IF NOT EXISTS 'exam' AFTER 'course';--> statement-breakpoint
ALTER TYPE "tag_kind" ADD VALUE IF NOT EXISTS 'topic' AFTER 'exam';--> statement-breakpoint

ALTER TABLE IF EXISTS "drug_course_values" RENAME TO "drug_variant_values";--> statement-breakpoint
ALTER INDEX IF EXISTS "drug_course_values_tag_idx" RENAME TO "drug_variant_values_tag_idx";
