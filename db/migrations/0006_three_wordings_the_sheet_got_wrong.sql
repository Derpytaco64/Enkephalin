-- Three indications the sheet had wrong, corrected in place.
--
-- Two are the source PDF breaking a word across a line and the extractor
-- keeping the break ("Keratoconjuncti vitis", "anti- inflammatory"); one is a
-- misspelling the sheet itself made ("Pruritis" for pruritus). Migration 0004
-- did the same job for wordings the sheet spelled two ways; this is the sheet
-- spelling one way and being wrong.
--
-- The slug moves with the label here, unlike a rename from the admin screen.
-- A slug is an address worth keeping stable, but these three were never an
-- address anyone could have saved on purpose, and leaving
-- "keratoconjuncti-vitis-sicca-dry-eye-syndrome" in every study link to
-- preserve a typo would be the wrong thing to preserve.
--
-- The matching entries in lib/drugs/indications.ts are what stop the next
-- `npm run seed` from putting the sheet's spelling back as a second row.
--
-- No ON CONFLICT: none of the three corrected slugs exists, and if one ever
-- did the right answer is a merge decided by a person, not a silent one here.
UPDATE "indications"
SET "label" = 'Keratoconjunctivitis sicca (Dry eye syndrome)',
    "slug" = 'keratoconjunctivitis-sicca-dry-eye-syndrome'
WHERE "slug" = 'keratoconjuncti-vitis-sicca-dry-eye-syndrome';--> statement-breakpoint

-- Only the label here: the slug rule collapses any run of punctuation and
-- space to one dash, so "anti- inflammatory" was already slugging to
-- "anti-inflammatory" and the address does not move.
UPDATE "indications"
SET "label" = 'Ophthalmic anti-inflammatory'
WHERE "slug" = 'ophthalmic-anti-inflammatory';--> statement-breakpoint

UPDATE "indications"
SET "label" = 'Pruritus',
    "slug" = 'pruritus'
WHERE "slug" = 'pruritis';
