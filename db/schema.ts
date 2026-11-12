import {
  boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, real,
  text, timestamp, uniqueIndex, uuid, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
// Types only, so nothing is imported at runtime and this file stays loadable
// by `node --experimental-strip-types` for the scripts.
import type { Amount, Duration, Frequency, Modifier, RouteCode, Site } from '../lib/dosing/model.ts';

/* ---------------------------------------------------------------- enums -- */

export const fieldDataType = pgEnum('field_data_type', [
  'text', 'markdown', 'enum', 'list', 'number', 'bool',
]);

export const tagKind = pgEnum('tag_kind', [
  'top_list',    // "Top Drugs 2026" — the sheet edition
  'school_year', // P1 / P2 / P3
  // The three that can carry a drug profile variant, widest first. A drug can
  // be in a course and on an exam at once, and each of those can
  // teach it in its own words -- see drugVariantValues.
  'course',      // PHRM 535
  'exam',        // Heme/Onc Exam 3
  // `topic` is no longer offered anywhere -- what a lecture is *about* is an
  // indication, which is already a field. The value stays because dropping one
  // from a postgres enum is a table rewrite, and an unoffered value costs
  // nothing. See lib/drugs/variant-kinds.ts.
  'topic',
  'system',      // derived, e.g. drug class
  'custom',
]);

export const drugSchedule = pgEnum('drug_schedule', [
  'CI', 'CII', 'CIII', 'CIV', 'CV',
]);

export const userRole = pgEnum('user_role', ['student', 'admin']);
export const userStatus = pgEnum('user_status', ['active', 'disabled']);
export const themePref = pgEnum('theme_pref', ['light', 'dark', 'system']);
export const colorAxis = pgEnum('color_axis', ['class', 'schedule', 'tag', 'none']);

/**
 * A seasonal decoration, which is *not* a theme.
 *
 * Deliberately a separate column from `theme_pref` rather than four more
 * values on it. A season is a tint and an ornament; light-or-dark is a
 * brightness. Folding them together would mean choosing autumn chose a
 * brightness for you, and "autumn, dark" would need eight enum values to say.
 *
 * `auto` reads the season off the date. `off` is the default, because
 * decoration is opt-in -- an upgrade should not start animating under anyone.
 */
export const seasonPref = pgEnum('season_pref', [
  'off', 'auto', 'spring', 'summer', 'autumn', 'winter',
]);
export const studyMode = pgEnum('study_mode', ['inclusive', 'exclusive']);

export const studyDirection = pgEnum('study_direction', [
  'drug_to_fields',
  'fields_to_drug',
  'field_to_field',
]);

/* ------------------------------------------------------- field registry -- */

/**
 * Fields are rows, not columns. The sheet supplies seven, but more will be
 * added (half-life, renal dosing, kinetics), and adding one must not require a
 * migration and a deploy.
 */
export const fieldDefs = pgTable('field_defs', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  group: text('group'),
  dataType: fieldDataType('data_type').notNull().default('markdown'),
  enumOptions: jsonb('enum_options').$type<string[]>(),
  sortOrder: integer('sort_order').notNull().default(0),
  isCore: boolean('is_core').notNull().default(false),
  isQuizzable: boolean('is_quizzable').notNull().default(true),
  defaultVisible: boolean('default_visible').notNull().default(true),

  // Which program years are responsible for this field, from the sheet's own
  // header: generic/brand/indication are P1-P3, dosing/controlled P2-P3, and
  // MOA/black box P3 only. Drives the year selector in study config.
  yearLevels: text('year_levels').array().$type<string[]>().notNull().default([]),

  // True where an empty value means "none exists" rather than "not filled in".
  blankMeansNone: boolean('blank_means_none').notNull().default(false),

  promptTemplate: text('prompt_template'),
  helpText: text('help_text'),

  // Which lookup-provider paths can fill this field, so newly added fields can
  // declare their own sources without code changes.
  lookupMapping: jsonb('lookup_mapping').$type<Record<string, string>>(),

  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/* ------------------------------------------------------------- drugs ----- */

/**
 * A stored value and where it came from.
 *
 * `status` says what kind of thing the value is, not how much it is trusted.
 * Everything in the database was put there by the importer, the admin, or a
 * script written for it, so a value exists means a value counts -- there is no
 * holding pen, and nothing is withheld from a deck for want of a signature.
 *
 * - `ok` -- recorded. Studied.
 * - `flagged` -- someone thinks it is wrong. Still studied, because leaving it
 *   out would quietly shrink the deck; the flag is a to-do, not a quarantine.
 * - `none` -- there is nothing to record, and that is the answer. 147 of 237
 *   drugs have no black box warning and 213 are not controlled; without this
 *   those would read as gaps and flashcards would ask for warnings that do not
 *   exist.
 *
 * `source` and `updatedBy` carry the provenance that `verified` used to imply,
 * and better: who wrote it and what they read. `updatedBy` is also what the
 * importer checks before touching a value -- see `lib/content/sync.ts`.
 */
export type FieldValue = {
  value: string | null;
  status: 'ok' | 'flagged' | 'none';
  source: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export const drugs = pgTable('drugs', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  genericName: text('generic_name').notNull(),

  // Denormalised out of `fields` on purpose: class and schedule drive
  // same-class distractor generation, filtering, and colour coding, and those
  // queries should not dig through JSONB. lib/fields keeps them in step on
  // write, so there is still one source of truth per value.
  drugClass: text('drug_class'),
  schedule: drugSchedule('schedule'),
  scheduleNote: text('schedule_note'),

  rxcui: text('rxcui'),

  /**
   * The tag whose words **the drug's own profile** is: the class or exam that
   * wrote it, or the list it arrived on.
   *
   * A lecture imported into a drug the app had never held writes to the drug
   * itself rather than to a layer -- see `import.ts`, where a brand-new drug
   * takes everything as its own whatever the write mode says, because a drug
   * whose mechanism went straight into a class layer would have a blank
   * profile. The base is then that class's wording, and until this column
   * nothing said so: the picker offered *the drug's own*, *V-1 Exam 2* and
   * *V-2 Exam 3*, and the first of those was Exam 1 under a name that read
   * like nobody's.
   *
   * Null means nobody in particular, which is what a drug somebody typed by
   * hand is. **Any kind of tag may be named**, not only the two a layer can
   * live on: the 236 off the class sheet read *V-1 Top Drugs 2026*, which is
   * the honest answer to whose wording their profile is (2026-11-12, owner's
   * call).
   *
   * Not a variant layer: the base holds the whole profile and a layer holds
   * only differences, which is why this is a pointer on `drugs` and not a row
   * in `drug_variant_values`. A tag named here must be one the drug carries
   * and must not also hold a layer, both enforced in `lib/drugs/variants.ts`
   * -- the same class cannot be the drug's own words *and* a variation on them.
   */
  baseVariantTagId: uuid('base_variant_tag_id')
    .references((): AnyPgColumn => tags.id, { onDelete: 'set null' }),

  // Every non-core field, keyed by field_defs.key -> FieldValue.
  fields: jsonb('fields').$type<Record<string, FieldValue>>().notNull().default({}),

  // Set where RxNorm returned no FDA Established Pharmacologic Class, so a
  // human picks from ranked candidates rather than the importer guessing.
  needsClassReview: boolean('needs_class_review').notNull().default(false),
  classCandidates: jsonb('class_candidates').$type<string[]>().notNull().default([]),
  classSuggestion: text('class_suggestion'),

  /**
   * The dosing is deliberately prose-only: a sig too involved to decode, and
   * marked so by a person rather than failed by the parser.
   *
   * The two look identical in the database -- one regimen row carrying the
   * prose and no components -- and mean opposite things. Without this, every
   * complicated sig sits in the review queue forever, and "the parser could not
   * read this" never gets to be answered with "no, it is just like that".
   * Acetylcysteine's three-stage 21-hour infusion is the case.
   */
  dosingUnique: boolean('dosing_unique').notNull().default(false),

  // Set where competing brands meet multiple indications and the pairing has
  // not been confirmed. Shown on the profile as something to settle; it does
  // not hold cards back, because a drug in the database is a drug to study.
  needsPairingReview: boolean('needs_pairing_review').notNull().default(false),

  sourcePage: integer('source_page'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('drugs_class_idx').on(t.drugClass),
  index('drugs_schedule_idx').on(t.schedule),
  index('drugs_base_variant_idx').on(t.baseVariantTagId),
]);

/* ------------------------------------------ brands and indications ------- */

/**
 * The vocabulary of indications, one row per thing a drug can be for.
 *
 * It was free text on each drug until migration 0005, and the trouble with
 * that was not storage but typing: "Hypertension" existed sixteen times as
 * sixteen unrelated strings, a typo forked a new study filter of one drug
 * without saying so, and renaming one meant finding every drug that carried
 * it. As rows there is one of each, a typo is visible as a new entry you did
 * not mean to make, and renaming or merging is a single edit.
 *
 * The slug is the address -- it is in every study link -- and the label is what
 * is read. See lib/drugs/indications.ts for the wording rules.
 */
export const indications = pgTable('indications', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  label: text('label').notNull(),
});

/** Which drug is for which indication, in the drug's own order. */
export const drugIndications = pgTable('drug_indications', {
  id: uuid('id').primaryKey().defaultRandom(),
  drugId: uuid('drug_id').notNull().references(() => drugs.id, { onDelete: 'cascade' }),
  indicationId: uuid('indication_id').notNull().references(() => indications.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [
  index('drug_indications_drug_idx').on(t.drugId),
  // One drug cannot be for the same indication twice, which free text could
  // not say and a typo used to work around.
  uniqueIndex('drug_indications_unique').on(t.drugId, t.indicationId),
]);

export const drugBrands = pgTable('drug_brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  drugId: uuid('drug_id').notNull().references(() => drugs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),

  // "Wellbutrin SR" and "Wellbutrin XL" share the family "Wellbutrin"; "Zyban"
  // does not. Multiple-choice sampling takes one brand per family, or three of
  // the four options are the same brand and the question answers itself.
  family: text('family').notNull(),

  route: text('route'),
  form: text('form'),
  dosingOverride: text('dosing_override'),

  // Set when this brand covers all indications by default while a sibling has
  // been narrowed — fluoxetine leaves Prozac silently claiming PMDD. The
  // editor warns, and no brand->indication card is generated until cleared.
  defaultPairingSuspect: boolean('default_pairing_suspect').notNull().default(false),
  suspectReason: text('suspect_reason'),

  sortOrder: integer('sort_order').notNull().default(0),
  note: text('note'),
}, (t) => [
  index('drug_brands_drug_idx').on(t.drugId),
  index('drug_brands_name_idx').on(t.name),
]);

/**
 * A brand with NO rows here covers every one of its drug's indications, which
 * is the common case (Proventil / Ventolin / Proair are all albuterol, all for
 * asthma) and keeps the default free of busywork. Rows exist only where a brand
 * is genuinely narrower: Mounjaro treats diabetes, Zepbound weight management.
 */
export const brandIndications = pgTable('brand_indications', {
  brandId: uuid('brand_id').notNull().references(() => drugBrands.id, { onDelete: 'cascade' }),
  indicationId: uuid('indication_id').notNull().references(() => drugIndications.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.brandId, t.indicationId] })]);

/**
 * Structured dosing: the comparable form of what `drugs.fields.dosing` holds
 * as prose.
 *
 * Every drug gets at least one row, including the 31 whose wording the parser
 * cannot decompose -- those arrive with empty components, `needs_review` set
 * and their own slice of prose in `source_text`, so the information is present
 * and askable rather than missing. Nothing here is a second source of truth:
 * the prose stays what a profile shows, and the sig string is *printed* from
 * these components rather than stored, so the two cannot drift apart.
 *
 * One drug has several rows wherever one dosing statement describes more than
 * one regimen: `alternative` separates the branches the sheet joins with OR,
 * and `step` the stages it joins with "then".
 *
 * See PLAN.md, "Dosing is stored twice: prose to read, structure to compare".
 */
export const dosingRegimens = pgTable('dosing_regimens', {
  id: uuid('id').primaryKey().defaultRandom(),
  drugId: uuid('drug_id').notNull().references(() => drugs.id, { onDelete: 'cascade' }),

  /**
   * The one indication this dose belongs to, or null for "this is the drug's
   * dose" -- which is 235 of 236 and is why it is nullable rather than
   * sentinelled.
   *
   * Points at `drug_indications` rather than at `indications`, so a dose can
   * only be filed under an indication *this drug has*. Written by the parser
   * from a prose line that names it ("Pulmonary hypertension: 20 mg ...") and
   * never assigned by hand, so a prose re-read cannot lose it -- see
   * `rebuildRegimens`.
   */
  indicationId: uuid('indication_id').references(() => drugIndications.id, { onDelete: 'cascade' }),

  /**
   * The variant axes for per-route and per-population dosing. Both carry a
   * value rather than a null so the unique index below actually constrains:
   * in Postgres nulls are distinct, so a nullable key would let the backfill
   * insert duplicates on every run.
   */
  variantRoute: text('variant_route').notNull().default('standard'),
  population: text('population').notNull().default('adult'),

  alternative: integer('alternative').notNull().default(0),
  step: integer('step').notNull().default(0),
  /** The sheet's own word for this step: "Load", "Initial", "Day 1". */
  label: text('label'),

  /**
   * The slice of prose this row was read from. Keeps a row auditable against
   * its source, and is the whole content of a row the parser refused.
   */
  sourceText: text('source_text').notNull(),

  amounts: jsonb('amounts').$type<Amount[]>().notNull().default([]),
  routes: text('routes').array().$type<RouteCode[]>().notNull().default([]),
  site: jsonb('site').$type<Site | null>(),
  frequency: jsonb('frequency').$type<Frequency>().notNull(),
  modifiers: text('modifiers').array().$type<Modifier[]>().notNull().default([]),
  duration: jsonb('duration').$type<Duration | null>(),
  ceiling: jsonb('ceiling').$type<Amount | null>(),
  /** Stored and rendered, never compared: wording is not a fact. */
  qualifiers: text('qualifiers').array().$type<string[]>().notNull().default([]),

  /** The parser could not fully read this one; a human should look. */
  needsReview: boolean('needs_review').notNull().default(false),
  reviewNotes: text('review_notes').array().$type<string[]>().notNull().default([]),
  source: text('source'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('dosing_regimens_drug_idx').on(t.drugId),
  index('dosing_regimens_indication_idx').on(t.indicationId),
  // Declared over `coalesce(indication_id, zero-uuid)` in migration 0010, not
  // over the bare column: nulls are distinct in Postgres, so a plain index
  // would stop constraining the unscoped case -- which is nearly every drug,
  // and is the case the index was added for. Drizzle cannot express the
  // expression, so this states the columns and `tests/dosing-indication.test.ts`
  // checks the index the database actually has.
  uniqueIndex('dosing_regimens_unique')
    .on(t.drugId, t.indicationId, t.variantRoute, t.population, t.alternative, t.step),
]);

/* -------------------------------------------------------------- tags ----- */

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  label: text('label').notNull(),
  kind: tagKind('kind').notNull().default('custom'),
  defaultColorToken: text('default_color_token'),
  sortOrder: integer('sort_order').notNull().default(0),
});

/**
 * Which drugs are on a list -- and, optionally, **which version of each**.
 *
 * `variantTagId` names a class or exam whose wording this list means: *Top
 * Drugs 2026 holds amoxicillin as Infectious Disease words it*. Null is the
 * normal case and means the drug's own profile.
 *
 * It is a pointer rather than a copy for the reason the variant table itself
 * is a layer: the choice is about this list, and the wording still belongs to
 * the class that wrote it. Which also makes the failure mode mild -- delete
 * the class and `on delete set null` drops the pointer, leaving the drug on
 * the list reading its own profile.
 *
 * Studying a list reads these as the default version of each drug, before any
 * variant the scope itself names -- so scoping deliberately to a class still
 * beats a list's standing choice. See `membershipVariants` in
 * `lib/drugs/variants.ts`.
 */
export const drugTags = pgTable('drug_tags', {
  drugId: uuid('drug_id').notNull().references(() => drugs.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  variantTagId: uuid('variant_tag_id').references(() => tags.id, { onDelete: 'set null' }),
}, (t) => [
  primaryKey({ columns: [t.drugId, t.tagId] }),
  index('drug_tags_variant_idx').on(t.variantTagId),
]);

/**
 * One class's or exam's own wording for a drug: a layer over
 * `drugs.fields`, not a copy of it.
 *
 * Asked for 2026-11-09, and it is the thing the scrapped sets section was
 * really for: a class teaches levothyroxine too, says mostly the same facts,
 * and sources them from its own slides. So a variant stores **only the fields
 * it differs on**, and everything else falls through to the drug -- a fix to
 * the base profile improves every variant's view of it, which a copy would not.
 *
 * **A variant is a tag that already exists**, of kind `course` or `exam`, so
 * membership, the browse filter and the study scope all work untouched; this
 * table is the one new thing. Two kinds rather than one because that is how the
 * material is actually addressed -- *PHRM 535*, and *Exam 3* within it -- and
 * they stack: widest first, narrowest wins. The kind is enforced in
 * `lib/drugs/variants.ts` rather than by a constraint, because a check cannot
 * reach another table.
 *
 * Same `FieldValue` envelope as `drugs.fields` -- so the formatter, the flag
 * and the *from X* provenance line on the profile all work with no special
 * case -- and a separate table from `drugs`, so `npm run seed` rewriting the
 * sheet's values can never touch a variant's.
 */
export const drugVariantValues = pgTable('drug_variant_values', {
  drugId: uuid('drug_id').notNull().references(() => drugs.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),

  /** Only the overridden keys. An absent key is not blank, it is *the same*. */
  fields: jsonb('fields').$type<Record<string, FieldValue>>().notNull().default({}),

  /** What this variant does differently in general, in the editor's words. */
  note: text('note'),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => [
  primaryKey({ columns: [t.drugId, t.tagId] }),
  // "Everything this exam says differently", which is the screen that lists
  // one variant's own work.
  index('drug_variant_values_tag_idx').on(t.tagId),
]);

/* -------------------------------------------------- auth (better-auth) --- */

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: userRole('role').notNull().default('student'),
  status: userStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  password: text('password'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  note: text('note'),
  maxUses: integer('max_uses').notNull().default(1),
  uses: integer('uses').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inviteRedemptions = pgTable('invite_redemptions', {
  inviteId: uuid('invite_id').notNull().references(() => invites.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.inviteId, t.userId] })]);

/* ------------------------------------------------------- preferences ----- */

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  theme: themePref('theme').notNull().default('system'),
  colorAxis: colorAxis('color_axis').notNull().default('class'),
  season: seasonPref('season').notNull().default('off'),

  // Whether the season reaches the chrome -- grounds, surfaces, borders -- or
  // stays the wash and the motes. A depth, not a season, which is why it is
  // its own column rather than four more enum labels.
  seasonTint: boolean('season_tint').notNull().default(false),

  // The decorations that belong to light and dark rather than to a season: a
  // starfield in dark, a sunbeam and paper grain in light, warmth by the
  // clock. One switch for the set.
  ambience: boolean('ambience').notNull().default(false),

  // Per-user overrides layered over the site default palette,
  // e.g. { "class:beta-adrenergic-blocker": "#1f6feb" }.
  paletteOverrides: jsonb('palette_overrides').$type<Record<string, string>>().notNull().default({}),
  fieldVisibility: jsonb('field_visibility').$type<Record<string, boolean>>().notNull().default({}),
  studyDefaults: jsonb('study_defaults').$type<Record<string, unknown>>().notNull().default({}),
});

/**
 * A named study setup: the settings of a quiz or a deck, kept so a session you
 * sit often is one click rather than eight controls.
 *
 * `config` holds `{ surface, params }` -- the page it belongs to and that
 * page's own query parameters -- rather than a `StudyConfig`. The forms are
 * GET forms whose state *is* the query, and two of the quiz's settings cannot
 * survive the round trip through a config: `direction` has no value for
 * "mixed, decided per question" and priority is not a config field at all.
 * Storing what the URL says reproduces the page exactly, and survives a new
 * setting being added without a migration.
 */
export const studyPresets = pgTable('study_presets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // The name is how a setup is addressed, so saving over one is a single
  // statement rather than a read-then-decide two tabs could both win.
  uniqueIndex('study_presets_name_unique').on(t.userId, t.name),
]);

/* ------------------------------------------------------------ study ------ */

/**
 * One row per (user, drug, card_key). `cardKey` is a stable hash of the sorted
 * field list plus direction and mode, so toggling a field selection and
 * toggling it back resumes the original schedule instead of restarting it.
 */
export const studyCards = pgTable('study_cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  drugId: uuid('drug_id').notNull().references(() => drugs.id, { onDelete: 'cascade' }),

  cardKey: text('card_key').notNull(),
  mode: studyMode('mode').notNull(),
  direction: studyDirection('direction').notNull(),
  fieldKeys: text('field_keys').array().$type<string[]>().notNull(),

  ease: real('ease').notNull().default(2.5),
  intervalDays: real('interval_days').notNull().default(0),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
  lastResult: boolean('last_result'),
  reviewCount: integer('review_count').notNull().default(0),
  lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
}, (t) => [
  // Back in Drizzle's hands, and expressible again. Migration 0011 had to
  // write it by hand -- `coalesce(drug_id, zero-uuid)`, because nulls are
  // distinct in Postgres and `drug_id` was nullable while a card could be
  // about a set item instead. Migration 0013 dropped that second kind of
  // subject and restored this spelling. See `study_cards_unique` there.
  uniqueIndex('study_cards_unique').on(t.userId, t.drugId, t.cardKey),
  index('study_cards_due_idx').on(t.userId, t.dueAt),
]);

export const quizAttempts = pgTable('quiz_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  score: integer('score').notNull().default(0),
  total: integer('total').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [index('quiz_attempts_user_idx').on(t.userId, t.startedAt)]);

export const quizAnswers = pgTable('quiz_answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  attemptId: uuid('attempt_id').notNull().references(() => quizAttempts.id, { onDelete: 'cascade' }),

  drugId: uuid('drug_id').notNull().references(() => drugs.id, { onDelete: 'cascade' }),

  questionKey: text('question_key').notNull(),
  fieldKey: text('field_key'),
  prompt: jsonb('prompt').$type<Record<string, unknown>>().notNull(),
  choices: jsonb('choices').$type<string[]>().notNull(),

  // Every answer the question would accept. Distractors are sampled from the
  // complement of this set: asking for "an indication of tirzepatide" with
  // Diabetes keyed correct must never offer Weight management as a wrong
  // answer, because it is also right.
  acceptable: jsonb('acceptable').$type<string[]>().notNull().default([]),

  chosenIndex: integer('chosen_index'),
  correctIndex: integer('correct_index').notNull(),
  wasCorrect: boolean('was_correct'),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
}, (t) => [
  index('quiz_answers_attempt_idx').on(t.attemptId),
]);

/* ------------------------------------------------------------- admin ----- */

export const lookupCache = pgTable('lookup_cache', {
  provider: text('provider').notNull(),
  queryKey: text('query_key').notNull(),
  response: jsonb('response').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.provider, t.queryKey] })]);

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  diff: jsonb('diff').$type<Record<string, unknown>>(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_log_at_idx').on(t.at)]);

export const siteSettings = pgTable('site_settings', {
  id: integer('id').primaryKey().default(1),
  siteName: text('site_name').notNull().default('Enkephalin'),
  registrationMode: text('registration_mode').notNull().default('invite'),
  defaultTheme: themePref('default_theme').notNull().default('system'),
  defaultSeason: seasonPref('default_season').notNull().default('off'),
  defaultSeasonTint: boolean('default_season_tint').notNull().default(false),
  defaultAmbience: boolean('default_ambience').notNull().default(false),
  defaultPalette: jsonb('default_palette').$type<Record<string, string>>().notNull().default({}),
  disclaimerText: text('disclaimer_text').notNull()
    .default('Enkephalin is a study aid, not a clinical reference. Do not use it for patient care.'),
});
