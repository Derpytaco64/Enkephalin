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
 * invite codes, no audit log. What a backup holds is the content you made and
 * the progress you earned -- so it is a file you can hand around without
 * handing over the ability to log in as you.
 */
import { asc, eq, inArray } from 'drizzle-orm';
// Relative rather than '@/...' on purpose: scripts/export-backup.ts and
// scripts/restore-backup.ts run this under `node --experimental-strip-types`,
// which resolves no path aliases.
import { db } from '../../db/index.ts';
import {
  brandIndications,
  drugBrands,
  drugIndications,
  drugTags,
  drugs,
  dosingRegimens,
  fieldDefs,
  siteSettings,
  studyCards,
  studyPresets,
  tags,
  userPreferences,
  users,
  type FieldValue,
} from '../../db/schema.ts';
import type { Amount, Duration, Frequency, Site } from '../dosing/model.ts';

/**
 * Bumped when the shape changes in a way a restore has to know about. A
 * restore refuses a version it does not understand rather than guessing at
 * half-matching fields.
 */
export const BACKUP_VERSION = 1;

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
  routes: string[];
  site: Site | null;
  frequency: Frequency;
  modifiers: string[];
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
};

const iso = (value: Date | null) => (value ? value.toISOString() : null);

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
    userRows, prefRows, presetRows, cardRows,
  ] = await Promise.all([
    db.select().from(drugs).orderBy(asc(drugs.slug)),
    db.select().from(drugIndications).orderBy(asc(drugIndications.sortOrder)),
    db.select().from(drugBrands).orderBy(asc(drugBrands.sortOrder)),
    db
      .select({ brandId: brandIndications.brandId, text: drugIndications.text })
      .from(brandIndications)
      .innerJoin(drugIndications, eq(drugIndications.id, brandIndications.indicationId)),
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
  ]);

  const indicationsByDrug = group(indicationRows);
  const brandsByDrug = group(brandRows);
  const regimensByDrug = group(regimenRows);
  const tagsByDrug = group(drugTagRows);

  const indicationsByBrand = new Map<string, string[]>();
  for (const link of linkRows) {
    const list = indicationsByBrand.get(link.brandId);
    if (list) list.push(link.text);
    else indicationsByBrand.set(link.brandId, [link.text]);
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
    sourcePage: drug.sourcePage,
    indications: (indicationsByDrug.get(drug.id) ?? []).map((row) => row.text),
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
  }).filter((entry) => entry.cards.length > 0 || entry.presets.length > 0 || entry.preferences);

  const settings = settingsRows[0] ?? null;

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
  };
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

    await db.delete(drugIndications).where(eq(drugIndications.drugId, drugId));
    const indicationIdByText = new Map<string, string>();
    for (const [index, text] of drug.indications.entries()) {
      const [row] = await db
        .insert(drugIndications)
        .values({ drugId, text, sortOrder: index })
        .returning({ id: drugIndications.id });
      indicationIdByText.set(text, row.id);
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

    report.progressRestored.push(person.email);
  }

  return { ok: true, report };
}
