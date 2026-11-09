-- The merge policy needs to know whether a person has touched a column.
--
-- Re-import is a merge keyed by slug, and the rule for a cell is already
-- written and tested one table over: `updated_by` answers *has a human touched
-- this*, and a human's edit survives a re-import. Because sets are editable,
-- that has to cover columns too -- a renamed label, a reworded prompt, a
-- corrected `answers` type. The file supplies columns; it does not own them
-- after the first import.
--
-- Separate from 0011 rather than folded into it: 0011 is applied, and a
-- migration that has run is not edited.
alter table set_fields
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by text references users(id) on delete set null;
