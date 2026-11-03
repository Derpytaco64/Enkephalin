-- Two more cosmetic switches, both opt-in, both off by default.
--
-- `season_tint`: whether the season reaches the chrome -- the page ground, the
-- card surfaces and the borders -- or stays the wash and the motes it has
-- been. Separate from `season` rather than two more enum values on it, for the
-- same reason `season` is separate from `theme`: "autumn, but only the
-- background" and "autumn, everything" are a season plus a depth, and folding
-- them in would have meant eight labels saying four things.
--
-- `ambience`: the decorations that belong to light and dark themselves rather
-- than to a season -- a drifting starfield in dark, a dust-mote sunbeam and
-- paper grain in light, and a warmth that follows the clock. One switch for
-- the set, because four switches for four decorations is a settings page
-- nobody reads.
--
-- Not covered by either, and therefore not switchable: the focus ring, the
-- streak glow and the wordmark's idle tilt. Each is either an accessibility
-- improvement or small enough that a preference for it would cost more
-- attention than the thing itself.
ALTER TABLE "user_preferences"
  ADD COLUMN IF NOT EXISTS "season_tint" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "user_preferences"
  ADD COLUMN IF NOT EXISTS "ambience" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "site_settings"
  ADD COLUMN IF NOT EXISTS "default_season_tint" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "site_settings"
  ADD COLUMN IF NOT EXISTS "default_ambience" boolean NOT NULL DEFAULT false;
