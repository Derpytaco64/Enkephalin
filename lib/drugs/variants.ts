/**
 * A class's or an exam's own version of a drug profile.
 *
 * **A layer, not a copy**, and that is the whole design. A class teaches
 * levothyroxine too, says mostly the same facts about it, and sources them from
 * its own slides. So a variant stores only the fields it says differently and
 * everything else falls through to `drugs.fields` -- which means a correction
 * to the base profile improves every variant's view of it, where a copy would
 * mean the same correction made twice and the second one forgotten.
 *
 * **A variant is a tag that already exists.** Membership is `drug_tags`, the
 * browse filter already groups by tag kind, and the study scope's list dropdown
 * already offers every non-system tag. So this file is the only new idea:
 * per-variant values, and the rule for reading them.
 *
 * Two kinds of tag can carry one -- `course` and `exam` -- because that
 * is how the material is addressed: *PHRM 535*, *Heme and Onc Exam 3*,
 * *Melanoma*. They stack in that order, widest first, so the narrowest scope
 * wins: an exam's wording for a drug beats the
 * course's. That is the one thing about the order worth saying out loud, and
 * `VARIANT_KINDS` is where it is said.
 *
 * Core fields are deliberately not overridable -- see `overridable` below.
 *
 * **The base belongs to somebody too, and says so.** A lecture imported into a
 * drug the app had never held writes to the drug itself, so the drug's own
 * profile is that one class's wording with nothing else under it; and the 236
 * off the class sheet are, in the same sense, Top Drugs 2026's.
 * `drugs.base_variant_tag_id` records which tag -- see `baseVariantOf`, which
 * accepts any kind of tag, a list included -- and it is an attribution rather
 * than a fourth layer: the base still holds the whole profile, and a class
 * named there is excluded from the *layers*, since one class cannot be both the
 * drug's own words and a variation on them.
 *
 * **The base is V-1**, and the layers are numbered from 2 (2026-11-12, owner's
 * call): a version pill should answer *how many versions has this drug got*,
 * and the drug's own is one of them whoever wrote it. It is still not a layer
 * and still not in `variantOptionsFor` -- it is the one version there is no
 * `?as=` for, because it is what `?as=` falls back to.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { drugVariantValues, drugTags, drugs, tags, type FieldValue } from '@/db/schema';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import { isVariantKind, KIND_RANK, VARIANT_KINDS, type VariantKind } from './variant-kinds';

export * from './variant-kinds';

export type VariantLayer = {
  tagId: string;
  slug: string;
  label: string;
  kind: VariantKind;
  fields: Record<string, FieldValue>;
  note: string | null;
  updatedAt: Date;
};

/** A variant a drug is in, and whether it says anything of its own. */
export type VariantOption = {
  tagId: string;
  slug: string;
  label: string;
  kind: VariantKind;
  /** How many fields it overrides. 0 means the drug is merely tagged with it. */
  overrides: number;
  /**
   * The `n` in V-n, or null for a class the drug is merely tagged with.
   *
   * **Counted from 2, because the drug's own profile is V-1** (2026-11-12,
   * owner's call, reversing the decision below it): *V-2 means there are two
   * versions of this drug*, which is what somebody reading a pill wants it to
   * mean. The drug's own is always one of them -- named after the lecture it
   * came from where there is one, see `baseVariantOf`, and simply the drug's
   * own words where there is not.
   *
   * Numbered the same way `numberedVariantsByDrug` numbers them -- over the
   * versions that have a stored layer, in overlay order -- because otherwise a
   * card could say *V-2 PHRM 535* and the dropdown you went to find it in
   * would call it something else. A class with no layer of its own is
   * deliberately **unnumbered** rather than numbered and skipped: it is not
   * another version of the drug, it is the drug, read in that class.
   */
  n: number | null;
};

export type Result =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Clearing a version says which memberships went with it.
 *
 * Named rather than counted, because the screen that reports it is a
 * destructive one: *2 versions deleted* and nothing else would leave whoever
 * just undid an import to go and find out for themselves which classes the
 * drug came off. See `clearVariantLayer`.
 */
export type ClearResult =
  | { ok: true; untagged: string[] }
  | { ok: false; message: string };

/** A save says how much this variant now holds of its own. */
export type SaveResult =
  | { ok: true; overrides: number }
  | { ok: false; message: string };

// `isCore`, not every entry: `CORE_FIELD_DEFS` is the whole sheet field set --
// mechanism, dosing, the black box warning -- and only five of its rows are
// backed by their own column. Reading it as "all of these are core" is a quiet
// way to make every field unoverridable, which is what it did once.
const CORE_KEYS = new Set(
  CORE_FIELD_DEFS.filter((def) => def.isCore).map((def) => def.key),
);

/**
 * Whether a field can carry a variant's own value.
 *
 * The core fields cannot, and not as an omission: `generic`, `brand`,
 * `indication`, `drug_class` and `controlled` are columns and link rows rather
 * than entries in `drugs.fields`, and a class claiming a different generic
 * name is not a variation of a drug, it is a different drug. Brands and
 * indications are entities with their own tables and their own pairing rules,
 * so a class wanting to differ on those is a bigger change than this one and
 * deliberately out of it.
 */
export function overridable(key: string): boolean {
  return !CORE_KEYS.has(key);
}

/**
 * The reading rule, and the only piece of this worth testing on its own.
 *
 * Per **key**, not per drug: an absent key is not a blank, it is *the same as
 * the drug's*. Layers apply in the order given, so the last one wins -- which is
 * `VARIANT_KINDS` order, narrowest last, written down rather than left to
 * Object.assign's accident.
 */
export function overlayFields(
  base: Record<string, FieldValue>,
  ...layers: Record<string, FieldValue>[]
): Record<string, FieldValue> {
  const merged = { ...base };

  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      // A layer may only speak about fields that can be overridden, and may
      // only speak about a key at all if it has something to say: an empty
      // value in a layer would otherwise *erase* the base value, which is not
      // what "this class does not mention it" means.
      if (!overridable(key)) continue;
      if (value.value === null && value.status !== 'none') continue;
      merged[key] = value;
    }
  }

  return merged;
}

/** Which of these keys the layer actually speaks about, for the UI's count. */
export function overriddenKeys(layer: Record<string, FieldValue>): string[] {
  return Object.keys(layer).filter(
    (key) => overridable(key)
      && (layer[key].value !== null || layer[key].status === 'none'),
  );
}

/**
 * A version of a drug as a screen has to name it: the number and whose it is.
 *
 * The same three things `CardVariant` carries, written here because the rule
 * below is shared by the study loader and the lookup panel and neither of them
 * should own it.
 */
export type FieldAuthor = { n: number; label: string; slug: string };

/**
 * Whose words each field is, once the layers have been applied.
 *
 * The companion of `overlayFields`, and deliberately written beside it: the
 * two walk the same layers in the same order, so the version a pill names is
 * always the version whose value won. They were a pair of loops in the study
 * loader until the lookup panel needed the same answer; a second copy of this
 * is a pill that lies on one screen and not on the other.
 *
 * **The drug's own fields go in first**, where a lecture is whose they are: a
 * drug that arrived with one holds that lecture's wording as its base, so
 * every field it answers is that class's until a layer speaks over the key.
 * `overriddenKeys` is the right test for the base as well as for a layer --
 * it asks which keys hold an answer, and it leaves the core fields out, which
 * are the sheet's.
 *
 * A layer with no `version` still applies its values (`overlayFields` does
 * that) but names nobody: an unnumbered class is one that has said nothing of
 * its own, and there is nothing for it to have worded.
 */
export function wordedBy(
  drugFields: Record<string, FieldValue>,
  base: { label: string; slug: string } | null | undefined,
  layers: { fields: Record<string, FieldValue>; variant: FieldAuthor | null }[],
): Record<string, FieldAuthor> {
  const authors: Record<string, FieldAuthor> = {};

  if (base) {
    for (const key of overriddenKeys(drugFields)) {
      authors[key] = { n: 1, label: base.label, slug: base.slug };
    }
  }
  for (const layer of layers) {
    if (!layer.variant) continue;
    for (const key of overriddenKeys(layer.fields)) authors[key] = layer.variant;
  }

  return authors;
}

/* ----------------------------------------------------------------- read ---- */

/** The SQL fragment for "a tag that can carry a variant". */
const isVariantTag = inArray(tags.kind, [...VARIANT_KINDS]);

/** Course, then exam; alphabetical inside a kind. */
function byOverlayOrder<T extends { kind: string; label: string }>(a: T, b: T): number {
  const rank = (KIND_RANK.get(a.kind) ?? 9) - (KIND_RANK.get(b.kind) ?? 9);
  return rank !== 0 ? rank : a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
}

/**
 * The class or exam whose words a drug's **own profile** is, or null.
 *
 * `drugs.base_variant_tag_id`, resolved to something a screen can print. The
 * base is not a layer and never becomes one: it holds the whole profile, and
 * this says whose wording that profile is -- which a lecture import into a new
 * drug makes a real question, because such a drug takes everything as its own.
 *
 * **Any tag the drug carries can be named here, not only a class or an exam**
 * (2026-11-12, owner's call: *the 236 top drugs should be V-1 Top Drugs
 * 2026*). A layer may only live on a `course` or an `exam`, because wording
 * that differs is addressed that way -- but this is not a layer, it is the
 * answer to *whose words is this profile*, and for the 236 off the class sheet
 * the honest answer is the list they came on. Null still means nobody in
 * particular, which is what a drug typed by hand is.
 *
 * **Membership is not required, and that is the one place this differs from
 * `variantLayerFor`.** A layer is refused on a drug that has left the class,
 * because applying one would be reading a version the drug has not got. This
 * applies nothing: it is provenance, the plain fact of whose slides those words
 * were typed off, and untagging the drug does not make that fact untrue. What
 * it does mean is that the pill can name a class the Tags card no longer lists,
 * which is honest -- the words are still that class's.
 */
export type BaseVariant = {
  tagId: string;
  slug: string;
  label: string;
  /**
   * The tag's kind -- any of them, not just the two a layer can live on, so
   * `top_list` appears here. Carried for a screen that wants to say *class* or
   * *exam*; nothing branches on it.
   */
  kind: string;
};

export async function baseVariantOf(drugId: string): Promise<BaseVariant | null> {
  const [row] = await db
    .select({ tagId: tags.id, slug: tags.slug, label: tags.label, kind: tags.kind })
    .from(drugs)
    .innerJoin(tags, eq(tags.id, drugs.baseVariantTagId))
    .where(eq(drugs.id, drugId));

  return row ?? null;
}

/**
 * Every drug's base attribution at once, keyed by drug id.
 *
 * One query for the whole table, for the same reason `allVariantLayers` is one:
 * the study loader reads all 236 drugs and must not ask this per drug.
 */
export async function baseVariantsByDrug(): Promise<Map<string, BaseVariant>> {
  const rows = await db
    .select({
      drugId: drugs.id,
      tagId: tags.id,
      slug: tags.slug,
      label: tags.label,
      kind: tags.kind,
    })
    .from(drugs)
    .innerJoin(tags, eq(tags.id, drugs.baseVariantTagId));

  return new Map(rows.map(({ drugId, ...base }) => [drugId, base]));
}

/**
 * Every variant this drug is tagged with, in overlay order, with its count.
 *
 * **The base's own class is not among them.** Where the drug's own profile is
 * Exam 1's wording, Exam 1 is not also a version of it: offering both would
 * put the same class in the picker twice -- once named and once as *the drug's
 * own* -- which is the confusion the attribution exists to end.
 */
export async function variantOptionsFor(drugId: string): Promise<VariantOption[]> {
  const [member, layers, base] = await Promise.all([
    db
      .select({ tagId: tags.id, slug: tags.slug, label: tags.label, kind: tags.kind })
      .from(drugTags)
      .innerJoin(tags, eq(tags.id, drugTags.tagId))
      .where(and(eq(drugTags.drugId, drugId), isVariantTag)),
    db
      .select({ tagId: drugVariantValues.tagId, fields: drugVariantValues.fields })
      .from(drugVariantValues)
      .where(eq(drugVariantValues.drugId, drugId)),
    baseVariantOf(drugId),
  ]);

  const countByTag = new Map(
    layers.map((layer) => [layer.tagId, overriddenKeys(layer.fields).length]),
  );

  // Sorted before numbering, and numbered only across the ones with a stored
  // layer -- the same two rules `numberedVariantsByDrug` follows, so V-2 means
  // one thing in this app.
  const sorted = member
    .filter((variant) => variant.tagId !== base?.tagId)
    .map((variant) => ({
      ...variant,
      kind: variant.kind as VariantKind,
      overrides: countByTag.get(variant.tagId) ?? 0,
    }))
    .sort(byOverlayOrder);

  // From 2: V-1 is the drug's own profile, which is a version of it whoever
  // wrote it -- the pill for it is the picker's first, and it is not in this
  // list because it is not reached by `?as=`.
  let next = 2;
  return sorted.map((variant) => ({
    ...variant,
    n: countByTag.has(variant.tagId) ? next++ : null,
  }));
}

/**
 * Every stored layer for one drug, keyed by variant slug.
 *
 * For the side-by-side table, which is the one reader that wants all of them
 * at once -- `allVariantLayers` is shaped for a study session, which asks by
 * slug across every drug.
 */
export async function variantLayersForDrug(
  drugId: string,
): Promise<Map<string, Record<string, FieldValue>>> {
  const rows = await db
    .select({ slug: tags.slug, fields: drugVariantValues.fields })
    .from(drugVariantValues)
    .innerJoin(tags, eq(tags.id, drugVariantValues.tagId))
    .innerJoin(drugTags, and(
      eq(drugTags.drugId, drugVariantValues.drugId),
      eq(drugTags.tagId, drugVariantValues.tagId),
    ))
    .where(and(eq(drugVariantValues.drugId, drugId), isVariantTag));

  return new Map(rows.map((row) => [row.slug, row.fields]));
}

/**
 * One variant's layer for one drug, or null.
 *
 * Returns null for a tag the drug does not carry as well as for one that has
 * nothing stored: a layer on a drug that has since left the class is not a
 * profile anybody asked to see, and quietly showing it would make the picker on
 * the profile disagree with the tag filter in the browser.
 *
 * **And null for the class the base profile already belongs to.** Reading the
 * drug *as Exam 1* where the drug's own words are Exam 1's is reading the drug,
 * so `?as=exam-1` falls through to its own profile rather than answering with
 * an empty layer -- and the edit screen for one 404s, because there is nothing
 * for that class to say differently from itself.
 */
export async function variantLayerFor(
  drugId: string,
  variantSlug: string,
): Promise<VariantLayer | null> {
  const [variant] = await db
    .select({
      tagId: tags.id,
      slug: tags.slug,
      label: tags.label,
      kind: tags.kind,
      baseTagId: drugs.baseVariantTagId,
    })
    .from(drugTags)
    .innerJoin(tags, eq(tags.id, drugTags.tagId))
    .innerJoin(drugs, eq(drugs.id, drugTags.drugId))
    .where(and(
      eq(drugTags.drugId, drugId),
      eq(tags.slug, variantSlug),
      isVariantTag,
    ));

  if (!variant) return null;
  if (variant.baseTagId === variant.tagId) return null;

  const [stored] = await db
    .select()
    .from(drugVariantValues)
    .where(and(eq(drugVariantValues.drugId, drugId), eq(drugVariantValues.tagId, variant.tagId)));

  return {
    tagId: variant.tagId,
    slug: variant.slug,
    label: variant.label,
    kind: variant.kind as VariantKind,
    fields: stored?.fields ?? {},
    note: stored?.note ?? null,
    updatedAt: stored?.updatedAt ?? new Date(0),
  };
}

/**
 * Every variant layer for every drug, keyed `drugId` then tag slug.
 *
 * One query for the whole table, because the caller is the study loader: it
 * reads all 236 drugs at once, and 236 round trips to decide whose mechanism
 * came from which slide deck would be the one slow thing in a session.
 */
export async function allVariantLayers(
  variantSlugs: string[],
): Promise<Map<string, Map<string, Record<string, FieldValue>>>> {
  const wanted = variantSlugs.filter(Boolean);
  if (wanted.length === 0) return new Map();

  const rows = await db
    .select({
      drugId: drugVariantValues.drugId,
      slug: tags.slug,
      fields: drugVariantValues.fields,
    })
    .from(drugVariantValues)
    .innerJoin(tags, eq(tags.id, drugVariantValues.tagId))
    // Still in the class. A layer outlives the membership that created it --
    // untagging a drug does not delete what the class recorded, deliberately,
    // because that work is expensive and the untagging may be a mistake. But
    // an outlived layer must not go on being *applied*: `variantLayerFor`
    // already refuses to serve one, and a study session that kept teaching a
    // class's wording for a drug no longer in that class would be the same bug
    // with no screen to notice it on.
    .innerJoin(drugTags, and(
      eq(drugTags.drugId, drugVariantValues.drugId),
      eq(drugTags.tagId, drugVariantValues.tagId),
    ))
    .where(and(isVariantTag, inArray(tags.slug, wanted)));

  const byDrug = new Map<string, Map<string, Record<string, FieldValue>>>();
  for (const row of rows) {
    const held = byDrug.get(row.drugId) ?? new Map();
    byDrug.set(row.drugId, held);
    held.set(row.slug, row.fields);
  }

  return byDrug;
}

/**
 * Which of these tag slugs can carry a variant, **in overlay order**.
 *
 * The order is the point of the function. A session scoped to both a class and
 * one of its exams reads them in that order, so the exam's wording wins -- and
 * it wins for the same reason on every screen, because every caller asks this.
 */
export async function variantSlugsAmong(slugs: string[]): Promise<string[]> {
  const wanted = slugs.filter(Boolean);
  if (wanted.length === 0) return [];

  const rows = await db
    .select({ slug: tags.slug, label: tags.label, kind: tags.kind })
    .from(tags)
    .where(and(isVariantTag, inArray(tags.slug, wanted)));

  return rows.sort(byOverlayOrder).map((row) => row.slug);
}

/**
 * Every drug's variants that actually say something, numbered **V-1, V-2** in
 * overlay order.
 *
 * The number is an identifier a person can use. A drug's versions have no
 * names of their own -- they are named after the classes that wrote them, and
 * *amoxicillin as Infectious Disease words it* does not fit on a row -- so the
 * browse list shows the count as `V-3` and the list builder offers
 * *amoxicillin [V-2] Infectious Disease*. Same set, same order, so V-2 means
 * the same thing in both places.
 *
 * Only variants with stored values are counted, which is why this reads the
 * layer table rather than membership: a class that says nothing of its own is
 * not another version of the drug, and offering it would be offering a choice
 * that changes nothing.
 */
export type NumberedVariant = {
  slug: string;
  label: string;
  kind: VariantKind;
  /** 1-based, in overlay order: the `n` in V-n. */
  n: number;
  /** How many fields this version words its own way. */
  overrides: number;
};

export async function numberedVariantsByDrug(): Promise<Map<string, NumberedVariant[]>> {
  const rows = await db
    .select({
      drugId: drugVariantValues.drugId,
      slug: tags.slug,
      label: tags.label,
      kind: tags.kind,
      fields: drugVariantValues.fields,
    })
    .from(drugVariantValues)
    .innerJoin(tags, eq(tags.id, drugVariantValues.tagId))
    // Membership, same as every other reader: a V-n the profile's dropdown
    // cannot offer is a number pointing at nothing.
    .innerJoin(drugTags, and(
      eq(drugTags.drugId, drugVariantValues.drugId),
      eq(drugTags.tagId, drugVariantValues.tagId),
    ))
    .where(isVariantTag);

  const byDrug = new Map<string, NumberedVariant[]>();
  for (const row of rows) {
    const list = byDrug.get(row.drugId) ?? [];
    list.push({
      slug: row.slug,
      label: row.label,
      kind: row.kind as VariantKind,
      n: 0,
      overrides: overriddenKeys(row.fields).length,
    });
    byDrug.set(row.drugId, list);
  }

  // Numbered after sorting, never before: V-2 is "the second of this drug's
  // versions in overlay order", so it has to survive a new class being added
  // above it -- which it does, by being recomputed rather than stored.
  //
  // `+ 2`, not `+ 1`: the drug's own profile is V-1 on every screen, so the
  // first class with wording of its own is the second version there is.
  for (const list of byDrug.values()) {
    list.sort(byOverlayOrder);
    list.forEach((variant, at) => { variant.n = at + 2; });
  }

  return byDrug;
}

/**
 * The version each drug is **on a list as**, for the lists in scope.
 *
 * A list can name which wording it means -- see `drug_tags.variant_tag_id` --
 * and this is how a study session honours it. Returned per drug rather than as
 * one list of slugs, because the whole point is that it differs by drug: a
 * top-200 list might hold amoxicillin as the ID class words it and warfarin as
 * the drug's own.
 *
 * Only the tags actually in scope are read, so a choice recorded on a list you
 * are not studying has no effect on anything.
 */
export async function membershipVariants(tagSlugs: string[]): Promise<Map<string, string[]>> {
  const wanted = tagSlugs.filter(Boolean);
  if (wanted.length === 0) return new Map();

  const listTag = alias(tags, 'list_tag');
  const variantTag = alias(tags, 'variant_tag');

  const rows = await db
    .select({
      drugId: drugTags.drugId,
      list: listTag.slug,
      slug: variantTag.slug,
      label: variantTag.label,
      kind: variantTag.kind,
    })
    .from(drugTags)
    .innerJoin(listTag, eq(listTag.id, drugTags.tagId))
    .innerJoin(variantTag, eq(variantTag.id, drugTags.variantTagId))
    .where(and(inArray(listTag.slug, wanted), inArray(variantTag.kind, [...VARIANT_KINDS])));

  const byDrug = new Map<string, string[]>();
  for (const row of rows.sort(byOverlayOrder)) {
    const list = byDrug.get(row.drugId) ?? [];
    // Deduplicated: two lists in scope can name the same version, and applying
    // a layer twice is the same as applying it once but reads as a bug.
    if (!list.includes(row.slug)) list.push(row.slug);
    byDrug.set(row.drugId, list);
  }

  return byDrug;
}

/* ---------------------------------------------------------------- write ---- */

/**
 * Point a drug's other memberships at the version one of them wrote.
 *
 * **A variant carries tags; a tag is not a variant.** A lecture arrives scoped
 * to a class *and* an exam, and the one layer it writes lands on the narrowest
 * of them. Without this, that import leaves two different answers to *what does
 * this class teach*: study Heme/Onc Exam 3 and you read the lecture's wording,
 * study PHRM 535 -- the same lecture -- and you read the drug's own.
 *
 * `drug_tags.variant_tag_id` is the column for exactly this, and it reads as the
 * sentence it is: *on this list, read the drug as that class words it*. So the
 * file's scope becomes the variant's tags, which is the other half of a tag no
 * longer constituting a version by itself.
 *
 * **Only where nothing is pointed yet.** A pointer set by hand on the tag screen
 * is a curation decision about how one list reads, and re-running a lecture must
 * not quietly undo it. Returns how many memberships it set, so the import can
 * report a number rather than imply one.
 */
export async function pointTagsAtVariant(input: {
  drugId: string;
  variantSlug: string;
  tagSlugs: string[];
}): Promise<number> {
  // The variant's own membership is skipped rather than pointed at itself: the
  // scope path already finds that layer directly, and "read Heme/Onc Exam 3 as
  // Heme/Onc Exam 3 words it" is a true sentence that says nothing.
  const others = [...new Set(input.tagSlugs)].filter((slug) => slug !== input.variantSlug);
  if (others.length === 0) return 0;

  // The version has to exist before a list can be told to read it. Checked here
  // rather than by the caller so that calling this is always safe, which is
  // what lets an import call it for every drug it touched -- including the ones
  // whose layer it wrote on an earlier run and left untouched on this one. A
  // second import of the same lecture writes no values and must still converge
  // on the same pointers.
  const [variant] = await db
    .select({ id: tags.id })
    .from(drugVariantValues)
    .innerJoin(tags, eq(tags.id, drugVariantValues.tagId))
    .where(and(
      eq(drugVariantValues.drugId, input.drugId),
      eq(tags.slug, input.variantSlug),
      isVariantTag,
    ));
  if (!variant) return 0;

  const rows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.slug, others));
  if (rows.length === 0) return 0;

  const pointed = await db
    .update(drugTags)
    .set({ variantTagId: variant.id })
    .where(and(
      eq(drugTags.drugId, input.drugId),
      inArray(drugTags.tagId, rows.map((row) => row.id)),
      isNull(drugTags.variantTagId),
    ))
    .returning({ tagId: drugTags.tagId });

  return pointed.length;
}

/**
 * Writes one variant's whole layer for one drug.
 *
 * The whole layer rather than one field at a time, because the screen is one
 * form over every field: you read down the class's slides once and type what
 * it says differently. **An empty box clears the override** rather than storing
 * a blank -- it means *this variant says what the drug says*, which is the only
 * reading that makes the fall-through work.
 *
 * A value whose text has not changed keeps its old envelope, so `updatedAt`
 * goes on meaning *when this changed* rather than *when the form was last
 * submitted*.
 */
export async function saveVariantLayer(input: {
  drugSlug: string;
  variantSlug: string;
  /** Field key to the text this variant gives it. Empty text clears it. */
  values: Record<string, string>;
  /** Where this variant's version comes from. Defaults to the tag's label. */
  source: string;
  note: string;
  userId: string;
}): Promise<SaveResult> {
  const [drug] = await db
    .select({ id: drugs.id })
    .from(drugs)
    .where(eq(drugs.slug, input.drugSlug));
  if (!drug) return { ok: false, message: 'That drug no longer exists.' };

  const [variant] = await db
    .select({ tagId: tags.id, label: tags.label, baseTagId: drugs.baseVariantTagId })
    .from(drugTags)
    .innerJoin(tags, eq(tags.id, drugTags.tagId))
    .innerJoin(drugs, eq(drugs.id, drugTags.drugId))
    .where(and(
      eq(drugTags.drugId, drug.id),
      eq(tags.slug, input.variantSlug),
      isVariantTag,
    ));

  // Not tagged with it, or the tag is not one that can carry a variant. One
  // message, because both mean the same thing to whoever is looking at the
  // screen: this drug has no such version to differ in.
  if (!variant) {
    return {
      ok: false,
      message: `This drug is not in a class or exam called "${input.variantSlug}". `
        + 'Tag it first, in the drug editor.',
    };
  }

  // The class the drug's own profile already belongs to cannot also hold a
  // layer over it: the base is that class's whole wording, so a layer would be
  // the same class differing from itself, and the profile would offer it twice.
  // Edit the drug itself instead -- which is what editing that class's words
  // now means.
  if (variant.baseTagId === variant.tagId) {
    return {
      ok: false,
      message: `${variant.label} is where this drug's own profile came from, so its wording is `
        + 'the drug\'s. Edit the drug itself to change it.',
    };
  }

  const [stored] = await db
    .select()
    .from(drugVariantValues)
    .where(and(eq(drugVariantValues.drugId, drug.id), eq(drugVariantValues.tagId, variant.tagId)));

  const held = stored?.fields ?? {};
  const source = input.source.trim() || variant.label;
  const note = input.note.trim() || null;
  const now = new Date().toISOString();

  const fields: Record<string, FieldValue> = {};
  const refused: string[] = [];

  for (const [key, raw] of Object.entries(input.values)) {
    if (!overridable(key)) {
      refused.push(key);
      continue;
    }
    const text = raw.trim();
    if (text === '') continue;

    const before = held[key];
    fields[key] = before && before.value === text && before.source === source
      ? before
      : { value: text, status: 'ok', source, updatedAt: now, updatedBy: input.userId };
  }

  // A core field in the payload is a bug in the form rather than a typo in a
  // box, so it refuses the save instead of quietly dropping one field.
  if (refused.length > 0) {
    return {
      ok: false,
      message: `${refused.join(', ')} ${refused.length === 1 ? 'is a core field' : 'are core fields'}`
        + ' — they live in their own columns, and a class saying something different about one'
        + ' would be a different drug rather than a variation. Nothing was saved.',
    };
  }

  const count = Object.keys(fields).length;

  // Nothing of its own and nothing to say about why: the row goes, so the
  // picker stops offering a version that holds nothing.
  if (count === 0 && note === null) {
    if (stored) {
      await db
        .delete(drugVariantValues)
        .where(and(
          eq(drugVariantValues.drugId, drug.id),
          eq(drugVariantValues.tagId, variant.tagId),
        ));
    }
    return { ok: true, overrides: 0 };
  }

  if (stored) {
    await db
      .update(drugVariantValues)
      .set({ fields, note, updatedAt: new Date(), updatedBy: input.userId })
      .where(and(eq(drugVariantValues.drugId, drug.id), eq(drugVariantValues.tagId, variant.tagId)));
  } else {
    await db.insert(drugVariantValues).values({
      drugId: drug.id,
      tagId: variant.tagId,
      fields,
      note,
      updatedBy: input.userId,
    });
  }

  return { ok: true, overrides: count };
}

/**
 * Records whose words a drug's **own profile** is -- or clears it.
 *
 * The other half of `baseVariantOf`. Two ways in: a lecture import that creates
 * a drug sets it as it goes, since the import is the thing that knows, and this
 * screen-side writer is for the hundreds of drugs imported before the column
 * existed and for fixing a wrong one.
 *
 * Two refusals, both of them the same sentence from a different angle --
 * *that tag is not in a position to be this drug's own words*:
 *
 * - a tag the drug is not on. Any **kind** of tag will do, the sheet's own
 *   list included -- see `BaseVariant` -- because this is provenance rather
 *   than a layer;
 * - a class that already holds a layer, which would make it the drug's own
 *   words *and* a variation on them.
 *
 * Clearing is always allowed: it says *nobody in particular*, which is what a
 * drug somebody typed by hand is.
 */
export async function setBaseVariant(input: {
  drugSlug: string;
  /** The class or exam the profile came from, or null for nobody in particular. */
  variantSlug: string | null;
}): Promise<Result> {
  const [drug] = await db
    .select({ id: drugs.id })
    .from(drugs)
    .where(eq(drugs.slug, input.drugSlug));
  if (!drug) return { ok: false, message: 'That drug no longer exists.' };

  if (input.variantSlug === null) {
    await db.update(drugs).set({ baseVariantTagId: null }).where(eq(drugs.id, drug.id));
    return { ok: true };
  }

  const [variant] = await db
    .select({ tagId: tags.id, label: tags.label })
    .from(drugTags)
    .innerJoin(tags, eq(tags.id, drugTags.tagId))
    .where(and(
      eq(drugTags.drugId, drug.id),
      eq(tags.slug, input.variantSlug),
    ));

  if (!variant) {
    return {
      ok: false,
      message: `This drug is not on a list, class or exam called "${input.variantSlug}". `
        + 'Tag it first, in the drug editor.',
    };
  }

  const [layer] = await db
    .select({ fields: drugVariantValues.fields })
    .from(drugVariantValues)
    .where(and(
      eq(drugVariantValues.drugId, drug.id),
      eq(drugVariantValues.tagId, variant.tagId),
    ));

  if (layer && overriddenKeys(layer.fields).length > 0) {
    return {
      ok: false,
      message: `${variant.label} already words ${overriddenKeys(layer.fields).length} field`
        + `${overriddenKeys(layer.fields).length === 1 ? '' : 's'} its own way, so it is a version `
        + 'of this drug rather than where the drug itself came from. Clear its wording first if '
        + 'the two have been mixed up.',
    };
  }

  await db
    .update(drugs)
    .set({ baseVariantTagId: variant.tagId })
    .where(eq(drugs.id, drug.id));

  return { ok: true };
}

/** One of a drug's memberships, as the scope rule needs to see it. */
export type ScopeMembership = {
  tagId: string;
  /** The tag's kind, so a list can be told from a class. */
  kind: string;
  /** `drug_tags.variant_tag_id`: the version this membership reads, if any. */
  readsVariant: string | null;
};

/**
 * What deleting one version would take off the drug, and what it would only
 * stop pointing at it.
 *
 * `clearVariantLayer` asks this in SQL and is the thing that acts on it. This
 * is the same rule as a pure function, so that a **screen can show it before
 * the button is pressed** -- which is the half that was missing: the deletion
 * panel listed a drug's tags in one row above its versions, so *which class
 * goes out with which version* was a question the only way to answer was to
 * press delete and read the report afterwards.
 *
 * The two of them must agree, and `tests/remove-drugs.test.ts` runs them
 * against the same fixture and compares, because a rule stated twice is a rule
 * that drifts.
 */
export function variantScope(
  variantTagId: string,
  members: readonly ScopeMembership[],
  /** The tags this drug has wording of its own under. */
  layerTagIds: ReadonlySet<string>,
): { takes: string[]; keeps: string[] } {
  const takes: string[] = [];
  const keeps: string[] = [];

  for (const member of members) {
    // Its own membership: the version is that tag, so deleting the version is
    // deleting the drug's place in it.
    if (member.tagId === variantTagId) {
      takes.push(member.tagId);
      continue;
    }
    if (member.readsVariant !== variantTagId) continue;

    // Pointed at this version and with nothing of its own to say: the rest of
    // the lecture's scope, which arrived with it and goes with it. A list, or a
    // class that words the drug itself, keeps its place and loses the pointer.
    if (isVariantKind(member.kind) && !layerTagIds.has(member.tagId)) takes.push(member.tagId);
    else keeps.push(member.tagId);
  }

  return { takes, keeps };
}

/**
 * The version goes, and the scope it arrived with goes too.
 *
 * This is the undo for an import, and its only caller is `/admin/remove`.
 * What an import writes is a *version and its scope together* -- the lecture's
 * class and exam are tagged onto the drug, the layer lands on the narrowest of
 * them, and the others are pointed at it by `pointTagsAtVariant` -- so undoing
 * one has to take the same three things back out. Dropping only the wording
 * left the tags behind, and a tag with nothing left to read is read as the
 * drug's own: a lecture deleted off cefuroxime still showed *PHRM 535* and
 * *Heme/Onc Exam 3* on its profile, now claiming the drug's own words say what
 * that class teaches. Nobody tagged it; an import did, and the import is what
 * was being undone.
 *
 * **A list keeps its place.** A membership of any other kind -- `top_list`,
 * `school_year`, `custom` -- is a curation decision that outlives any one
 * lecture, so Top Drugs 2026 stays exactly as it was and only its pointer is
 * nulled. Same split as `pointTagsAtVariant`, which will point a list at a
 * version and never put a drug on one.
 *
 * **And a class that words this drug itself keeps its place too**, pointer
 * nulled, because then it is a version in its own right rather than another
 * name for the one being deleted -- and dropping its membership would leave its
 * layer stored and unreachable, since `variantOptionsFor` only offers a layer
 * the drug is still tagged with.
 *
 * A pointer left dangling would be the kind of stale that looks like nothing:
 * the list goes on claiming a reading, every reader quietly falls back to the
 * drug's own words, and the profile reports a version the drug has not got.
 * Hence the null for the rows that stay -- the same reasoning migration 0016
 * gives for `on delete set null` when the tag itself is deleted.
 */
export async function clearVariantLayer(input: {
  drugSlug: string;
  variantSlug: string;
}): Promise<ClearResult> {
  const [drug] = await db
    .select({ id: drugs.id })
    .from(drugs)
    .where(eq(drugs.slug, input.drugSlug));
  if (!drug) return { ok: false, message: 'That drug no longer exists.' };

  const [variant] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.slug, input.variantSlug), isVariantTag));
  if (!variant) {
    return { ok: false, message: `No class or exam called "${input.variantSlug}".` };
  }

  await db
    .delete(drugVariantValues)
    .where(and(eq(drugVariantValues.drugId, drug.id), eq(drugVariantValues.tagId, variant.id)));

  // The rest of this version's scope: a class or an exam that was reading it
  // and says nothing of its own. The left join is the "nothing of its own"
  // half -- a layer for *that* tag, which this delete has not touched.
  const scope = await db
    .select({ tagId: drugTags.tagId, slug: tags.slug })
    .from(drugTags)
    .innerJoin(tags, eq(tags.id, drugTags.tagId))
    .leftJoin(drugVariantValues, and(
      eq(drugVariantValues.drugId, drugTags.drugId),
      eq(drugVariantValues.tagId, drugTags.tagId),
    ))
    .where(and(
      eq(drugTags.drugId, drug.id),
      eq(drugTags.variantTagId, variant.id),
      isVariantTag,
      isNull(drugVariantValues.tagId),
    ));

  const slugOf = new Map([
    [variant.id, input.variantSlug],
    ...scope.map((row) => [row.tagId, row.slug] as const),
  ]);

  const dropped = await db
    .delete(drugTags)
    .where(and(
      eq(drugTags.drugId, drug.id),
      inArray(drugTags.tagId, [...slugOf.keys()]),
    ))
    .returning({ tagId: drugTags.tagId });

  // Whatever still points at the version -- the lists, and any class with
  // wording of its own -- reads the drug's own words from here.
  await db
    .update(drugTags)
    .set({ variantTagId: null })
    .where(and(eq(drugTags.drugId, drug.id), eq(drugTags.variantTagId, variant.id)));

  return {
    ok: true,
    untagged: dropped
      .map((row) => slugOf.get(row.tagId))
      .filter((slug): slug is string => slug !== undefined)
      .sort(),
  };
}

/**
 * Merges a few fields into a variant's layer, leaving the rest alone.
 *
 * The form above writes the **whole** layer, because it shows every field at
 * once and a box left empty there means *clear it*. An import is the opposite
 * shape: one lecture speaks about three fields and says nothing at all about
 * the others, so the same call would silently wipe whatever another lecture
 * had put there. Hence two writers, and the difference between them is exactly
 * the difference between a form and a patch.
 *
 * Core keys are refused the same way, and for the same reason.
 */
export async function patchVariantLayer(input: {
  drugId: string;
  variantSlug: string;
  /** Only the keys this caller means to set. Absent keys are left as they are. */
  values: Record<string, FieldValue>;
  /** Replaces the layer's note when given. */
  note?: string | null;
  userId: string;
}): Promise<SaveResult> {
  const [variant] = await db
    .select({ tagId: tags.id, label: tags.label, baseTagId: drugs.baseVariantTagId })
    .from(drugTags)
    .innerJoin(tags, eq(tags.id, drugTags.tagId))
    .innerJoin(drugs, eq(drugs.id, drugTags.drugId))
    .where(and(
      eq(drugTags.drugId, input.drugId),
      eq(tags.slug, input.variantSlug),
      isVariantTag,
    ));

  if (!variant) {
    return {
      ok: false,
      message: `This drug is not in a class or exam called "${input.variantSlug}".`,
    };
  }

  // The class the drug's own profile came from, same as `saveVariantLayer`:
  // a layer there would be the class differing from itself, and `variantLayerFor`
  // would refuse to read it -- a row stored where nothing can ever see it. The
  // planner sends those writes to the drug instead, so reaching this is a bug
  // in a caller rather than something a file can ask for.
  if (variant.baseTagId === variant.tagId) {
    return {
      ok: false,
      message: `${variant.label} is where this drug's own profile came from, so it has nothing `
        + 'to differ from. Write the drug itself.',
    };
  }

  const refused = Object.keys(input.values).filter((key) => !overridable(key));
  if (refused.length > 0) {
    return {
      ok: false,
      message: `${refused.join(', ')} cannot be overridden: core fields live in their own columns.`,
    };
  }

  const [stored] = await db
    .select()
    .from(drugVariantValues)
    .where(and(
      eq(drugVariantValues.drugId, input.drugId),
      eq(drugVariantValues.tagId, variant.tagId),
    ));

  const fields = { ...(stored?.fields ?? {}), ...input.values };
  const note = input.note === undefined ? stored?.note ?? null : input.note;

  if (stored) {
    await db
      .update(drugVariantValues)
      .set({ fields, note, updatedAt: new Date(), updatedBy: input.userId })
      .where(and(
        eq(drugVariantValues.drugId, input.drugId),
        eq(drugVariantValues.tagId, variant.tagId),
      ));
  } else {
    await db.insert(drugVariantValues).values({
      drugId: input.drugId,
      tagId: variant.tagId,
      fields,
      note,
      updatedBy: input.userId,
    });
  }

  return { ok: true, overrides: overriddenKeys(fields).length };
}
