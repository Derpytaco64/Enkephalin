/**
 * Export and restore, in one file so the two can never drift.
 *
 * The shape is keyed by *natural* keys -- a drug by its slug, a tag by its
 * slug, a brand by its name, a person by their email -- and carries no UUIDs at
 * all. Three reasons: a dump restores into a database it did not come from
 * (which is the whole point of having one), the file is readable and diffable
 * by a person, and nothing internal leaks into a file you might email yourself.
 *
 * Credentials are deliberately absent. No password hashes, no sessions, no
 * invite codes, no verification tokens. What a backup holds is the content you
 * made, the progress you earned and the record of who changed what -- so it is
 * a file you can hand around without handing over the ability to log in as you.
 *
 * **The audit log joins it as of version 2, and the quiz history as of version
 * 3**, both on the owner's call, 2026-11-08.
 * It was the odd one out among the exclusions: not a credential, but the record
 * of who asserted what -- and once export/restore became the only recovery
 * path, the one thing in the database a server move would silently drop. It
 * keeps the no-UUID rule: an entry names its actor by email and its subject by
 * slug or label, and both are resolved again on the way back in.
 *
 * The quiz history was a plain gap rather than a decision. `study_cards` was
 * carried and `quiz_attempts`/`quiz_answers` were not, so a restore brought
 * back *what is due* while losing every score, result and streak -- which made
 * "the progress you earned" half true. Attempts nest their answers, so neither
 * needs an id written down.
 */
import { asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
// Relative rather than '@/...' on purpose: scripts/export-backup.ts and
// scripts/restore-backup.ts run this under `node --experimental-strip-types`,
// which resolves no path aliases.
import { db } from '../../db/index.ts';
import { resolveIndications } from '../drugs/indication-store.ts';
import {
  auditLog,
  brandIndications,
  drugBrands,
  drugIndications,
  drugTags,
  drugs,
  dosingRegimens,
  fieldDefs,
  indications,
  quizAnswers,
  quizAttempts,
  siteSettings,
  studyCards,
  studyPresets,
  tags,
  userPreferences,
  users,
  type FieldValue,
} from '../../db/schema.ts';
import type { Amount, Duration, Frequency, Modifier, RouteCode, Site } from '../dosing/model.ts';

/**
 * Bumped when the shape changes in a way a restore has to know about. A
 * restore refuses a version it does not understand rather than guessing at
 * half-matching fields.
 */
export const BACKUP_VERSION = 3;

export type BackupBrand = {
  name: string;
  family: string;
  route: string | null;
  form: string | null;
  dosingOverride: string | null;
  defaultPairingSuspect: boolean;
  suspectReason: string | null;
  note: string | null;
  /** Indication texts this brand covers. Empty means all of the drug's. */
  indications: string[];
};

export type BackupRegimen = {
  variantRoute: string;
  population: string;
  alternative: number;
  step: number;
  label: string | null;
  sourceText: string;
  amounts: Amount[];
  routes: RouteCode[];
  site: Site | null;
  frequency: Frequency;
  modifiers: Modifier[];
  duration: Duration | null;
  ceiling: Amount | null;
  qualifiers: string[];
  needsReview: boolean;
  reviewNotes: string[];
  source: string | null;
};

export type BackupDrug = {
  slug: string;
  genericName: string;
  drugClass: string | null;
  schedule: string | null;
  scheduleNote: string | null;
  rxcui: string | null;
  fields: Record<string, FieldValue>;
  needsClassReview: boolean;
  classCandidates: string[];
  classSuggestion: string | null;
  needsPairingReview: boolean;
  /** Absent in files written before this flag existed, which means false. */
  dosingUnique?: boolean;
  sourcePage: number | null;
  indications: string[];
  brands: BackupBrand[];
  regimens: BackupRegimen[];
  /** Tag slugs, categories included -- the seeder will rebuild those anyway. */
  tags: string[];
};

export type BackupFieldDef = {
  key: string;
  label: string;
  group: string | null;
  dataType: string;
  enumOptions: string[] | null;
  isCore: boolean;
  sortOrder: number;
  yearLevels: string[];
  blankMeansNone: boolean;
  isQuizzable: boolean;
  defaultVisible: boolean;
  helpText: string | null;
  promptTemplate: string | null;
  lookupMapping: Record<string, string> | null;
  deletedAt: string | null;
};

/**
 * One sat quiz, with its answers nested inside it.
 *
 * Nested rather than two flat lists because that is what lets the file keep its
 * no-UUID rule: an answer belongs to its attempt by *position in the file*, so
 * `attempt_id` never has to be written down. The attempt in turn belongs to the
 * person it is nested under.
 *
 * None of the jsonb needs translating, which is worth saying because it was not
 * obvious until it was checked: `question_key` is a kind and a field
 * (`fields_to_drug:dosing`), `prompt` carries the drug's slug and generic,
 * `choices` and `acceptable` are plain answer text, and `config` names its
 * scope by tag slug. No database ids anywhere.
 */
export type BackupAttempt = {
  config: Record<string, unknown>;
  score: number;
  total: number;
  /** ISO 8601 with microseconds -- this is an ordered history. */
  startedAt: string;
  finishedAt: string | null;
  answers: BackupAnswer[];
};

export type BackupAnswer = {
  /** The drug asked about. An answer whose drug is gone cannot be restored. */
  drugSlug: string;
  questionKey: string;
  fieldKey: string | null;
  prompt: Record<string, unknown>;
  choices: string[];
  acceptable: string[];
  /** Null where the question was never answered -- an abandoned attempt. */
  chosenIndex: number | null;
  correctIndex: number;
  wasCorrect: boolean | null;
  answeredAt: string | null;
};

export type BackupProgress = {
  /** Who it belongs to. Matched on restore; unknown people are reported. */
  email: string;
  preferences: {
    theme: string;
    colorAxis: string;
    paletteOverrides: Record<string, string>;
    fieldVisibility: Record<string, boolean>;
    studyDefaults: Record<string, unknown>;
  } | null;
  presets: { name: string; config: Record<string, unknown>; createdAt: string }[];
  cards: {
    drugSlug: string;
    cardKey: string;
    mode: string;
    direction: string;
    fieldKeys: string[];
    ease: number;
    intervalDays: number;
    dueAt: string;
    lastResult: boolean | null;
    reviewCount: number;
    lastReviewedAt: string | null;
  }[];
  /** Every quiz this person has sat, oldest first. */
  attempts: BackupAttempt[];
};

/**
 * One audit entry, with every UUID traded for something a different database
 * can resolve.
 *
 * `at` carries **microseconds**, which `Date` cannot hold -- it is read out as
 * text and written back as text for that reason. The same millisecond
 * truncation that broke the audit UI's pagination would, here, quietly reorder
 * a history.
 */
export type BackupAuditEntry = {
  /** ISO 8601 with microseconds, UTC: `2026-11-04T17:47:47.329008Z`. */
  at: string;
  /** Null where the actor was deleted, or where nothing was signed in. */
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  /**
   * The subject by natural key -- a drug or tag slug, an indication slug, a
   * person's email, `site` for the settings row. Null where the subject was
   * already gone when the backup was taken; the `diff` still names it.
   */
  target: string | null;
  diff: Record<string, unknown> | null;
};

export type Backup = {
  version: number;
  generatedAt: string;
  counts: Record<string, number>;
  fieldDefs: BackupFieldDef[];
  tags: { slug: string; label: string; kind: string; defaultColorToken: string | null; sortOrder: number }[];
  drugs: BackupDrug[];
  siteSettings: {
    siteName: string;
    registrationMode: string;
    defaultTheme: string;
    defaultPalette: Record<string, string>;
    disclaimerText: string;
  } | null;
  progress: BackupProgress[];
  /** Oldest first, so a restore writes the history in the order it happened. */
  audit: BackupAuditEntry[];
};

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/**
 * A timestamp that is part of an **ordered history**, read without going
 * through `Date`.
 *
 * `timestamptz` keeps microseconds and `Date` keeps milliseconds, so a round
 * trip through one truncates -- and a truncated history is one whose rows can
 * swap places. This is the same mismatch that cost the audit UI 23 rows of its
 * own pagination; here it would reorder a quiz.
 *
 * Deliberately *not* used for `study_cards`. A due date is day-scale, nothing
 * is ordered by it to the microsecond, and `iso` above is the right shape for
 * a value a person might read.
 */
const exact = (column: AnyPgColumn) =>
  sql<string | null>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * The same timestamp on the way back in.
 *
 * Raw SQL because Drizzle's `timestamp` mapper calls `.toISOString()` on
 * whatever it is handed: a `Date` has already lost the precision and a string
 * throws outright. Postgres parses its own format and keeps all six digits.
 */
const exactIn = (value: string | null) => (value ? sql`${value}::timestamptz` : null);

function group<T extends { drugId: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.drugId);
    if (list) list.push(row);
    else map.set(row.drugId, [row]);
  }
  return map;
}

/* -------------------------------------------------------------- export --- */

export async function exportBackup(): Promise<Backup> {
  const [
    drugRows, indicationRows, brandRows, linkRows, regimenRows,
    tagRows, drugTagRows, defRows, settingsRows,
    userRows, prefRows, presetRows, cardRows, attemptRows, answerRows,
  ] = await Promise.all([
    db.select().from(drugs).orderBy(asc(drugs.slug)),
    db
      .select({
        drugId: drugIndications.drugId,
        label: indications.label,
      })
      .from(drugIndications)
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
      .orderBy(asc(drugIndications.sortOrder)),
    db.select().from(drugBrands).orderBy(asc(drugBrands.sortOrder)),
    db
      .select({ brandId: brandIndications.brandId, label: indications.label })
      .from(brandIndications)
      .innerJoin(drugIndications, eq(drugIndications.id, brandIndications.indicationId))
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId)),
    db
      .select().from(dosingRegimens)
      .orderBy(asc(dosingRegimens.alternative), asc(dosingRegimens.step)),
    db.select().from(tags).orderBy(asc(tags.slug)),
    db.select({ drugId: drugTags.drugId, slug: tags.slug })
      .from(drugTags).innerJoin(tags, eq(tags.id, drugTags.tagId)),
    db.select().from(fieldDefs).orderBy(asc(fieldDefs.sortOrder)),
    db.select().from(siteSettings),
    db.select({ id: users.id, email: users.email }).from(users),
    db.select().from(userPreferences),
    db.select().from(studyPresets).orderBy(asc(studyPresets.createdAt)),
    db.select().from(studyCards),
    db
      .select({
        id: quizAttempts.id,
        userId: quizAttempts.userId,
        config: quizAttempts.config,
        score: quizAttempts.score,
        total: quizAttempts.total,
        startedAt: exact(quizAttempts.startedAt),
        finishedAt: exact(quizAttempts.finishedAt),
      })
      .from(quizAttempts)
      .orderBy(asc(quizAttempts.startedAt), asc(quizAttempts.id)),
    db
      .select({
        attemptId: quizAnswers.attemptId,
        drugId: quizAnswers.drugId,
        questionKey: quizAnswers.questionKey,
        fieldKey: quizAnswers.fieldKey,
        prompt: quizAnswers.prompt,
        choices: quizAnswers.choices,
        acceptable: quizAnswers.acceptable,
        chosenIndex: quizAnswers.chosenIndex,
        correctIndex: quizAnswers.correctIndex,
        wasCorrect: quizAnswers.wasCorrect,
        answeredAt: exact(quizAnswers.answeredAt),
      })
      .from(quizAnswers)
      // Unanswered questions sort last rather than first: `answered_at` is null
      // on an abandoned attempt, and they belong at the end of it.
      .orderBy(asc(quizAnswers.attemptId), sql`${quizAnswers.answeredAt} asc nulls last`,
        asc(quizAnswers.id)),
  ]);

  const answersByAttempt = new Map<string, typeof answerRows>();
  for (const answer of answerRows) {
    const found = answersByAttempt.get(answer.attemptId);
    if (found) found.push(answer);
    else answersByAttempt.set(answer.attemptId, [answer]);
  }

  const indicationsByDrug = group(indicationRows);
  const brandsByDrug = group(brandRows);
  const regimensByDrug = group(regimenRows);
  const tagsByDrug = group(drugTagRows);

  const indicationsByBrand = new Map<string, string[]>();
  for (const link of linkRows) {
    const list = indicationsByBrand.get(link.brandId);
    if (list) list.push(link.label);
    else indicationsByBrand.set(link.brandId, [link.label]);
  }

  const slugById = new Map(drugRows.map((drug) => [drug.id, drug.slug]));

  const exported: BackupDrug[] = drugRows.map((drug) => ({
    slug: drug.slug,
    genericName: drug.genericName,
    drugClass: drug.drugClass,
    schedule: drug.schedule,
    scheduleNote: drug.scheduleNote,
    rxcui: drug.rxcui,
    fields: drug.fields,
    needsClassReview: drug.needsClassReview,
    classCandidates: drug.classCandidates,
    classSuggestion: drug.classSuggestion,
    needsPairingReview: drug.needsPairingReview,
    dosingUnique: drug.dosingUnique,
    sourcePage: drug.sourcePage,
    indications: (indicationsByDrug.get(drug.id) ?? []).map((row) => row.label),
    brands: (brandsByDrug.get(drug.id) ?? []).map((brand) => ({
      name: brand.name,
      family: brand.family,
      route: brand.route,
      form: brand.form,
      dosingOverride: brand.dosingOverride,
      defaultPairingSuspect: brand.defaultPairingSuspect,
      suspectReason: brand.suspectReason,
      note: brand.note,
      indications: indicationsByBrand.get(brand.id) ?? [],
    })),
    regimens: (regimensByDrug.get(drug.id) ?? []).map((regimen) => ({
      variantRoute: regimen.variantRoute,
      population: regimen.population,
      alternative: regimen.alternative,
      step: regimen.step,
      label: regimen.label,
      sourceText: regimen.sourceText,
      amounts: regimen.amounts,
      routes: regimen.routes,
      site: regimen.site,
      frequency: regimen.frequency,
      modifiers: regimen.modifiers,
      duration: regimen.duration,
      ceiling: regimen.ceiling,
      qualifiers: regimen.qualifiers,
      needsReview: regimen.needsReview,
      reviewNotes: regimen.reviewNotes,
      source: regimen.source,
    })),
    tags: (tagsByDrug.get(drug.id) ?? []).map((row) => row.slug).sort(),
  }));

  const prefsByUser = new Map(prefRows.map((row) => [row.userId, row]));
  const progress: BackupProgress[] = userRows.map((user) => {
    const prefs = prefsByUser.get(user.id);
    return {
      email: user.email,
      preferences: prefs
        ? {
            theme: prefs.theme,
            colorAxis: prefs.colorAxis,
            paletteOverrides: prefs.paletteOverrides,
            fieldVisibility: prefs.fieldVisibility,
            studyDefaults: prefs.studyDefaults,
          }
        : null,
      presets: presetRows
        .filter((row) => row.userId === user.id)
        .map((row) => ({ name: row.name, config: row.config, createdAt: row.createdAt.toISOString() })),
      attempts: attemptRows
        .filter((row) => row.userId === user.id)
        .map((attempt) => ({
          config: attempt.config,
          score: attempt.score,
          total: attempt.total,
          // notNull on the column, so `exact` cannot return null here.
          startedAt: attempt.startedAt!,
          finishedAt: attempt.finishedAt,
          answers: (answersByAttempt.get(attempt.id) ?? []).flatMap((answer) => {
            const drugSlug = slugById.get(answer.drugId);
            // An answer whose drug has been deleted has nothing to point at.
            // The attempt keeps its score, which is the number that mattered.
            if (!drugSlug) return [];
            return [{
              drugSlug,
              questionKey: answer.questionKey,
              fieldKey: answer.fieldKey,
              prompt: answer.prompt,
              choices: answer.choices,
              acceptable: answer.acceptable,
              chosenIndex: answer.chosenIndex,
              correctIndex: answer.correctIndex,
              wasCorrect: answer.wasCorrect,
              answeredAt: answer.answeredAt,
            }];
          }),
        })),
      cards: cardRows
        .filter((row) => row.userId === user.id)
        .flatMap((row) => {
          const drugSlug = slugById.get(row.drugId);
          // A schedule whose drug is gone has nothing to attach to.
          if (!drugSlug) return [];
          return [{
            drugSlug,
            cardKey: row.cardKey,
            mode: row.mode,
            direction: row.direction,
            fieldKeys: row.fieldKeys,
            ease: row.ease,
            intervalDays: row.intervalDays,
            dueAt: row.dueAt.toISOString(),
            lastResult: row.lastResult,
            reviewCount: row.reviewCount,
            lastReviewedAt: iso(row.lastReviewedAt),
          }];
        }),
    };
  }).filter((entry) => entry.cards.length > 0 || entry.presets.length > 0
    || entry.attempts.length > 0 || entry.preferences);

  const settings = settingsRows[0] ?? null;
  const audit = await exportAudit();

  return {
    version: BACKUP_VERSION,
    generatedAt: new Date().toISOString(),
    counts: {
      drugs: exported.length,
      brands: brandRows.length,
      indications: indicationRows.length,
      brandIndications: linkRows.length,
      regimens: regimenRows.length,
      tags: tagRows.length,
      drugTags: drugTagRows.length,
      fieldDefs: defRows.length,
      people: progress.length,
      studyCards: cardRows.length,
      quizAttempts: attemptRows.length,
      quizAnswers: answerRows.length,
      auditEntries: audit.length,
    },
    fieldDefs: defRows.map((def) => ({
      key: def.key,
      label: def.label,
      group: def.group,
      dataType: def.dataType,
      enumOptions: def.enumOptions,
      isCore: def.isCore,
      sortOrder: def.sortOrder,
      yearLevels: def.yearLevels,
      blankMeansNone: def.blankMeansNone,
      isQuizzable: def.isQuizzable,
      defaultVisible: def.defaultVisible,
      helpText: def.helpText,
      promptTemplate: def.promptTemplate,
      lookupMapping: def.lookupMapping,
      deletedAt: iso(def.deletedAt),
    })),
    tags: tagRows.map((tag) => ({
      slug: tag.slug,
      label: tag.label,
      kind: tag.kind,
      defaultColorToken: tag.defaultColorToken,
      sortOrder: tag.sortOrder,
    })),
    drugs: exported,
    siteSettings: settings
      ? {
          siteName: settings.siteName,
          registrationMode: settings.registrationMode,
          defaultTheme: settings.defaultTheme,
          defaultPalette: settings.defaultPalette,
          disclaimerText: settings.disclaimerText,
        }
      : null,
    progress,
    audit,
  };
}

/**
 * The audit log, with its UUIDs traded for natural keys.
 *
 * Five target types, five different places the name lives, so the resolution is
 * five lookups built once rather than a join per row -- `target_id` carries no
 * foreign key on purpose (a log that cascaded away with its subject would lose
 * exactly the rows somebody is looking for), so there is nothing to join on
 * anyway.
 *
 * A subject that was already deleted resolves to null rather than being
 * dropped: the entry recording the deletion is the most useful row in the
 * table, and its `diff` still carries the name.
 */
async function exportAudit(): Promise<BackupAuditEntry[]> {
  const rows = await db
    .select({
      at: exact(auditLog.at),
      actorEmail: users.email,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      diff: auditLog.diff,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .orderBy(asc(auditLog.at), asc(auditLog.id));

  const wanted = (type: string) => new Set(
    rows.filter((row) => row.targetType === type && row.targetId).map((row) => row.targetId!),
  );

  // Four explicit lookups rather than one generic helper: Drizzle's column
  // types do not survive being passed around, and four three-line queries are
  // clearer than the generics that would be needed to merge them.
  const asMap = (rows: { id: string; name: string }[]) =>
    new Map(rows.map((row) => [row.id, row.name]));
  const only = (ids: Set<string>) => [...ids];

  const drugIds = only(wanted('drug'));
  const tagIds = only(wanted('tag'));
  const indicationIds = only(wanted('indication'));
  const userIds = only(wanted('user'));

  const [drugNames, tagNames, indicationNames, userNames] = await Promise.all([
    drugIds.length
      ? db.select({ id: drugs.id, name: drugs.slug }).from(drugs)
          .where(inArray(drugs.id, drugIds)).then(asMap)
      : new Map<string, string>(),
    tagIds.length
      ? db.select({ id: tags.id, name: tags.slug }).from(tags)
          .where(inArray(tags.id, tagIds)).then(asMap)
      : new Map<string, string>(),
    indicationIds.length
      ? db.select({ id: indications.id, name: indications.slug }).from(indications)
          .where(inArray(indications.id, indicationIds)).then(asMap)
      : new Map<string, string>(),
    userIds.length
      ? db.select({ id: users.id, name: users.email }).from(users)
          .where(inArray(users.id, userIds)).then(asMap)
      : new Map<string, string>(),
  ]);

  const nameOf = (type: string | null, id: string | null) => {
    if (!id) return null;
    switch (type) {
      case 'drug': return drugNames.get(id) ?? null;
      case 'tag': return tagNames.get(id) ?? null;
      case 'indication': return indicationNames.get(id) ?? null;
      case 'user': return userNames.get(id) ?? null;
      // The settings are a single row with no natural key of their own.
      case 'site_settings': return 'site';
      default: return null;
    }
  };

  return rows.map((row) => ({
    // notNull on the column, so `exact` cannot actually return null here.
    at: row.at!,
    actorEmail: row.actorEmail ?? null,
    action: row.action,
    targetType: row.targetType,
    target: nameOf(row.targetType, row.targetId),
    diff: row.diff ?? null,
  }));
}

/** A filename that sorts chronologically and says what it is. */
export function backupFilename(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `enkephalin-backup_${stamp}.json`;
}

/* ------------------------------------------------------------- restore --- */

export type RestoreMode = 'merge' | 'replace';

export type RestoreReport = {
  mode: RestoreMode;
  drugsInserted: number;
  drugsUpdated: number;
  drugsDeleted: number;
  tagsInserted: number;
  fieldDefsWritten: number;
  progressRestored: string[];
  /** People in the file with no account here. Their progress is not invented. */
  progressSkipped: string[];
  settingsWritten: boolean;
  /** Quiz attempts written, and the answers inside them. */
  quizAttemptsRestored: number;
  quizAnswersRestored: number;
  /**
   * Answers in the file whose drug does not exist here. Dropped, because an
   * answer has nowhere to point without one -- the attempt keeps its score.
   */
  quizAnswersOrphaned: number;
  /** Audit entries written. */
  auditRestored: number;
  /** Entries already present, in `merge` only. */
  auditSkipped: number;
  /**
   * Actor addresses in the file with no account here. Those entries are kept
   * with no actor rather than dropped -- losing *what changed* to preserve
   * *who* would be the wrong trade for a history.
   */
  auditActorsUnmatched: string[];
};

export type RestoreResult =
  | { ok: true; report: RestoreReport }
  | { ok: false; message: string };

/** Enough of a check to refuse a stray JSON file before it touches anything. */
function validate(input: unknown): { ok: true; backup: Backup } | { ok: false; message: string } {
  if (!input || typeof input !== 'object') return { ok: false, message: 'That file is not a backup.' };
  const backup = input as Partial<Backup>;

  if (typeof backup.version !== 'number') {
    return { ok: false, message: 'That file has no backup version, so it is not one of ours.' };
  }
  if (backup.version !== BACKUP_VERSION) {
    return {
      ok: false,
      message: `That backup is version ${backup.version}; this build reads version ${BACKUP_VERSION}.`,
    };
  }
  if (!Array.isArray(backup.drugs) || !Array.isArray(backup.tags)) {
    return { ok: false, message: 'That backup is missing its drugs or its tags.' };
  }
  for (const drug of backup.drugs) {
    if (!drug?.slug || !drug?.genericName) {
      return { ok: false, message: 'A drug in that backup has no slug or no generic name.' };
    }
  }
  return { ok: true, backup: backup as Backup };
}

const SCHEDULES = ['CI', 'CII', 'CIII', 'CIV', 'CV'] as const;
const schedule = (raw: string | null) =>
  raw && (SCHEDULES as readonly string[]).includes(raw) ? (raw as (typeof SCHEDULES)[number]) : null;

/**
 * Writes a backup back into the database.
 *
 * `merge` upserts by slug and leaves anything the file does not mention alone,
 * which is what you want after an accident that lost only some of your work.
 * `replace` first deletes every drug and tag, which is what you want when
 * moving a database or undoing a bad bulk edit -- and is why it is a separate
 * word you have to choose rather than a flag that defaults on.
 *
 * A drug's children -- brands, indications, regimens, tag links -- are replaced
 * wholesale from the file in both modes. They describe one drug and the file is
 * the authority on it; merging them row by row would silently keep a brand you
 * deleted before the backup was taken.
 */
export async function restoreBackup(input: unknown, mode: RestoreMode): Promise<RestoreResult> {
  const checked = validate(input);
  if (!checked.ok) return checked;
  const { backup } = checked;

  const report: RestoreReport = {
    mode,
    drugsInserted: 0,
    drugsUpdated: 0,
    drugsDeleted: 0,
    tagsInserted: 0,
    fieldDefsWritten: 0,
    progressRestored: [],
    progressSkipped: [],
    settingsWritten: false,
    quizAttemptsRestored: 0,
    quizAnswersRestored: 0,
    quizAnswersOrphaned: 0,
    auditRestored: 0,
    auditSkipped: 0,
    auditActorsUnmatched: [],
  };

  if (mode === 'replace') {
    const keep = new Set(backup.drugs.map((drug) => drug.slug));
    const existing = await db.select({ id: drugs.id, slug: drugs.slug }).from(drugs);
    const doomed = existing.filter((row) => !keep.has(row.slug));
    if (doomed.length > 0) {
      // Brands, indications, regimens, tag links and study schedules cascade.
      await db.delete(drugs).where(inArray(drugs.id, doomed.map((row) => row.id)));
      report.drugsDeleted = doomed.length;
    }
  }

  // Field defs first: a drug's stored values are filed under their keys, and a
  // restored value with no definition would be invisible on the profile.
  for (const def of backup.fieldDefs ?? []) {
    const values = {
      label: def.label,
      group: def.group,
      dataType: def.dataType as 'text',
      enumOptions: def.enumOptions,
      isCore: def.isCore,
      sortOrder: def.sortOrder,
      yearLevels: def.yearLevels,
      blankMeansNone: def.blankMeansNone,
      isQuizzable: def.isQuizzable,
      defaultVisible: def.defaultVisible,
      helpText: def.helpText,
      promptTemplate: def.promptTemplate,
      lookupMapping: def.lookupMapping,
      deletedAt: def.deletedAt ? new Date(def.deletedAt) : null,
    };
    await db
      .insert(fieldDefs)
      .values({ key: def.key, ...values })
      .onConflictDoUpdate({ target: fieldDefs.key, set: values });
    report.fieldDefsWritten += 1;
  }

  const tagIdBySlug = new Map<string, string>();
  for (const tag of backup.tags) {
    const [row] = await db
      .insert(tags)
      .values({
        slug: tag.slug,
        label: tag.label,
        kind: tag.kind as 'custom',
        defaultColorToken: tag.defaultColorToken,
        sortOrder: tag.sortOrder,
      })
      .onConflictDoUpdate({
        target: tags.slug,
        set: { label: tag.label, kind: tag.kind as 'custom', defaultColorToken: tag.defaultColorToken, sortOrder: tag.sortOrder },
      })
      .returning({ id: tags.id });
    tagIdBySlug.set(tag.slug, row.id);
    report.tagsInserted += 1;
  }

  for (const drug of backup.drugs) {
    const values = {
      genericName: drug.genericName,
      drugClass: drug.drugClass,
      schedule: schedule(drug.schedule),
      scheduleNote: drug.scheduleNote,
      rxcui: drug.rxcui,
      fields: drug.fields,
      needsClassReview: drug.needsClassReview,
      classCandidates: drug.classCandidates,
      classSuggestion: drug.classSuggestion,
      needsPairingReview: drug.needsPairingReview,
      dosingUnique: drug.dosingUnique ?? false,
      sourcePage: drug.sourcePage,
      updatedAt: new Date(),
    };

    const [existing] = await db.select({ id: drugs.id }).from(drugs).where(eq(drugs.slug, drug.slug));
    let drugId: string;
    if (existing) {
      await db.update(drugs).set(values).where(eq(drugs.id, existing.id));
      drugId = existing.id;
      report.drugsUpdated += 1;
    } else {
      const [created] = await db
        .insert(drugs)
        .values({ slug: drug.slug, ...values })
        .returning({ id: drugs.id });
      drugId = created.id;
      report.drugsInserted += 1;
    }

    // Indications travel as wording, not as ids, so a backup stays readable
    // and restores into a database whose vocabulary rows are different objects.
    // `resolveIndications` is what reunites them: a label the target already
    // knows joins that row, and one it does not becomes a new entry.
    await db.delete(drugIndications).where(eq(drugIndications.drugId, drugId));
    const indicationIdByText = new Map<string, string>();
    const { rows: vocabulary } = await resolveIndications(drug.indications);
    for (const [index, indication] of vocabulary.entries()) {
      const [row] = await db
        .insert(drugIndications)
        .values({ drugId, indicationId: indication.id, sortOrder: index })
        .returning({ id: drugIndications.id });
      indicationIdByText.set(indication.label, row.id);
    }

    await db.delete(drugBrands).where(eq(drugBrands.drugId, drugId));
    for (const [index, brand] of drug.brands.entries()) {
      const [row] = await db
        .insert(drugBrands)
        .values({
          drugId,
          name: brand.name,
          family: brand.family,
          route: brand.route,
          form: brand.form,
          dosingOverride: brand.dosingOverride,
          defaultPairingSuspect: brand.defaultPairingSuspect,
          suspectReason: brand.suspectReason,
          note: brand.note,
          sortOrder: index,
        })
        .returning({ id: drugBrands.id });

      const links = brand.indications
        .map((text) => indicationIdByText.get(text))
        .filter((id): id is string => Boolean(id))
        .map((indicationId) => ({ brandId: row.id, indicationId }));
      if (links.length > 0) await db.insert(brandIndications).values(links).onConflictDoNothing();
    }

    await db.delete(dosingRegimens).where(eq(dosingRegimens.drugId, drugId));
    if (drug.regimens.length > 0) {
      await db.insert(dosingRegimens).values(drug.regimens.map((regimen) => ({ drugId, ...regimen })));
    }

    await db.delete(drugTags).where(eq(drugTags.drugId, drugId));
    const links = drug.tags
      .map((slug) => tagIdBySlug.get(slug))
      .filter((id): id is string => Boolean(id))
      .map((tagId) => ({ drugId, tagId }));
    if (links.length > 0) await db.insert(drugTags).values(links).onConflictDoNothing();
  }

  if (backup.siteSettings) {
    const values = {
      siteName: backup.siteSettings.siteName,
      registrationMode: backup.siteSettings.registrationMode,
      defaultTheme: backup.siteSettings.defaultTheme as 'system',
      defaultPalette: backup.siteSettings.defaultPalette,
      disclaimerText: backup.siteSettings.disclaimerText,
    };
    await db
      .insert(siteSettings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: siteSettings.id, set: values });
    report.settingsWritten = true;
  }

  // Progress is matched to accounts by email. An account that does not exist
  // here is reported rather than created: making a login out of a backup file
  // is not something a restore should be able to do.
  const slugToId = new Map(
    (await db.select({ id: drugs.id, slug: drugs.slug }).from(drugs)).map((row) => [row.slug, row.id]),
  );
  for (const person of backup.progress ?? []) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, person.email));
    if (!user) {
      report.progressSkipped.push(person.email);
      continue;
    }

    if (person.preferences) {
      const values = {
        theme: person.preferences.theme as 'system',
        colorAxis: person.preferences.colorAxis as 'class',
        paletteOverrides: person.preferences.paletteOverrides,
        fieldVisibility: person.preferences.fieldVisibility,
        studyDefaults: person.preferences.studyDefaults,
      };
      await db
        .insert(userPreferences)
        .values({ userId: user.id, ...values })
        .onConflictDoUpdate({ target: userPreferences.userId, set: values });
    }

    await db.delete(studyPresets).where(eq(studyPresets.userId, user.id));
    if (person.presets.length > 0) {
      await db.insert(studyPresets).values(person.presets.map((preset) => ({
        userId: user.id,
        name: preset.name,
        config: preset.config,
        createdAt: new Date(preset.createdAt),
      })));
    }

    await db.delete(studyCards).where(eq(studyCards.userId, user.id));
    const rows = person.cards.flatMap((card) => {
      const drugId = slugToId.get(card.drugSlug);
      if (!drugId) return [];
      return [{
        userId: user.id,
        drugId,
        cardKey: card.cardKey,
        mode: card.mode as 'inclusive',
        direction: card.direction as 'drug_to_fields',
        fieldKeys: card.fieldKeys,
        ease: card.ease,
        intervalDays: card.intervalDays,
        dueAt: new Date(card.dueAt),
        lastResult: card.lastResult,
        reviewCount: card.reviewCount,
        lastReviewedAt: card.lastReviewedAt ? new Date(card.lastReviewedAt) : null,
      }];
    });
    if (rows.length > 0) await db.insert(studyCards).values(rows);

    await restoreAttempts(person, user.id, slugToId, report);

    report.progressRestored.push(person.email);
  }

  await restoreAudit(backup.audit ?? [], mode, report);

  return { ok: true, report };
}

/**
 * Writes the audit log back, resolving every natural key against this database.
 *
 * **`replace` clears the table first; `merge` adds only what is not already
 * there.** That split matters more here than anywhere else in the file: the
 * audit log is append-only history, so a merge that re-inserted everything
 * would duplicate a record whose whole value is being a faithful count of what
 * happened. With no UUIDs to compare, an entry is identified by what it says --
 * instant, actor, action and subject -- and at microsecond precision that tuple
 * is as close to unique as the table gets.
 *
 * Two things are kept rather than dropped when they cannot be resolved. An
 * **actor with no account here** leaves the entry with a null actor: the row
 * still says a role was changed on a Tuesday, which is worth more than nothing,
 * and the unmatched addresses are reported rather than silently swallowed. A
 * **subject that no longer exists** leaves `target_id` null, which is exactly
 * the state the audit UI already handles -- it falls back to the name in the
 * diff and renders *(deleted)* instead of a dead link.
 */
async function restoreAudit(
  entries: BackupAuditEntry[],
  mode: RestoreMode,
  report: RestoreReport,
) {
  if (mode === 'replace') await db.delete(auditLog);
  if (entries.length === 0) return;

  const [drugIds, tagIds, indicationIds, userIds] = await Promise.all([
    db.select({ id: drugs.id, name: drugs.slug }).from(drugs),
    db.select({ id: tags.id, name: tags.slug }).from(tags),
    db.select({ id: indications.id, name: indications.slug }).from(indications),
    db.select({ id: users.id, name: users.email }).from(users),
  ]);
  const byName = (rows: { id: string; name: string }[]) =>
    new Map(rows.map((row) => [row.name, row.id]));
  const drugsByName = byName(drugIds);
  const tagsByName = byName(tagIds);
  const indicationsByName = byName(indicationIds);
  const usersByName = byName(userIds);

  const targetFor = (entry: BackupAuditEntry) => {
    if (!entry.target) return null;
    switch (entry.targetType) {
      case 'drug': return drugsByName.get(entry.target) ?? null;
      case 'tag': return tagsByName.get(entry.target) ?? null;
      case 'indication': return indicationsByName.get(entry.target) ?? null;
      case 'user': return usersByName.get(entry.target) ?? null;
      // The settings row is always id 1 and has no uuid to resolve.
      case 'site_settings': return null;
      default: return null;
    }
  };

  // In merge, what is already here. The same tuple the doc comment describes,
  // read once rather than queried per entry.
  const present = new Set<string>();
  if (mode === 'merge') {
    const existing = await db
      .select({
        at: exact(auditLog.at),
        actorEmail: users.email,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId));

    for (const row of existing) {
      present.add([row.at, row.actorEmail ?? '', row.action, row.targetType ?? '', row.targetId ?? ''].join('\u0000'));
    }
  }

  const unmatched = new Set<string>();
  const rows: {
    actorId: string | null;
    action: string;
    targetType: string | null;
    targetId: string | null;
    diff: Record<string, unknown> | null;
    at: SQL;
  }[] = [];

  for (const entry of entries) {
    if (!entry.action || !entry.at) continue;

    const actorId = entry.actorEmail ? usersByName.get(entry.actorEmail) ?? null : null;
    if (entry.actorEmail && !actorId) unmatched.add(entry.actorEmail);

    const targetId = targetFor(entry);
    if (mode === 'merge') {
      const key = [entry.at, entry.actorEmail ?? '', entry.action, entry.targetType ?? '', targetId ?? ''].join('\u0000');
      if (present.has(key)) {
        report.auditSkipped += 1;
        continue;
      }
      present.add(key);
    }

    rows.push({
      actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId,
      diff: entry.diff,
      at: exactIn(entry.at)!,
    });
  }

  // Chunked: a long-lived install can have tens of thousands of entries, and
  // one insert that size is a parameter count Postgres will refuse.
  const CHUNK = 500;
  for (let at = 0; at < rows.length; at += CHUNK) {
    await db.insert(auditLog).values(rows.slice(at, at + CHUNK));
  }

  report.auditRestored = rows.length;
  report.auditActorsUnmatched = [...unmatched].sort();
}

/**
 * Writes one person's quiz history back.
 *
 * **Replaced wholesale, in both modes**, which is the same rule the rest of a
 * person's progress follows and the drug's children before it: the file is the
 * authority on what it describes. Merging attempt by attempt would need an
 * identity an attempt does not have -- two quizzes of the same five cards, sat
 * a minute apart, differ only in their timestamps -- and getting that wrong
 * means either a duplicated history or a silently dropped one.
 *
 * The answers cascade with their attempt, so the delete is one statement.
 *
 * An answer whose drug no longer exists is dropped and counted, not invented:
 * `quiz_answers.drug_id` is a real foreign key, so there is nothing to point it
 * at. The attempt still keeps its `score` and `total`, which is the part a
 * results screen shows and the part a streak counts.
 */
async function restoreAttempts(
  person: BackupProgress,
  userId: string,
  slugToId: Map<string, string>,
  report: RestoreReport,
) {
  // "Describes no attempts" and "does not describe attempts" are different
  // files, and only the first one means *delete what is here*. Guarding the
  // delete is what keeps a hand-trimmed file from wiping a history it never
  // claimed to know about.
  if (!Array.isArray(person.attempts)) return;

  await db.delete(quizAttempts).where(eq(quizAttempts.userId, userId));

  for (const attempt of person.attempts) {
    if (!attempt.startedAt) continue;

    const [row] = await db
      .insert(quizAttempts)
      .values({
        userId,
        config: attempt.config ?? {},
        score: attempt.score ?? 0,
        total: attempt.total ?? 0,
        startedAt: exactIn(attempt.startedAt)!,
        finishedAt: exactIn(attempt.finishedAt),
      })
      .returning({ id: quizAttempts.id });

    report.quizAttemptsRestored += 1;

    const answers = (attempt.answers ?? []).flatMap((answer) => {
      const drugId = slugToId.get(answer.drugSlug);
      if (!drugId) {
        report.quizAnswersOrphaned += 1;
        return [];
      }
      return [{
        attemptId: row.id,
        drugId,
        questionKey: answer.questionKey,
        fieldKey: answer.fieldKey,
        prompt: answer.prompt ?? {},
        choices: answer.choices ?? [],
        acceptable: answer.acceptable ?? [],
        chosenIndex: answer.chosenIndex,
        correctIndex: answer.correctIndex ?? 0,
        wasCorrect: answer.wasCorrect,
        answeredAt: exactIn(answer.answeredAt),
      }];
    });

    // Chunked for the same reason the audit log is: a year of study is a lot of
    // answers, and one insert that size is a parameter count Postgres refuses.
    const CHUNK = 500;
    for (let at = 0; at < answers.length; at += CHUNK) {
      await db.insert(quizAnswers).values(answers.slice(at, at + CHUNK));
    }
    report.quizAnswersRestored += answers.length;
  }
}
