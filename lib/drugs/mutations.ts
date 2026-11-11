import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/db';
import {
  auditLog,
  brandIndications,
  dosingRegimens,
  drugBrands,
  drugIndications,
  drugTags,
  drugs,
  indications,
  tags,
  type FieldValue,
} from '@/db/schema';
import { isUniqueViolation } from '@/lib/db-errors';
import { classColumns, lookUpDrugClass, type ClassLookup } from '@/lib/drugs/class-lookup';
import { setDrugIndicationLinks } from '@/lib/drugs/indication-store';
import { indicationSlug } from '@/lib/drugs/indications';
import { activesOf, notesFor, parseDosing } from '@/lib/dosing/parse';
import type { FieldDef } from '@/lib/fields/registry';

/** Same shape the field editor returns, with room for what was written. */
export type Result<T = undefined> =
  | { ok: true; value?: T }
  | { ok: false; message: string };

const SCHEDULES = ['CI', 'CII', 'CIII', 'CIV', 'CV'] as const;
export type Schedule = (typeof SCHEDULES)[number];

/* ------------------------------------------------------------- naming ---- */

export function drugSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Release and form suffixes, the same set `scripts/build-seed.py` strips.
 * "Wellbutrin SR" is the same brand as "Wellbutrin"; "Zyban" is not. A brand
 * added here has to land in the family the importer would have given it, or
 * distractor sampling sees two families where there is one.
 */
const FORM_SUFFIX = /\s+(SR|XR|ER|XL|CR|DR|LA|ODT|CD|HFA|XR-ODT|Respiclick|Redihaler)\b.*$/i;

export function brandFamily(name: string) {
  return name.replace(FORM_SUFFIX, '').trim();
}

/** One per line, blanks dropped -- how brands and indications are typed in. */
function lines(raw: string) {
  return raw.split('\n').map((line) => line.trim()).filter(Boolean);
}

/** Keeps the first of each, so a duplicate line is dropped rather than stored twice. */
function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function audit(input: {
  actorId: string;
  action: string;
  drugId: string;
  diff?: Record<string, unknown>;
}) {
  await db.insert(auditLog).values({
    actorId: input.actorId,
    action: input.action,
    targetType: 'drug',
    targetId: input.drugId,
    diff: input.diff ?? null,
  });
}

async function touch(drugId: string) {
  await db.update(drugs).set({ updatedAt: new Date() }).where(eq(drugs.id, drugId));
}

async function drugBySlug(slug: string) {
  const [drug] = await db.select().from(drugs).where(eq(drugs.slug, slug));
  return drug ?? null;
}

/* ----------------------------------------------------------- identity ---- */

export type IdentityInput = {
  genericName: string;
  drugClass: string;
  schedule: string;
  scheduleNote: string;
};

function readSchedule(raw: string): Schedule | null {
  const value = raw.trim().toUpperCase();
  return (SCHEDULES as readonly string[]).includes(value) ? (value as Schedule) : null;
}

export async function updateDrugIdentity(
  slug: string,
  input: IdentityInput,
  actorId: string,
): Promise<Result> {
  const generic = input.genericName.trim();
  if (!generic) return { ok: false, message: 'A drug needs a generic name.' };

  const drug = await drugBySlug(slug);
  if (!drug) return { ok: false, message: 'That drug no longer exists.' };

  const patch = {
    genericName: generic,
    drugClass: input.drugClass.trim() || null,
    schedule: readSchedule(input.schedule),
    scheduleNote: input.scheduleNote.trim() || null,
  };

  // The slug is deliberately left alone. It is in every saved session link,
  // every study_cards row's path back to the drug, and renaming it would
  // break both to no purpose: the name on screen comes from generic_name.
  await db.update(drugs).set({ ...patch, updatedAt: new Date() }).where(eq(drugs.id, drug.id));
  await audit({ actorId, action: 'drug.identity', drugId: drug.id, diff: patch });

  return { ok: true };
}

/* --------------------------------------------------------------- lists --- */

/**
 * Brands and indications are replaced by diff rather than delete-and-reinsert,
 * because other rows point at these ids: `brand_indications` pairs a brand to
 * an indication, and a brand carries its own `dosing_override` and the review
 * state of its pairing. Rewriting the rows would silently drop all of that
 * every time someone fixed a typo elsewhere in the list.
 */
async function syncList<T extends { id: string; sortOrder: number }>(input: {
  rows: T[];
  wanted: string[];
  nameOf: (row: T) => string;
  insert: (name: string, sortOrder: number) => Promise<void>;
  reorder: (row: T, sortOrder: number) => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
}) {
  const byName = new Map(input.rows.map((row) => [input.nameOf(row), row]));
  const keptIds = new Set<string>();

  for (const [index, name] of input.wanted.entries()) {
    const found = byName.get(name);
    if (found) {
      keptIds.add(found.id);
      if (found.sortOrder !== index) await input.reorder(found, index);
      continue;
    }
    await input.insert(name, index);
  }

  const gone = input.rows.filter((row) => !keptIds.has(row.id)).map((row) => row.id);
  if (gone.length > 0) await input.remove(gone);

  return { removed: gone.length };
}

export async function setDrugBrands(slug: string, raw: string, actorId: string): Promise<Result> {
  const drug = await drugBySlug(slug);
  if (!drug) return { ok: false, message: 'That drug no longer exists.' };

  const wanted = unique(lines(raw));
  const rows = await db
    .select()
    .from(drugBrands)
    .where(eq(drugBrands.drugId, drug.id))
    .orderBy(asc(drugBrands.sortOrder));

  await syncList({
    rows,
    wanted,
    nameOf: (row) => row.name,
    insert: async (name, sortOrder) => {
      await db.insert(drugBrands).values({
        drugId: drug.id, name, family: brandFamily(name), sortOrder,
      });
    },
    reorder: async (row, sortOrder) => {
      await db.update(drugBrands).set({ sortOrder }).where(eq(drugBrands.id, row.id));
    },
    // The brand_indications rows cascade with it, which is right: a brand that
    // is gone cannot be paired to anything.
    remove: async (ids) => { await db.delete(drugBrands).where(inArray(drugBrands.id, ids)); },
  });

  await touch(drug.id);
  await audit({ actorId, action: 'drug.brands', drugId: drug.id, diff: { brands: wanted } });
  return { ok: true };
}

export async function setDrugIndications(slug: string, raw: string, actorId: string): Promise<Result> {
  const drug = await drugBySlug(slug);
  if (!drug) return { ok: false, message: 'That drug no longer exists.' };

  // Typed wording joins the shared vocabulary rather than being stored on the
  // drug: type "Seizure" and it finds the "Seizures" row, so there is one of
  // each however the words arrive. Wording that matches nothing is a new entry,
  // and the audit line says which were made so a typo is traceable.
  const { labels, created } = await setDrugIndicationLinks(drug.id, lines(raw));

  await touch(drug.id);
  await audit({
    actorId, action: 'drug.indications', drugId: drug.id,
    diff: { indications: labels, ...(created.length > 0 && { newIndications: created.map((row) => row.label) }) },
  });
  return { ok: true };
}

/**
 * Which of a drug's indications each of its brands is for.
 *
 * Until this existed `brand_indications` had no writer outside the importer and
 * the merge path, so a pairing was unchangeable once asserted -- and seven of
 * them were asserted by `scripts/fill-review-gaps.ts` from FDA labelling, not
 * read off the sheet. An assertion nobody can correct is the wrong kind of
 * fact to have in a study aid, because *Direction decides what counts as
 * correct* turns brand questions on exactly these rows.
 *
 * **A brand with no rows covers all of the drug's indications**, which is the
 * common case and the importer's own default -- Proventil, Ventolin and Proair
 * are all albuterol for all three of its indications. So clearing every box on
 * a brand is meaningful rather than empty: it says "this brand is not narrowed",
 * which is different from saying it treats nothing.
 *
 * Takes the whole map and replaces it, like every other list writer here: a
 * per-checkbox endpoint would make the grid's state and the database's two
 * different things that have to be kept in step.
 */
export async function setBrandIndications(
  slug: string,
  /** Brand id -> the drug_indications ids it is narrowed to. Empty means "all". */
  pairs: Record<string, string[]>,
  actorId: string,
): Promise<Result> {
  const drug = await drugBySlug(slug);
  if (!drug) return { ok: false, message: 'That drug no longer exists.' };

  const brands = await db
    .select({ id: drugBrands.id, name: drugBrands.name })
    .from(drugBrands)
    .where(eq(drugBrands.drugId, drug.id));
  const indications = await db
    .select({ id: drugIndications.id })
    .from(drugIndications)
    .where(eq(drugIndications.drugId, drug.id));

  const brandIds = new Set(brands.map((row) => row.id));
  const indicationIds = new Set(indications.map((row) => row.id));

  // Refuse rather than silently drop: a grid posting an id that is not this
  // drug's means the page was built from stale data, and writing the half of
  // it that happens to match would be worse than declining the save.
  for (const [brandId, wanted] of Object.entries(pairs)) {
    if (!brandIds.has(brandId)) {
      return { ok: false, message: 'That brand does not belong to this drug. Reload and try again.' };
    }
    for (const indicationId of wanted) {
      if (!indicationIds.has(indicationId)) {
        return {
          ok: false,
          message: 'That indication does not belong to this drug. Reload and try again.',
        };
      }
    }
  }

  const rows = [...new Set(
    Object.entries(pairs).flatMap(([brandId, wanted]) =>
      [...new Set(wanted)].map((indicationId) => `${brandId}:${indicationId}`)),
  )].map((key) => {
    const [brandId, indicationId] = key.split(':');
    return { brandId, indicationId };
  });

  await db.transaction(async (tx) => {
    if (brandIds.size > 0) {
      await tx.delete(brandIndications).where(inArray(brandIndications.brandId, [...brandIds]));
    }
    if (rows.length > 0) await tx.insert(brandIndications).values(rows);
  });

  await touch(drug.id);

  // Named brands, not ids: the audit log is read by a person, and a uuid pair
  // says nothing about what was asserted.
  const nameOf = new Map(brands.map((row) => [row.id, row.name]));
  await audit({
    actorId,
    action: 'drug.brand_indications',
    drugId: drug.id,
    diff: {
      narrowed: Object.fromEntries(
        Object.entries(pairs)
          .filter(([, wanted]) => wanted.length > 0)
          .map(([brandId, wanted]) => [nameOf.get(brandId) ?? brandId, wanted.length]),
      ),
      coversAll: brands
        .filter((row) => (pairs[row.id]?.length ?? 0) === 0)
        .map((row) => row.name),
    },
  });

  return { ok: true };
}

/* ---------------------------------------------------------------- tags --- */

/**
 * Replaces the drug's tag links, except the `system` ones.
 *
 * Categories are `system` tags and `scripts/seed-categories.ts` owns them: it
 * rebuilds every system link from its curated map on each run. Letting the
 * editor write them would mean a hand-made category assignment lasts until the
 * next seeder run and then vanishes, which is worse than not offering it. So
 * the editor manages lists, courses and custom tags, and category membership
 * is a change to the map.
 */
export async function setDrugTags(slug: string, tagSlugs: string[], actorId: string): Promise<Result> {
  const drug = await drugBySlug(slug);
  if (!drug) return { ok: false, message: 'That drug no longer exists.' };

  const rows = tagSlugs.length > 0
    ? await db
        .select({ id: tags.id, slug: tags.slug })
        .from(tags)
        .where(and(inArray(tags.slug, tagSlugs), ne(tags.kind, 'system')))
    : [];

  const unknown = tagSlugs.filter((wanted) => !rows.some((row) => row.slug === wanted));
  if (unknown.length > 0) {
    return { ok: false, message: `Not a tag you can assign here: ${unknown.join(', ')}.` };
  }

  // Which version each list already read this drug as, so ticking a box on the
  // drug editor does not quietly reset a choice made in the list builder. This
  // screen is about membership; the version a list means is that list's own
  // business, and it is not on this form to be preserved from.
  const kept = new Map(
    (await db
      .select({ tagId: drugTags.tagId, variantTagId: drugTags.variantTagId })
      .from(drugTags)
      .where(eq(drugTags.drugId, drug.id)))
      .map((row) => [row.tagId, row.variantTagId] as const),
  );

  await db.delete(drugTags).where(
    and(
      eq(drugTags.drugId, drug.id),
      inArray(
        drugTags.tagId,
        db.select({ id: tags.id }).from(tags).where(ne(tags.kind, 'system')),
      ),
    ),
  );

  if (rows.length > 0) {
    await db
      .insert(drugTags)
      .values(rows.map((row) => ({
        drugId: drug.id,
        tagId: row.id,
        variantTagId: kept.get(row.id) ?? null,
      })))
      .onConflictDoNothing();
  }

  await audit({ actorId, action: 'drug.tags', drugId: drug.id, diff: { tags: tagSlugs } });
  return { ok: true };
}

/**
 * Marks the dosing as a sig too involved to decode -- or unmarks it.
 *
 * This is a statement about the dosing, not about the parser: it says "stop
 * asking, this is what it looks like". Flipping it re-reads the prose, because
 * that is what decides whether the stored row is a to-do or a settled answer.
 */
export async function setDosingUnique(
  slug: string,
  unique: boolean,
  actorId: string,
): Promise<Result> {
  const drug = await drugBySlug(slug);
  if (!drug) return { ok: false, message: 'That drug no longer exists.' };
  if (drug.dosingUnique === unique) return { ok: true };

  await db.update(drugs).set({ dosingUnique: unique, updatedAt: new Date() }).where(eq(drugs.id, drug.id));
  await audit({ actorId, action: 'drug.dosing_unique', drugId: drug.id, diff: { unique } });

  await rebuildRegimens(drug.id, drug.genericName, drug.fields.dosing?.value ?? null, actorId, { unique });
  return { ok: true };
}

/* -------------------------------------------------------------- fields --- */

export type FieldInput = {
  key: string;
  value: string;
  source: string;
  /** Blank keeps whatever the value already carried. */
  status: string;
};

const STATUSES = ['ok', 'flagged', 'none'] as const;

/**
 * Writes one stored field value, envelope included.
 *
 * Status says what kind of value this is, not how much to trust it: a value in
 * the database is a value to study, and saving one is what records it. So the
 * only choices are `ok`, `flagged` (someone doubts it, and it is still asked)
 * and `none` (there is nothing to record, which is itself an answer).
 */
export async function setDrugField(
  slug: string,
  def: FieldDef,
  input: FieldInput,
  actorId: string,
): Promise<Result> {
  if (def.isCore) {
    return { ok: false, message: `${def.label} is stored in its own column, not here.` };
  }

  const drug = await drugBySlug(slug);
  if (!drug) return { ok: false, message: 'That drug no longer exists.' };

  const value = input.value.trim() || null;
  const current = drug.fields[def.key];
  const asked = (STATUSES as readonly string[]).includes(input.status)
    ? (input.status as FieldValue['status'])
    : null;

  // A field whose blank means "none" records that as a fact rather than a gap:
  // no black box warning is an answer, and an unfilled mechanism is not.
  const status: FieldValue['status'] = asked
    ?? (value === null && def.blankMeansNone ? 'none' : current?.status ?? 'ok');

  const next: FieldValue = {
    value,
    status,
    source: input.source.trim() || current?.source || null,
    updatedAt: new Date().toISOString(),
    updatedBy: actorId,
  };

  if (current && current.value === next.value && current.status === next.status
    && current.source === next.source) {
    return { ok: true };
  }

  await db
    .update(drugs)
    .set({ fields: { ...drug.fields, [def.key]: next }, updatedAt: new Date() })
    .where(eq(drugs.id, drug.id));
  await audit({
    actorId, action: 'drug.field', drugId: drug.id,
    diff: { key: def.key, from: current?.value ?? null, to: next.value, status: next.status },
  });

  // Dosing prose is the source of the structured regimens, so a prose edit has
  // to reach them or the sig a quiz compares against is the old wording's.
  if (def.key === 'dosing') {
    await rebuildRegimens(drug.id, drug.genericName, value, actorId, { unique: drug.dosingUnique });
  }

  return { ok: true };
}

/* -------------------------------------------------------------- dosing --- */

/**
 * Re-reads a drug's dosing prose into `dosing_regimens`, the same way
 * `scripts/backfill-dosing.ts` does.
 *
 * The prose is the source and these rows are a reading of it, so editing the
 * prose replaces them outright -- there is nothing here for a person to have
 * hand-corrected, because nothing edits these rows directly. When a regimen
 * editor does exist it will need a "leave this one alone" flag; see PLAN.md.
 *
 * Refused prose still gets a row, components empty, so the dosing is present
 * and askable rather than missing.
 *
 * `unique` is the human saying the sig is simply like that. The row is stored
 * the same way either way -- what changes is whether it counts as review work,
 * because "nobody has looked at this" and "somebody looked and this is the
 * answer" are different states that otherwise look identical.
 *
 * Where the prose splits by indication -- one line each, `Pulmonary
 * hypertension: 20 mg ...` -- each row is filed under that indication. The
 * wording is matched to one of *this drug's* indications through the same
 * alias table the vocabulary uses, so *Seizure* and *Seizures* land on the same
 * row. A heading that matches nothing is **not** dropped and not guessed at:
 * the row stores with no indication and says so in the review notes, which is
 * how it reaches the dosing bench instead of quietly becoming a dose for the
 * whole drug.
 */
export async function rebuildRegimens(
  drugId: string,
  genericName: string,
  prose: string | null,
  actorId: string,
  options: { unique?: boolean } = {},
): Promise<{ status: 'replaced' | 'cleared'; rows: number }> {
  await db.delete(dosingRegimens).where(eq(dosingRegimens.drugId, drugId));

  if (!prose) {
    await audit({ actorId, action: 'dosing.cleared', drugId });
    return { status: 'cleared', rows: 0 };
  }

  const result = parseDosing(prose, activesOf(genericName));
  const regimens = result.regimens.length > 0 ? result.regimens : [{
    sourceText: prose, alternative: 0, step: 0, label: null, indication: null,
    amounts: [], routes: [], site: null,
    frequency: { kind: 'unspecified' as const },
    modifiers: [], duration: null, ceiling: null, qualifiers: [],
  }];

  const branches = await resolveBranches(drugId, regimens);

  /**
   * One row's own notes, not the whole drug's.
   *
   * A split dosing stores one row per branch, and `result.notes` is a flat
   * list -- so handing every row all of them marks a branch that read
   * perfectly as review work because another branch did not. `notesFor` reads
   * the per-branch structure instead; for a dosing that never split it hands
   * back the whole list, which is every other drug.
   */
  const notesOn = (regimen: { indication: string | null }) => [
    ...(options.unique
      ? ['Marked a unique sig: stored as written, and asked as free recall rather than multiple choice.']
      : notesFor(result, regimen.indication)),
    ...(unmatched(regimen, branches)
      ? [`"${regimen.indication}" is not one of this drug's indications, so this dose is stored without one. Add the indication, or correct the heading.`]
      : []),
  ];

  await db.insert(dosingRegimens).values(regimens.map((regimen) => ({
    drugId,
    indicationId: regimen.indication === null
      ? null
      : branches.get(regimen.indication.toLowerCase()) ?? null,
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
    // Marked unique means settled: it is not waiting on anyone -- but an
    // unmatched indication heading is not about the sig, so it still asks.
    needsReview: unmatched(regimen, branches)
      || (options.unique ? false : notesOn(regimen).length > 0),
    reviewNotes: notesOn(regimen),
    source: 'drug editor',
  })));

  await audit({
    actorId, action: 'dosing.reparsed', drugId,
    diff: {
      status: result.status,
      rows: regimens.length,
      unique: options.unique ?? false,
      notes: result.notes,
      branches: [...new Set(regimens.map((regimen) => regimen.indication).filter(Boolean))],
    },
  });
  return { status: 'replaced', rows: regimens.length };
}

/** True where the prose named an indication and this drug does not have it. */
function unmatched(
  regimen: { indication: string | null },
  branches: Map<string, string>,
): boolean {
  return regimen.indication !== null && !branches.has(regimen.indication.toLowerCase());
}

/**
 * The drug's own indication rows, keyed by every wording the prose might have
 * used for them: the label as stored, and the slug the alias table folds it to.
 *
 * Read per rebuild rather than cached. A dosing edit is rare and a stale map
 * would file a dose under the wrong condition, which is the one outcome worth
 * more than a query.
 */
async function resolveBranches(
  drugId: string,
  regimens: { indication: string | null }[],
): Promise<Map<string, string>> {
  if (!regimens.some((regimen) => regimen.indication !== null)) return new Map();

  const rows = await db
    .select({ linkId: drugIndications.id, label: indications.label, slug: indications.slug })
    .from(drugIndications)
    .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
    .where(eq(drugIndications.drugId, drugId));

  const bySlug = new Map(rows.map((row) => [row.slug, row.linkId]));
  const found = new Map<string, string>();
  for (const row of rows) found.set(row.label.toLowerCase(), row.linkId);

  // Then the written wording, through the alias table, so "Seizures" reaches
  // the row stored as "Seizure".
  for (const regimen of regimens) {
    if (regimen.indication === null) continue;
    const written = regimen.indication.toLowerCase();
    if (found.has(written)) continue;
    const linkId = bySlug.get(indicationSlug(regimen.indication));
    if (linkId !== undefined) found.set(written, linkId);
  }

  return found;
}

/* -------------------------------------------------------------- create --- */

export type NewDrugInput = IdentityInput & {
  brands: string;
  indications: string;
  dosing: string;
  dosingUnique: boolean;
  tagSlugs: string[];
};

/**
 * Creates a drug by hand, for what the sheet does not carry. Everything it
 * writes is marked as coming from whoever typed it, never from the sheet: the
 * provenance is the whole reason "verified only" is worth filtering by.
 *
 * **The class is looked up where none was given**, the way the library's first
 * 236 were: `lookUpDrugClass` asks RxNav for the FDA's Established
 * Pharmacologic Class and this writes it, with the RxCUI it resolved and the
 * other vocabularies' answers as candidates. Only where none was given --
 * whoever typed one, or the lecture that named one, outranks a lookup -- and a
 * drug the FDA gives no EPC stays null, which reads as *Uncategorized*. The
 * lookup cannot fail a creation: unreachable means a drug with no class, not a
 * refusal. See `lib/drugs/class-lookup.ts`.
 *
 * `lookUpClass` is injectable for the tests; nothing else passes it.
 */
export async function createDrug(
  input: NewDrugInput,
  actorId: string,
  options: { lookUpClass?: (generic: string) => Promise<ClassLookup> } = {},
): Promise<Result<string>> {
  const generic = input.genericName.trim();
  if (!generic) return { ok: false, message: 'A drug needs a generic name.' };

  const slug = drugSlug(generic);
  if (!slug) return { ok: false, message: 'That name has no letters or digits to make a slug from.' };

  const given = input.drugClass.trim();
  const found = given ? null : await (options.lookUpClass ?? lookUpDrugClass)(generic);
  const classed = found === null
    ? { drugClass: given, rxcui: null, classCandidates: [], needsClassReview: false }
    : classColumns(found);

  let drugId: string;
  try {
    const [created] = await db
      .insert(drugs)
      .values({
        slug,
        genericName: generic,
        drugClass: classed.drugClass || null,
        rxcui: classed.rxcui,
        classCandidates: classed.classCandidates,
        needsClassReview: classed.needsClassReview,
        schedule: readSchedule(input.schedule),
        scheduleNote: input.scheduleNote.trim() || null,
        dosingUnique: input.dosingUnique,
      })
      .returning({ id: drugs.id });
    drugId = created.id;
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Deliberately not auto-suffixed. Two drugs a slug apart is how the
      // sildenafil duplicate happened in the sheet, and the fix there was one
      // drug with two brands -- so send the editor to the existing one.
      return { ok: false, message: `A drug already exists at /drugs/${slug}.` };
    }
    throw err;
  }

  await audit({
    actorId,
    action: 'drug.create',
    drugId,
    diff: {
      slug,
      genericName: generic,
      // A value nobody typed says where it came from, or why there is not one.
      ...(found === null ? {} : {
        drugClass: found.drugClass,
        classLookup: found.path,
        matchedAs: found.matchedAs,
        rxcui: found.rxcui,
      }),
    },
  });

  const brands = unique(lines(input.brands));
  if (brands.length > 0) {
    await db.insert(drugBrands).values(brands.map((name, sortOrder) => ({
      drugId, name, family: brandFamily(name), sortOrder,
    })));
  }

  await setDrugIndicationLinks(drugId, lines(input.indications));

  const dosing = input.dosing.trim();
  if (dosing) {
    await db.update(drugs).set({
      fields: {
        dosing: {
          value: dosing, status: 'ok', source: 'added by hand',
          updatedAt: new Date().toISOString(), updatedBy: actorId,
        },
      },
    }).where(eq(drugs.id, drugId));
    await rebuildRegimens(drugId, generic, dosing, actorId, { unique: input.dosingUnique });
  }

  if (input.tagSlugs.length > 0) {
    const result = await setDrugTags(slug, input.tagSlugs, actorId);
    // The drug exists either way; a bad tag slug is not worth discarding it.
    if (!result.ok) return { ok: true, value: slug };
  }

  return { ok: true, value: slug };
}
