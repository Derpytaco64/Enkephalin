-- One wording per indication. The sheet writes three of them two ways, which
-- made a profile, a study filter and a quiz option disagree about the same
-- fact -- and let a quiz offer "Seizures" as the wrong answer to a question
-- whose right answer was "Seizure".
--
-- Updated in place rather than re-inserted, so every brand/indication pairing
-- that points at these rows survives. No drug holds two variants of the same
-- indication, so nothing collides. See lib/drugs/indications.ts, which every
-- writer now canonicalises through so a re-import cannot undo this.
UPDATE "drug_indications" SET "text" = 'Seizures' WHERE "text" = 'Seizure';--> statement-breakpoint
UPDATE "drug_indications" SET "text" = 'Bacterial infections' WHERE "text" = 'Bacterial infection';--> statement-breakpoint
UPDATE "drug_indications" SET "text" = 'Benign prostatic hypertrophy (BPH)' WHERE "text" = 'BPH';
