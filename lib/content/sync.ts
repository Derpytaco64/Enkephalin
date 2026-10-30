import { eq } from 'drizzle-orm';
// Relative rather than '@/...' on purpose: scripts/sync-content.ts runs this
// under `node --experimental-strip-types`, which resolves no path aliases.
import { db } from '../../db/index.ts';
import { extractRoutes } from './routes.ts';
import {
  brandIndications,
  drugBrands,
  drugIndications,
  drugTags,
  drugs,
  tags,
  type FieldValue,
} from '../../db/schema.ts';

export type SeedBrand = {
  id: string;
  name: string;
  family: string;
  starred?: boolean;
  indication_ids?: string[];
  route?: string | null;
  note?: string | null;
  default_pairing_suspect?: boolean;
  suspect_reason?: string | null;
  dosing_override?: string | null;
};

export type SeedIndication = { id: string; text: string; starred?: boolean };

export type SeedDrug = {
  slug: string;
  generic: string;
  brands?: SeedBrand[];
  indications?: SeedIndication[];
  dosing?: string | null;
  moa?: string | null;
  bbw?: string | null;
  bbw_status?: string | null;
  schedule?: string | null;
  schedule_note?: string | null;
  drug_class?: string | null;
  class_candidates_ranked?: string[];
  class_suggestion?: string | null;
  needs_class_review?: boolean;
  needs_pairing_review?: boolean;
  rxcui?: string | null;
  source_page?: number | null;
  variants?: unknown[];
};

export type SyncReport = {
  drugsInserted: number;
  drugsUpdated: number;
  drugsUnchanged: number;
  brandsInserted: number;
  brandsUpdated: number;
  indicationsInserted: number;
  linksInserted: number;
  tagsLinked: number;
  /** Sheet values withheld because a human had verified a different one. */
  verifiedKept: string[];
  /** Rows in the database that the sheet no longer lists, left for a human. */
  orphanBrands: string[];
  orphanIndications: string[];
  /** Drugs carrying variant dosing the importer will not guess at. */
  variantsSkipped: string[];
  /** Slugs the sheet listed more than once, folded into one drug. */
  mergedSlugs: string[];
};

const TOP_LIST_TAG = { slug: 'top-drugs-2026', label: 'Top Drugs 2026', kind: 'top_list' as const };

const SCHEDULES = ['CI', 'CII', 'CIII', 'CIV', 'CV'] as const;
type Schedule = (typeof SCHEDULES)[number];

function parseSchedule(raw: string | null | undefined): Schedule | null {
  if (!raw) return null;
  const value = raw.trim().toUpperCase();
  return (SCHEDULES as readonly string[]).includes(value) ? (value as Schedule) : null;
}

function emptyReport(): SyncReport {
  return {
    drugsInserted: 0,
    drugsUpdated: 0,
    drugsUnchanged: 0,
    brandsInserted: 0,
    brandsUpdated: 0,
    indicationsInserted: 0,
    linksInserted: 0,
    tagsLinked: 0,
    verifiedKept: [],
    orphanBrands: [],
    orphanIndications: [],
    variantsSkipped: [],
    mergedSlugs: [],
  };
}

/**
 * The non-core field values the sheet supplies. Core fields — generic name,
 * class, schedule, brands, indications — live in their own columns and tables,
 * so they are deliberately absent here: one value, one home.
 */
function seedFieldValues(drug: SeedDrug, now: string): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};

  const add = (key: string, raw: string | null | undefined, status: FieldValue['status']) => {
    values[key] = { value: raw?.trim() || null, status, source: 'class sheet', updatedAt: now, updatedBy: null };
  };

  add('dosing', drug.dosing, 'unverified');
  add('moa', drug.moa, 'unverified');

  // Route is read out of the name and dosing text rather than being its own
  // sheet column. Only explicit evidence counts: an infusion written as a
  // rate, or an insulin whose text never says subcutaneous, is left blank for
  // a human instead of inferred.
  const { routes, source } = extractRoutes({ name: drug.generic, dosing: drug.dosing });
  if (routes.length > 0) {
    values.route = {
      value: routes.join('\n'),
      status: 'unverified',
      source: source === 'name' ? 'the drug name' : 'the sheet dosing text',
      updatedAt: now,
      updatedBy: null,
    };
  }

  // bbw_status "none" is the sheet affirming there is no warning, which is an
  // answer. Recording it as not_applicable keeps it out of the review queue
  // and lets a flashcard ask the question honestly.
  const noWarning = (drug.bbw_status ?? '') === 'none' || !(drug.bbw ?? '').trim();
  add('bbw', drug.bbw, noWarning ? 'not_applicable' : 'unverified');

  return values;
}

/**
 * Merges sheet values over stored ones. A verified value is never replaced by
 * a differing sheet value unless forced, and an unchanged value keeps its
 * existing envelope so a second run writes nothing.
 */
function mergeFieldValues(
  stored: Record<string, FieldValue>,
  incoming: Record<string, FieldValue>,
  options: { force: boolean; slug: string; report: SyncReport },
) {
  const merged: Record<string, FieldValue> = { ...stored };
  let changed = false;

  for (const [key, next] of Object.entries(incoming)) {
    const current = stored[key];

    if (current && current.value === next.value && current.status === next.status) continue;

    if (current?.status === 'verified' && current.value !== next.value && !options.force) {
      options.report.verifiedKept.push(`${options.slug}.${key}`);
      continue;
    }

    merged[key] = next;
    changed = true;
  }

  return { merged, changed };
}

async function ensureTopListTag() {
  const [existing] = await db.select().from(tags).where(eq(tags.slug, TOP_LIST_TAG.slug));
  if (existing) return existing.id;

  const [created] = await db.insert(tags).values(TOP_LIST_TAG).returning({ id: tags.id });
  return created.id;
}

async function syncIndications(drugId: string, seed: SeedDrug, report: SyncReport) {
  const existing = await db.select().from(drugIndications).where(eq(drugIndications.drugId, drugId));
  const byText = new Map(existing.map((row) => [row.text, row]));
  const seeded = seed.indications ?? [];

  // seed id -> database id, so brand links can be resolved below
  const idMap = new Map<string, string>();

  for (const [index, indication] of seeded.entries()) {
    const text = indication.text.trim();
    const found = byText.get(text);

    if (found) {
      if (found.sortOrder !== index) {
        await db.update(drugIndications).set({ sortOrder: index }).where(eq(drugIndications.id, found.id));
      }
      idMap.set(indication.id, found.id);
      continue;
    }

    const [created] = await db
      .insert(drugIndications)
      .values({ drugId, text, sortOrder: index })
      .returning({ id: drugIndications.id });
    idMap.set(indication.id, created.id);
    report.indicationsInserted += 1;
  }

  const seededTexts = new Set(seeded.map((i) => i.text.trim()));
  for (const row of existing) {
    if (!seededTexts.has(row.text)) report.orphanIndications.push(`${seed.slug}: ${row.text}`);
  }

  return idMap;
}

async function syncBrands(
  drugId: string,
  seed: SeedDrug,
  indicationIds: Map<string, string>,
  report: SyncReport,
) {
  const existing = await db.select().from(drugBrands).where(eq(drugBrands.drugId, drugId));
  const byName = new Map(existing.map((row) => [row.name, row]));
  const seeded = seed.brands ?? [];

  for (const [index, brand] of seeded.entries()) {
    const name = brand.name.trim();
    const found = byName.get(name);
    let brandId: string;

    if (found) {
      brandId = found.id;
      const patch: Partial<typeof drugBrands.$inferInsert> = {};
      if (found.family !== brand.family) patch.family = brand.family;
      if (found.route !== (brand.route ?? null)) patch.route = brand.route ?? null;
      if (found.note !== (brand.note ?? null)) patch.note = brand.note ?? null;
      if (found.sortOrder !== index) patch.sortOrder = index;
      if (brand.dosing_override && found.dosingOverride !== brand.dosing_override) {
        patch.dosingOverride = brand.dosing_override;
      }

      // default_pairing_suspect is review state, not a sheet fact: it is set
      // when the row is created and confirming clears it. Re-importing must
      // not raise it again on something a human already settled.
      if (Object.keys(patch).length > 0) {
        await db.update(drugBrands).set(patch).where(eq(drugBrands.id, found.id));
        report.brandsUpdated += 1;
      }
    } else {
      const [created] = await db
        .insert(drugBrands)
        .values({
          drugId,
          name,
          family: brand.family,
          route: brand.route ?? null,
          note: brand.note ?? null,
          sortOrder: index,
          dosingOverride: brand.dosing_override ?? null,
          defaultPairingSuspect: brand.default_pairing_suspect ?? false,
          suspectReason: brand.suspect_reason ?? null,
        })
        .returning({ id: drugBrands.id });
      brandId = created.id;
      report.brandsInserted += 1;
    }

    // Links are only ever added. A human confirming a pairing is the authority
    // here, and the sheet's asterisk is explicitly only a suggestion.
    for (const seedIndicationId of brand.indication_ids ?? []) {
      const indicationId = indicationIds.get(seedIndicationId);
      if (!indicationId) continue;

      const inserted = await db
        .insert(brandIndications)
        .values({ brandId, indicationId })
        .onConflictDoNothing()
        .returning({ brandId: brandIndications.brandId });
      if (inserted.length > 0) report.linksInserted += 1;
    }
  }

  const seededNames = new Set(seeded.map((b) => b.name.trim()));
  for (const row of existing) {
    if (!seededNames.has(row.name)) report.orphanBrands.push(`${seed.slug}: ${row.name}`);
  }
}

/**
 * The sheet lists some generics on more than one row: sildenafil appears as
 * Revatio for pulmonary hypertension and as Viagra for erectile dysfunction,
 * both slugged `sildenafil`. Importing them as separate drugs is impossible
 * (the slug is unique) and importing them one over the other is worse than
 * useless -- the second row's dosing wins and both brands end up covering
 * both indications by default, so the app would teach Viagra for pulmonary
 * hypertension.
 *
 * Folding them into one drug is what the data model already describes: one
 * generic, brands fanning out, each brand linked to the indications from its
 * own row. No guessing is involved -- the sheet pairs them by putting them on
 * separate rows -- and each brand keeps its own dosing where the rows differ.
 */
function mergeDuplicateSlugs(records: SeedDrug[], report: SyncReport): SeedDrug[] {
  const grouped = new Map<string, SeedDrug[]>();
  for (const record of records) {
    const existing = grouped.get(record.slug);
    if (existing) existing.push(record);
    else grouped.set(record.slug, [record]);
  }

  return [...grouped.values()].map((group) => {
    if (group.length === 1) return group[0];

    report.mergedSlugs.push(group[0].slug);
    const dosings = new Set(group.map((r) => (r.dosing ?? '').trim()).filter(Boolean));
    const perRowDosing = dosings.size > 1;

    const indications: SeedIndication[] = [];
    const brands: SeedBrand[] = [];
    // The extractor numbers ids per row, so every duplicate row reuses
    // `<slug>--ind-0` and `<slug>--brand-0`. Prefixing with the row index
    // keeps them apart; without it the rows' indications collide and both
    // brands end up pointing at whichever row was read last.
    const keyFor = (rowIndex: number, id: string) => `${rowIndex}:${id}`;
    const keyByText = new Map<string, string>();

    for (const [rowIndex, row] of group.entries()) {
      const rowIndicationIds: string[] = [];

      for (const indication of row.indications ?? []) {
        const text = indication.text.trim();
        let key = keyByText.get(text);
        if (!key) {
          key = keyFor(rowIndex, indication.id);
          keyByText.set(text, key);
          indications.push({ ...indication, id: key });
        }
        rowIndicationIds.push(key);
      }

      for (const brand of row.brands ?? []) {
        brands.push({
          ...brand,
          id: keyFor(rowIndex, brand.id),
          // Explicit, so neither brand falls back to "covers all".
          indication_ids: [
            ...(brand.indication_ids ?? []).map((id) => keyFor(rowIndex, id)),
            ...rowIndicationIds,
          ],
          dosing_override: perRowDosing ? (row.dosing ?? null) : (brand.dosing_override ?? null),
        });
      }
    }

    return {
      ...group[0],
      brands,
      indications,
      drug_class: group.find((r) => r.drug_class)?.drug_class ?? null,
      schedule: group.find((r) => r.schedule)?.schedule ?? null,
      needs_class_review: group.some((r) => r.needs_class_review),
      needs_pairing_review: group.some((r) => r.needs_pairing_review),
      class_candidates_ranked: group[0].class_candidates_ranked ?? [],
    };
  });
}

export async function syncDrugs(seed: SeedDrug[], options: { force?: boolean } = {}) {
  const force = options.force ?? false;
  const report = emptyReport();
  const tagId = await ensureTopListTag();
  const now = new Date().toISOString();

  for (const drug of mergeDuplicateSlugs(seed, report)) {
    const [existing] = await db.select().from(drugs).where(eq(drugs.slug, drug.slug));
    const incoming = seedFieldValues(drug, now);
    let drugId: string;

    if (!existing) {
      const [created] = await db
        .insert(drugs)
        .values({
          slug: drug.slug,
          genericName: drug.generic,
          drugClass: drug.drug_class ?? null,
          schedule: parseSchedule(drug.schedule),
          scheduleNote: drug.schedule_note ?? null,
          rxcui: drug.rxcui ?? null,
          sourcePage: drug.source_page ?? null,
          fields: incoming,
          needsClassReview: drug.needs_class_review ?? false,
          classCandidates: drug.class_candidates_ranked ?? [],
          classSuggestion: drug.class_suggestion ?? null,
          needsPairingReview: drug.needs_pairing_review ?? false,
        })
        .returning({ id: drugs.id });
      drugId = created.id;
      report.drugsInserted += 1;
    } else {
      drugId = existing.id;
      const { merged, changed } = mergeFieldValues(existing.fields, incoming, { force, slug: drug.slug, report });
      const patch: Partial<typeof drugs.$inferInsert> = {};

      if (changed) patch.fields = merged;
      if (existing.genericName !== drug.generic) patch.genericName = drug.generic;

      // The sheet fills gaps and corrects facts, but never blanks a value that
      // is already there: a class picked by hand in the review queue outranks
      // the sheet having none.
      if (drug.drug_class && existing.drugClass !== drug.drug_class) patch.drugClass = drug.drug_class;
      const schedule = parseSchedule(drug.schedule);
      if (schedule && existing.schedule !== schedule) patch.schedule = schedule;
      if (drug.schedule_note && existing.scheduleNote !== drug.schedule_note) {
        patch.scheduleNote = drug.schedule_note;
      }
      if (drug.rxcui && existing.rxcui !== drug.rxcui) patch.rxcui = drug.rxcui;

      if (Object.keys(patch).length > 0) {
        await db
          .update(drugs)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(drugs.id, drugId));
        report.drugsUpdated += 1;
      } else {
        report.drugsUnchanged += 1;
      }
    }

    const indicationIds = await syncIndications(drugId, drug, report);
    await syncBrands(drugId, drug, indicationIds, report);

    const linkedTag = await db
      .insert(drugTags)
      .values({ drugId, tagId })
      .onConflictDoNothing()
      .returning({ drugId: drugTags.drugId });
    if (linkedTag.length > 0) report.tagsLinked += 1;

    // One drug (estradiol) lists newline-separated product families against
    // "product dependent" dosing. Turning that into brand rows would be
    // guesswork, and the schema already exists for a human to do it properly
    // in the drug editor.
    if ((drug.variants ?? []).length > 0) report.variantsSkipped.push(drug.slug);
  }

  return report;
}

export async function syncDrugsFromFile(path: string, options: { force?: boolean } = {}) {
  const { readFile } = await import('node:fs/promises');
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { drugs: SeedDrug[] };
  return syncDrugs(parsed.drugs, options);
}
