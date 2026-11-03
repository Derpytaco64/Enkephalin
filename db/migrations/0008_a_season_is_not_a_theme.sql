-- A season is a separate choice from light-or-dark, so it gets its own column
-- rather than four more values on theme_pref.
--
-- Folding them together would have meant that choosing autumn chose a
-- brightness for somebody, and that saying "autumn, but dark" needed eight
-- enum values instead of two independent settings. It would also have put a
-- decoration into the column that `themeAttribute()` stamps on <html>, which
-- every contrast guarantee in app/globals.css is written against.
--
-- Default 'off' on both, deliberately. Decoration is opt-in: an upgrade must
-- not start animating under anyone who did not ask for it.
DO $$
BEGIN
  CREATE TYPE "season_pref" AS ENUM ('off', 'auto', 'spring', 'summer', 'autumn', 'winter');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "user_preferences"
  ADD COLUMN IF NOT EXISTS "season" "season_pref" NOT NULL DEFAULT 'off';
--> statement-breakpoint
-- The site's own answer, for the same reason it has a default theme and a
-- default palette: what everyone gets before they choose anything, and what a
-- signed-out visitor on the login page gets full stop.
ALTER TABLE "site_settings"
  ADD COLUMN IF NOT EXISTS "default_season" "season_pref" NOT NULL DEFAULT 'off';
