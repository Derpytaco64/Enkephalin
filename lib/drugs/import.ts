/**
 * Importing what a lecture says about drugs.
 *
 * The format and its refusals are `lib/drugs/import-format.ts`, and the guide
 * an author is handed is `docs/drug-import.md`. This file is the half that
 * needs the database: *does this drug exist, does this field key exist, what
 * would change* -- and then the writing.
 *
 * **Two passes, and the first one writes nothing.** `planDrugImport` reports
 * what would happen, field by field, including what each value would replace;
 * `applyDrugImport` does it. A paste of eleven drugs lands in a profile a
 * person has been curating, and "show me first" is the only honest way to
 * offer that.
 *
 * **Everything is written through the editor's own writers** -- `createDrug`,
 * `setDrugField`, `setDrugTags`, `patchVariantLayer` -- so an import is a stack
 * of ordinary edits with an audit row each, with the same validation and the
 * same provenance, rather than a second way into the database.
 *
 * **Nothing is overwritten by default.** A field the drug has no value for is
 * filled; a field whose value differs becomes *what this class says* in a
 * variant layer. That is the `fill` mode, and it is what makes importing a
 * lecture safe on a profile the sheet already seeded.
 */
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  drugBrands, drugIndications, drugTags, drugVariantValues, drugs, indications, tags,
  type FieldValue,
} from '@/db/schema';
import { createFieldDef } from '@/lib/fields/mutations';
import { listFieldDefs, type FieldDef } from '@/lib/fields/registry';
import { createTag, tagSlug } from '@/lib/tags/mutations';
import {
  createDrug, drugSlug, setDrugBrands, setDrugField, setDrugIndications, setDrugTags,
} from './mutations';
import { patchVariantLayer, pointTagsAtVariant } from './variants';
import {
  likeliestField, noteOf, provenanceOf, regimenFieldFor, TARGET_DRUG, TARGET_UNDECIDED,
  type ImportDrug, type ImportFile, type ImportProblem,
} from './import-format';

/* ----------------------------------------------------------------- plan ---- */

/** Where one field value would go, and what it would replace. */
export type PlannedWrite = {
  key: string;
  label: string;
  /**
   * `unchanged` is a value the drug already holds, word for word.
   *
   * `held` is the one that writes nothing on purpose: this version already
   * says something else here, put there by a different lecture. See
   * `heldBy` -- and `planDrugImport`, where the decision is made.
   */
  to: 'drug' | 'variant' | 'held' | 'unchanged';
  /**
   * What would be replaced, for the one question a preview has to answer. The
   * drug's own value, except on a `held` write, where it is the version's --
   * because that is the wording at stake.
   */
  from: string | null;
  /** Where the version's wording came from, on a `held` write. */
  heldBy?: string | null;
  value: string | null;
  status: FieldValue['status'];
};

export type PlannedDrug = {
  generic: string;
  slug: string;
  exists: boolean;
  /** Identity the import would fill in, where the drug has none. */
  identity: { drugClass: string | null; schedule: string | null };
  brands: { adding: string[]; already: string[] };
  indications: { adding: string[]; already: string[] };
  /** Scope tags the drug is not on yet. */
  tags: string[];
  /** Every tag it already carries, so an update can write the union. */
  heldTags: string[];
  writes: PlannedWrite[];
};

export type ImportPlan = {
  scope: { kind: string; label: string; slug: string; exists: boolean }[];
  /** The line every value will carry: *PHRM 535 — 16.Melanoma.pdf*. */
  provenance: string;
  /**
   * The version this import writes to: the narrowest scope, or whichever one
   * the screen named instead.
   */
  variant: { slug: string; label: string } | null;
  /**
   * True when *Correct the drug itself* is aimed at a version rather than the
   * drug -- so the preview can say whose wording is being overwritten, and the
   * planner can leave the drug's own profile and its identity alone.
   */
  correcting: boolean;
  /**
   * True when *Correct the drug itself* is about to overwrite something and
   * nobody has said which wording is wrong. The screen turns *Import it* off
   * and `applyDrugImport` refuses; the preview is still built, from the
   * drug's own profile, so there is something to decide with.
   */
  undecidedTarget: boolean;
  /**
   * The fields this file asks for, and whether each already exists.
   *
   * `suggest` is the existing field whose name looks like this one, where there
   * is one -- *Adverse effects* for a declared `ae`. A suggestion rather than a
   * decision: the screen defaults the dropdown to it and the person importing
   * says yes or picks something else. Guessing silently is how `toxicity`
   * becomes somebody's adverse-effects field without them noticing.
   */
  declare: { key: string; label: string; exists: boolean; suggest: string | null }[];
  /** Every field a declared one can be sent to instead, for that dropdown. */
  assignable: { key: string; label: string; group: string | null }[];
  drugs: PlannedDrug[];
  regimens: { name: string; members: string[] }[];
  /** Refusals found against the database. Nothing is written while any remain. */
  problems: ImportProblem[];
  /**
   * Things to tidy that do not stop the import, named the way a refusal is.
   *
   * A different thing from `issues`, which is the file's own list of what its
   * author could not resolve. These are what the app noticed about the file,
   * and the distinction worth keeping is that a warning is about *form*: the
   * value is importable, readable and correct, and will read better rewritten.
   * Refusing would be wrong -- a lecture is not worth blocking over a
   * semicolon -- and saying nothing would be worse, because nobody rereads a
   * field once it is stored.
   */
  warnings: ImportProblem[];
  /** The file's own unresolved notes, for a person to read. */
  issues: string[];
};

const lower = (text: string) => text.trim().toLowerCase();


/** Whether a stored envelope amounts to an answer, blank or not. */
function holdsAnAnswer(value: FieldValue | undefined): boolean {
  if (!value) return false;
  return value.value !== null || value.status === 'none';
}

type KnownDrug = {
  id: string;
  slug: string;
  generic: string;
  drugClass: string | null;
  schedule: string | null;
  fields: Record<string, FieldValue>;
};

type Known = {
  defs: FieldDef[];
  /** Every field key the database has, soft-deleted ones included. */
  keys: Map<string, FieldDef>;
  byName: Map<string, KnownDrug>;
  /**
   * The same drugs again, keyed by what their names reduce to: `drugSlug` of
   * every generic and brand name, plus each drug's own stored slug.
   *
   * The second chance a combination product needs. `Amoxicillin/ Clavulanate`
   * and `Amoxicillin/clavulanate` are different strings and the same address,
   * and before this index the second one matched nothing, was treated as a new
   * drug, and was refused for asking to live where the first one already did.
   *
   * Safe to match on because the app cannot hold two drugs at one address: the
   * slug column is unique. So a name whose address is taken is a name for the
   * drug that holds it -- there is no second candidate it could mean.
   */
  bySlug: Map<string, KnownDrug>;
  brandsByDrug: Map<string, string[]>;
  indicationsByDrug: Map<string, string[]>;
  tagsByDrug: Map<string, string[]>;
  tagSlugs: Map<string, string>;
};

/**
 * One read of everything an import has to compare itself against.
 *
 * Drugs are indexed by generic name *and* by brand name, both lower-cased,
 * because a deck that says "Opdivo" and a database that says "nivolumab" are
 * talking about the same drug -- and creating a second one would be the worst
 * thing an import could do.
 */
async function readKnown(): Promise<Known> {
  const [defs, drugRows, brandRows, indicationRows, tagRows, tagLinks] = await Promise.all([
    listFieldDefs({ includeDeleted: true }),
    db.select().from(drugs).orderBy(asc(drugs.genericName)),
    db.select({ drugId: drugBrands.drugId, name: drugBrands.name }).from(drugBrands),
    db
      .select({ drugId: drugIndications.drugId, label: indications.label })
      .from(drugIndications)
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId)),
    db.select({ id: tags.id, slug: tags.slug }).from(tags),
    db.select({ drugId: drugTags.drugId, slug: tags.slug })
      .from(drugTags).innerJoin(tags, eq(tags.id, drugTags.tagId)),
  ]);

  const byName = new Map<string, KnownDrug>();
  const bySlug = new Map<string, KnownDrug>();
  for (const drug of drugRows) {
    const entry: KnownDrug = {
      id: drug.id,
      slug: drug.slug,
      generic: drug.genericName,
      drugClass: drug.drugClass,
      schedule: drug.schedule,
      fields: drug.fields,
    };
    byName.set(lower(drug.genericName), entry);
    // Its own address last and unconditionally, because that one is unique and
    // therefore unambiguously this drug's. What the generic name reduces to is
    // usually the same string and is not guaranteed to be -- a drug can be
    // renamed, and the seed sets both -- so it goes in first and gives way.
    if (!bySlug.has(drugSlug(drug.genericName))) {
      bySlug.set(drugSlug(drug.genericName), entry);
    }
    bySlug.set(drug.slug, entry);
  }

  const brandsByDrug = new Map<string, string[]>();
  for (const brand of brandRows) {
    const list = brandsByDrug.get(brand.drugId);
    if (list) list.push(brand.name);
    else brandsByDrug.set(brand.drugId, [brand.name]);
    // A brand name points at its drug too, so "Opdivo" matches nivolumab.
    const holder = drugRows.find((drug) => drug.id === brand.drugId);
    if (holder && !byName.has(lower(brand.name))) {
      byName.set(lower(brand.name), byName.get(lower(holder.genericName))!);
    }
    // By address as well, but never over a generic name or a drug's own slug:
    // a brand is the weakest claim on a name, and "Augmentin XR" reducing onto
    // something else's address must not move it.
    if (holder && !bySlug.has(drugSlug(brand.name))) {
      bySlug.set(drugSlug(brand.name), byName.get(lower(holder.genericName))!);
    }
  }

  const indicationsByDrug = new Map<string, string[]>();
  for (const row of indicationRows) {
    const list = indicationsByDrug.get(row.drugId);
    if (list) list.push(row.label);
    else indicationsByDrug.set(row.drugId, [row.label]);
  }

  const tagsByDrug = new Map<string, string[]>();
  for (const row of tagLinks) {
    const list = tagsByDrug.get(row.drugId);
    if (list) list.push(row.slug);
    else tagsByDrug.set(row.drugId, [row.slug]);
  }

  return {
    defs: defs.filter((def) => def.deletedAt === null),
    keys: new Map(defs.map((def) => [def.key, def])),
    byName,
    bySlug,
    brandsByDrug,
    indicationsByDrug,
    tagsByDrug,
    tagSlugs: new Map(tagRows.map((row) => [row.slug, row.id])),
  };
}

/**
 * The drug an entry is about: by name, then by address.
 *
 * Two passes rather than one, and the order is the point. A name written the
 * way the app writes it is a better answer than a name that merely reduces to
 * the same address, so every name in the entry -- the generic and each alias --
 * gets its exact try before any of them falls back. An entry whose generic
 * reduces onto one drug while its alias names another outright means the one it
 * names.
 *
 * The fallback is what makes a combination product work: the library spells
 * eight of its seventeen with a space after the slash and the rest without, so
 * a file cannot be expected to guess, and `Amoxicillin/clavulanate` should find
 * the `Amoxicillin/ Clavulanate` that is already there rather than be refused
 * for standing on its address.
 */
function matchDrug(entry: ImportDrug, known: Known) {
  const names = [entry.generic, ...entry.aliases];
  for (const name of names) {
    const found = known.byName.get(lower(name));
    if (found) return found;
  }
  for (const name of names) {
    const found = known.bySlug.get(drugSlug(name));
    if (found) return found;
  }
  return null;
}

export async function planDrugImport(file: ImportFile): Promise<ImportPlan> {
  const known = await readKnown();
  const problems: ImportProblem[] = [];
  const provenance = provenanceOf(file);

  const scope = file.scope.map((entry) => {
    const slug = tagSlug(entry.label);
    return { kind: entry.kind, label: entry.label, slug, exists: known.tagSlugs.has(slug) };
  });
  // The narrowest, which is last: `VARIANT_KINDS` order is course, then exam.
  const narrowest = scope[scope.length - 1] ?? null;

  // The version named on the screen, which must be one of this file's own
  // scopes. Anything else would write a layer for a class the import does not
  // tag these drugs with -- a layer no reader would ever apply, because every
  // one of them joins membership. Refused rather than ignored: a correction
  // aimed at the wrong thing must not land somewhere else quietly.
  const named = file.target !== TARGET_DRUG && file.target !== TARGET_UNDECIDED;
  const aimed = named ? scope.find((entry) => entry.slug === file.target) ?? null : null;
  if (named && aimed === null) {
    problems.push({
      where: 'the version to correct',
      message: `"${file.target}" is not one of this file's scopes. Pick the drug's own profile, `
        + `or one of: ${scope.map((entry) => entry.slug).join(', ') || 'none'}.`,
    });
  }

  /**
   * *Correct the drug itself*, with nothing said about what it corrects.
   *
   * Reported rather than refused here: the scopes to choose between are read
   * out of the file, so a check has to go through and come back with them
   * before the question can even be put. `applyDrugImport` is the gate.
   *
   * Only asked where there is something to replace: a drug the app has never
   * held takes everything as its own whatever is picked, so a first load of
   * two hundred new drugs is not stopped to answer a question whose answers
   * are all the same. There is always a version to choose between, because the
   * format refuses a file that names neither a course nor an exam.
   */
  const undecidedTarget = file.write === 'base'
    && file.target === TARGET_UNDECIDED
    && file.drugs.some((entry) => matchDrug(entry, known) !== null);

  const destination = aimed ?? narrowest;
  // `base` writes over whatever it is aimed at. Aimed at a version, that is the
  // version's layer; aimed at the drug -- the default -- it is the drug.
  const correcting = file.write === 'base' && aimed !== null;

  // Everything a declared field could be sent to instead: the live, non-core
  // fields. Core fields are excluded because they are written from the drug
  // entry's own keys, not from `fields`.
  const assignable = known.defs
    .filter((def) => !def.isCore && !def.deletedAt)
    .map((def) => ({ key: def.key, label: def.label, group: def.group }));

  /**
   * What the version this import writes to holds today, keyed by drug id.
   *
   * Read for every mode, not only while correcting. Correcting needs it to
   * show what each value replaces -- the drug's own value would be the wrong
   * thing to print as replaced, and a wrong *from* is how a preview stops
   * being a preview. **A lecture import needs it for the opposite reason:** to
   * find the values it must not touch.
   *
   * One exam's drugs arrive as several files -- a course splits pneumonia into
   * CAP and HAP/VAP, skin infections into two decks -- and all of them scope to
   * the same exam, so all of them write to the one layer. Without this, each
   * file compared its wording only against the drug's own and replaced the
   * previous file's in the layer without a word: four files, 21 drugs whose
   * dosing disagreed, and the last file's wording the only survivor. The
   * promise on the screen is *nothing is overwritten*, and that was the one
   * place it was not kept.
   *
   * Its own query rather than `allVariantLayers`, which joins membership on
   * purpose: a layer outlives the tag that created it and no study session
   * should apply one the drug has left. That is the right rule there and the
   * wrong one here, because this import is *about to* add its scope's tags, so
   * a drug not yet tagged would have its layer hidden from the very preview
   * meant to show it being overwritten.
   */
  const aimedLayers = new Map<string, { fields: Record<string, FieldValue>; note: string | null }>();
  if (destination) {
    const rows = await db
      .select({
        drugId: drugVariantValues.drugId,
        fields: drugVariantValues.fields,
        note: drugVariantValues.note,
      })
      .from(drugVariantValues)
      .innerJoin(tags, eq(tags.id, drugVariantValues.tagId))
      .where(eq(tags.slug, destination.slug));
    for (const row of rows) aimedLayers.set(row.drugId, { fields: row.fields, note: row.note });
  }

  const declare = file.declare.map((entry) => {
    const existing = known.keys.get(entry.key);
    if (existing?.deletedAt) {
      problems.push({
        where: `declare (${entry.key})`,
        message: `A field with that key is deleted. Restore it in Admin → Fields, or declare a `
          + 'different key.',
      });
    }
    return {
      key: entry.key,
      label: existing?.label ?? entry.label,
      exists: Boolean(existing),
      suggest: existing ? null : likeliestField(entry, assignable),
    };
  });

  const declared = new Set(file.declare.map((entry) => entry.key));
  const labelFor = (key: string) =>
    known.keys.get(key)?.label ?? file.declare.find((entry) => entry.key === key)?.label ?? key;

  /* --------------------------------------------------------- the regimens -- */
  const inFile = new Set<string>();
  for (const entry of file.drugs) {
    inFile.add(lower(entry.generic));
    for (const alias of entry.aliases) inFile.add(lower(alias));
  }

  const regimens = file.regimens.map((regimen) => {
    for (const component of regimen.components) {
      if (inFile.has(lower(component.drug))) continue;
      if (known.byName.has(lower(component.drug))) continue;
      problems.push({
        where: `regimens (${regimen.name})`,
        message: `"${component.drug}" is neither in this file nor in the app. Add it to "drugs" `
          + 'with just its generic name, or correct the spelling.',
      });
    }
    return { name: regimen.name, members: regimen.components.map((part) => part.drug) };
  });

  /* ------------------------------------------------------- what to tidy -- */

  /**
   * Semicolons in a markdown value.
   *
   * `lib/fields/prose.ts` reads three constructs and a semicolon is none of
   * them, so `- Tendonitis and tendon rupture; risk factors age over 60` is
   * one bullet carrying two ideas, and the second is the one nobody sees. The
   * fix is a line of its own -- a bullet, or a sub-bullet under the first --
   * which the guide now asks for.
   *
   * A warning and not a refusal, because the value is correct and importable
   * and only reads worse than it could. The scan is over the entry's **own**
   * fields rather than the composed values below, so a semicolon inside a
   * regimen is reported once, against the regimen that wrote it, instead of
   * twice against every drug in it.
   *
   * List fields are deliberately not scanned: there a semicolon separates two
   * items and is read as doing so -- `"IV; PO"` is two routes -- which the
   * guide documents and this does not second-guess.
   */
  const warnings: ImportProblem[] = [];
  const typeOf = (key: string) =>
    known.keys.get(key)?.dataType
      ?? file.declare.find((entry) => entry.key === key)?.dataType
      ?? null;
  const TIDY = 'A semicolon joins two ideas into one line, and markdown here has no separator '
    + 'that splits them again. Put the second on its own line — a bullet, or a sub-bullet under '
    + 'the first. Imported exactly as written either way.';

  for (const [at, entry] of file.drugs.entries()) {
    for (const [key, value] of Object.entries(entry.fields)) {
      if (typeOf(key) !== 'markdown') continue;
      if (!value.value?.includes(';')) continue;
      warnings.push({
        where: `drugs[${at}] (${entry.generic}).fields.${key}`,
        message: TIDY,
      });
    }
  }

  // A regimen's own prose, which `regimenFieldFor` renders into the markdown
  // every member drug carries.
  for (const [at, regimen] of file.regimens.entries()) {
    for (const part of ['when', 'flow', 'notes'] as const) {
      if (!regimen[part]?.includes(';')) continue;
      warnings.push({
        where: `regimens[${at}] (${regimen.name}).${part}`,
        message: TIDY,
      });
    }
  }

  /* ------------------------------------------------------------- the drugs -- */
  const planned: PlannedDrug[] = file.drugs.map((entry) => {
    const existing = matchDrug(entry, known);
    const composed = regimenFieldFor(entry, file.regimens);

    // The regimen field is the one value this import composes rather than
    // copies: what the entry said, plus a block per combination it is in.
    const values = { ...entry.fields };
    if (composed !== null) {
      values.regimen = {
        value: composed,
        status: entry.fields.regimen?.status === 'flagged' ? 'flagged' : 'ok',
        source: entry.fields.regimen?.source ?? null,
      };
    }

    const writes: PlannedWrite[] = [];
    for (const [key, value] of Object.entries(values)) {
      if (!known.keys.has(key) && !declared.has(key)) {
        problems.push({
          where: `drugs (${entry.generic}).fields.${key}`,
          message: 'No field has that key. Declare it in "declare", or use an existing key.',
        });
        continue;
      }

      // Correcting a version asks about that version's wording, not the
      // drug's: `current` is what would be overwritten, and where the layer
      // says nothing it is the drug's own, because that is what the version
      // reads as today.
      const held = existing ? aimedLayers.get(existing.id) : undefined;
      const layer = held?.fields[key];
      const current = correcting ? layer ?? existing?.fields[key] : existing?.fields[key];
      const from = current?.value ?? null;

      // A new drug has nothing to differ from, so everything it brings is its
      // own -- whatever the write mode says. Writing a brand-new drug's
      // mechanism into a class layer would leave its own profile blank, which
      // is a profile that looks broken rather than one that looks sourced.
      let to: PlannedWrite['to'];
      // A drug the app has never held has no version to correct either, so it
      // still takes everything as its own -- the same reason as below, and the
      // reason this clause stays first.
      if (!existing) to = 'drug';
      else if (file.write === 'base') to = correcting ? 'variant' : 'drug';
      // A value the drug already holds, word for word, is **not an override**
      // -- whatever the mode asked for. This check used to sit below the
      // `variant` branch, which meant a `variant` import of a value that
      // agreed with the drug still wrote it into the class's layer: the class
      // then claimed its own wording for a field it words identically, the
      // profile offered a version that changes nothing, and the browse row
      // grew a V-n for it. Re-running a lecture after a half-finished import
      // did it five times over.
      //
      // The rule this restores is the one the rest of the feature is built on:
      // a class that says nothing of its own is not another version of the
      // drug. `base` stays above this deliberately -- correcting the drug is a
      // instruction to rewrite, provenance included.
      else if (
        holdsAnAnswer(current) && from === value.value && current?.status === value.status
      ) to = 'unchanged';
      else if (file.write === 'variant') to = 'variant';
      else if (!holdsAnAnswer(current)) to = 'drug';
      else to = 'variant';

      /**
       * The version already speaks here, and another lecture is what made it
       * speak. Two outcomes, and neither of them is a write:
       *
       * - **The same words.** Then this is `unchanged` like any other value the
       *   app already holds. It is what makes *a second import of the same
       *   lecture writes nothing* true of a layer value as well as a drug's
       *   own, which `pointTagsAtVariant` already assumed.
       * - **Different words.** Then it is `held`: left exactly as it is and
       *   reported, because a lecture import has no way to tell a better
       *   wording from a different section's subject. CAP's vancomycin dose and
       *   SSTI's vancomycin duration are both right and neither replaces the
       *   other -- the file wants merging, which is a person's job.
       *
       * Not while correcting: *correct this version* is aimed at this layer and
       * said so on the screen. That is the way through, and the message says so.
       */
      if (to === 'variant' && !correcting && holdsAnAnswer(layer)) {
        const same = layer?.value === value.value && layer?.status === value.status;
        if (same) to = 'unchanged';
        else {
          writes.push({
            key,
            label: labelFor(key),
            to: 'held',
            from: layer?.value ?? null,
            heldBy: held?.note ?? null,
            value: value.value,
            status: value.status,
          });
          continue;
        }
      }

      writes.push({ key, label: labelFor(key), to, from, value: value.value, status: value.status });
    }

    const already = existing ? known.brandsByDrug.get(existing.id) ?? [] : [];
    const heldIndications = existing ? known.indicationsByDrug.get(existing.id) ?? [] : [];
    const heldTags = existing ? known.tagsByDrug.get(existing.id) ?? [] : [];

    return {
      generic: existing?.generic ?? entry.generic,
      slug: existing?.slug ?? drugSlug(entry.generic),
      exists: Boolean(existing),
      identity: {
        // Identity is filled, never corrected -- except in `base` mode, which
        // is the mode that says "the app is wrong".
        // Corrected in `base` mode -- but not when `base` is aimed at a
        // version. A class cannot differ about what a drug *is*, so correcting
        // its wording is not a licence to rewrite the drug's class.
        drugClass: entry.drugClass && (!existing?.drugClass || (file.write === 'base' && !correcting))
          ? entry.drugClass
          : null,
        schedule: entry.schedule && (!existing?.schedule || (file.write === 'base' && !correcting))
          ? entry.schedule
          : null,
      },
      brands: {
        adding: entry.brands.filter((name) => !already.some((held) => lower(held) === lower(name))),
        already,
      },
      indications: {
        adding: entry.indications.filter(
          (label) => !heldIndications.some((held) => lower(held) === lower(label)),
        ),
        already: heldIndications,
      },
      tags: scope.map((inScope) => inScope.slug).filter((slug) => !heldTags.includes(slug)),
      heldTags,
      writes,
    };
  });

  return {
    scope,
    // Stated in the preview on purpose: provenance is the reason a reader
    // trusts a value they did not type, and a wrong file name here is wrong on
    // two hundred values at once.
    provenance,
    variant: destination ? { slug: destination.slug, label: destination.label } : null,
    correcting,
    undecidedTarget,
    declare,
    assignable,
    drugs: planned,
    regimens,
    problems,
    warnings,
    issues: file.issues,
  };
}

/* ---------------------------------------------------------------- apply ---- */

export type ImportReport = {
  created: string[];
  updated: string[];
  /** Field writes that landed on the drug's own profile. */
  toDrug: number;
  /** Field writes that landed in a variant layer. */
  toVariant: number;
  unchanged: number;
  /**
   * Values left alone because this version already says something else here.
   * Listed in `problems` too, one line per drug, naming the lecture that got
   * there first -- see the `held` branch in `planDrugImport`.
   */
  held: number;
  tagsCreated: string[];
  /**
   * Memberships now reading this lecture's version -- the file's other scope
   * tags pointed at the one layer it wrote. See `pointTagsAtVariant`.
   */
  listsPointed: number;
  fieldsDeclared: string[];
  /** Anything that went wrong on the way. An empty list is a clean import. */
  problems: ImportProblem[];
};

/**
 * Writes the file.
 *
 * Refuses outright if the plan has any problem in it: an import is a stack of
 * writes across many drugs, and "half of it went in" is the state nobody can
 * reason about afterwards. So the plan is computed again here rather than
 * trusted from the screen -- the database can have changed between the preview
 * and the button, and the preview is a screenshot, not a lock.
 */
export async function applyDrugImport(
  file: ImportFile,
  actorId: string,
): Promise<{ ok: false; problems: ImportProblem[] } | { ok: true; report: ImportReport }> {
  const plan = await planDrugImport(file);
  if (plan.problems.length > 0) return { ok: false, problems: plan.problems };

  // The one refusal that is not a fault in the file: an overwrite nobody has
  // aimed. Held back until here rather than pushed into `plan.problems`
  // because the preview is how the choice gets made -- it is where the
  // versions in play are listed -- and a problem hides the preview.
  if (plan.undecidedTarget) {
    return {
      ok: false,
      problems: [{
        where: 'what to correct',
        message: 'This overwrites drugs the app already has, and they have versions. Say which '
          + `wording is wrong: the drug's own profile, or what one of `
          + `${plan.scope.map((entry) => entry.label).join(' or ')} says. Nothing was written.`,
      }],
    };
  }

  const report: ImportReport = {
    created: [], updated: [], toDrug: 0, toVariant: 0, unchanged: 0, held: 0,
    tagsCreated: [], listsPointed: 0, fieldsDeclared: [], problems: [],
  };

  /* --------------------------------------------------- the fields it needs -- */
  for (const entry of file.declare) {
    if (plan.declare.find((row) => row.key === entry.key)?.exists) continue;
    const result = await createFieldDef(entry.key, {
      label: entry.label,
      dataType: entry.dataType,
      group: entry.group,
      promptTemplate: entry.promptTemplate,
      enumOptions: entry.enumOptions,
      blankMeansNone: entry.blankMeansNone,
      // A lecture's field is not one of the sheet's columns, so no program
      // year is responsible for it and no year preset should tick it.
      yearLevels: [],
    });
    if (result.ok) report.fieldsDeclared.push(entry.key);
    else report.problems.push({ where: `declare (${entry.key})`, message: result.message });
  }

  /* ----------------------------------------------------- the scope's tags -- */
  for (const entry of plan.scope) {
    if (entry.exists) continue;
    const kind = file.scope.find((row) => tagSlug(row.label) === entry.slug)?.kind ?? 'custom';
    const result = await createTag({ label: entry.label, kind }, actorId);
    if (result.ok) report.tagsCreated.push(entry.slug);
    else report.problems.push({ where: `scope (${entry.label})`, message: result.message });
  }

  // Re-read once the vocabulary exists: the writes below need the new field
  // defs by key, and `setDrugField` takes the definition rather than the key.
  const defs = new Map((await listFieldDefs()).map((def) => [def.key, def]));
  const scopeSlugs = plan.scope.map((entry) => entry.slug);

  /* -------------------------------------------------------------- the drugs -- */
  for (const [index, entry] of file.drugs.entries()) {
    const planned = plan.drugs[index];

    if (!planned.exists) {
      const created = await createDrug({
        genericName: entry.generic,
        drugClass: entry.drugClass ?? '',
        schedule: entry.schedule ?? '',
        scheduleNote: '',
        brands: entry.brands.join('\n'),
        indications: entry.indications.join('\n'),
        // Dosing goes through the field writer below like every other field,
        // so it carries the lecture's provenance rather than "added by hand",
        // and so the regimen parser runs on it the same way either path.
        dosing: '',
        dosingUnique: false,
        tagSlugs: scopeSlugs,
      }, actorId);

      if (!created.ok) {
        report.problems.push({ where: `drugs (${entry.generic})`, message: created.message });
        continue;
      }
      report.created.push(created.value!);
    } else {
      report.updated.push(planned.slug);

      if (planned.brands.adding.length > 0) {
        await setDrugBrands(
          planned.slug,
          [...planned.brands.already, ...planned.brands.adding].join('\n'),
          actorId,
        );
      }
      if (planned.indications.adding.length > 0) {
        await setDrugIndications(
          planned.slug,
          [...planned.indications.already, ...planned.indications.adding].join('\n'),
          actorId,
        );
      }
      if (planned.tags.length > 0) {
        // The union, not the scope: `setDrugTags` replaces membership, and an
        // import must not take a drug off Top Drugs 2026 for being in a
        // lecture.
        await setDrugTags(
          planned.slug,
          [...new Set([...planned.heldTags, ...scopeSlugs])],
          actorId,
        );
      }
    }

    const [drug] = await db
      .select({ id: drugs.id })
      .from(drugs)
      .where(eq(drugs.slug, planned.slug));
    if (!drug) {
      report.problems.push({
        where: `drugs (${entry.generic})`,
        message: 'Created, then could not be read back. Nothing further was written to it.',
      });
      continue;
    }

    const source = entry.source ?? provenanceOf(file);
    const layer: Record<string, FieldValue> = {};
    const kept: PlannedWrite[] = [];

    for (const write of planned.writes) {
      if (write.to === 'unchanged') {
        report.unchanged += 1;
        continue;
      }
      // Nothing to write, and the one thing to say. Collected per drug rather
      // than pushed one problem at a time: a four-file exam holds a dozen
      // values across two dozen drugs, and a list that long reads as a broken
      // import rather than as the two sentences it actually is.
      if (write.to === 'held') {
        report.held += 1;
        kept.push(write);
        continue;
      }
      const def = defs.get(write.key);
      if (!def) {
        report.problems.push({
          where: `drugs (${entry.generic}).fields.${write.key}`,
          message: 'The field does not exist and could not be declared.',
        });
        continue;
      }

      // A new drug's values go to the drug itself, which is what the plan
      // already decided -- see `planDrugImport`.
      if (write.to === 'drug') {
        const result = await setDrugField(planned.slug, def, {
          key: write.key,
          value: write.value ?? '',
          source: entry.fields[write.key]?.source ?? source,
          status: write.status,
        }, actorId);
        if (result.ok) report.toDrug += 1;
        else report.problems.push({ where: `drugs (${entry.generic}).${write.key}`, message: result.message });
        continue;
      }

      layer[write.key] = {
        value: write.value,
        status: write.status,
        source: entry.fields[write.key]?.source ?? source,
        updatedAt: new Date().toISOString(),
        updatedBy: actorId,
      };
    }

    if (kept.length > 0) {
      const fields = kept.map((write) => write.label).join(', ');
      const [first] = kept;
      const by = first.heldBy ? ` (from ${first.heldBy})` : '';
      report.problems.push({
        where: `drugs (${planned.generic})`,
        message: `${fields}: ${plan.variant?.label ?? 'this version'} already says something else `
          + `here${by}, so what this file says was left out. Merge the two wordings into one file, `
          + 'or import it again with "Correct the drug itself" aimed at that version.',
      });
    }

    if (Object.keys(layer).length > 0) {
      if (!plan.variant) {
        report.problems.push({
          where: `drugs (${entry.generic})`,
          message: 'There is no scope to hold what this lecture says differently.',
        });
        continue;
      }
      const patched = await patchVariantLayer({
        drugId: drug.id,
        variantSlug: plan.variant.slug,
        values: layer,
        // Where the wording came from, recorded once on the layer rather than
        // repeated on every value in it -- see `provenanceOf`.
        note: noteOf(file),
        userId: actorId,
      });
      if (patched.ok) report.toVariant += Object.keys(layer).length;
      else report.problems.push({ where: `drugs (${entry.generic})`, message: patched.message });
    }

    // The file's scope is this version's tags: whichever of them the layer did
    // not land on is told to read it, so the same lecture does not teach two
    // different things depending on whether you study the class or its exam.
    //
    // Outside the block above on purpose. A second import of the same lecture
    // writes no values at all -- every one of them is already identical -- so a
    // pointer set only alongside a fresh write would never reach a drug
    // imported before this existed. `pointTagsAtVariant` checks the layer for
    // itself and does nothing where there is none.
    // Not while correcting: a correction is a surgical fix to one version's
    // wording, where a lecture import is the thing that says "these scopes are
    // this version's tags". Repointing memberships is not part of fixing a typo.
    if (plan.variant && !plan.correcting) {
      report.listsPointed += await pointTagsAtVariant({
        drugId: drug.id,
        variantSlug: plan.variant.slug,
        tagSlugs: scopeSlugs,
      });
    }
  }

  return { ok: true, report };
}
