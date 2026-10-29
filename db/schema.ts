import {
  boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, real,
  text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

/* ---------------------------------------------------------------- enums -- */

export const verificationStatus = pgEnum('verification_status', [
  'unverified',
  'verified',
  'flagged',
  // Blank is an answer, not a gap: 147 of 237 drugs have no black box warning
  // and 213 are not controlled. Without this, the review queue fills with
  // phantom work and flashcards ask for warnings that do not exist.
  'not_applicable',
]);

export const fieldDataType = pgEnum('field_data_type', [
  'text', 'markdown', 'enum', 'list', 'number', 'bool',
]);

export const tagKind = pgEnum('tag_kind', [
  'top_list',    // "Top Drugs 2026" — the sheet edition
  'school_year', // P1 / P2 / P3
  'course',
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

export type FieldValue = {
  value: string | null;
  status: 'unverified' | 'verified' | 'flagged' | 'not_applicable';
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

  // Every non-core field, keyed by field_defs.key -> FieldValue.
  fields: jsonb('fields').$type<Record<string, FieldValue>>().notNull().default({}),

  // Set where RxNorm returned no FDA Established Pharmacologic Class, so a
  // human picks from ranked candidates rather than the importer guessing.
  needsClassReview: boolean('needs_class_review').notNull().default(false),
  classCandidates: jsonb('class_candidates').$type<string[]>().notNull().default([]),
  classSuggestion: text('class_suggestion'),

  // Set where competing brands meet multiple indications and the pairing has
  // not been confirmed. Suppresses brand->indication card generation.
  needsPairingReview: boolean('needs_pairing_review').notNull().default(false),

  sourcePage: integer('source_page'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('drugs_class_idx').on(t.drugClass),
  index('drugs_schedule_idx').on(t.schedule),
]);

/* ------------------------------------------ brands and indications ------- */

export const drugIndications = pgTable('drug_indications', {
  id: uuid('id').primaryKey().defaultRandom(),
  drugId: uuid('drug_id').notNull().references(() => drugs.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('drug_indications_drug_idx').on(t.drugId)]);

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

/* -------------------------------------------------------------- tags ----- */

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  label: text('label').notNull(),
  kind: tagKind('kind').notNull().default('custom'),
  defaultColorToken: text('default_color_token'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const drugTags = pgTable('drug_tags', {
  drugId: uuid('drug_id').notNull().references(() => drugs.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.drugId, t.tagId] })]);

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

  // Per-user overrides layered over the site default palette,
  // e.g. { "class:beta-adrenergic-blocker": "#1f6feb" }.
  paletteOverrides: jsonb('palette_overrides').$type<Record<string, string>>().notNull().default({}),
  fieldVisibility: jsonb('field_visibility').$type<Record<string, boolean>>().notNull().default({}),
  studyDefaults: jsonb('study_defaults').$type<Record<string, unknown>>().notNull().default({}),
});

export const studyPresets = pgTable('study_presets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
}, (t) => [index('quiz_answers_attempt_idx').on(t.attemptId)]);

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
  defaultPalette: jsonb('default_palette').$type<Record<string, string>>().notNull().default({}),
  disclaimerText: text('disclaimer_text').notNull()
    .default('Enkephalin is a study aid, not a clinical reference. Do not use it for patient care.'),
});
