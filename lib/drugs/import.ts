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
  likeliestField, noteOf, provenanceOf, regimenFieldFor, TARGET_DRUG,
  type ImportDrug, type ImportFile, type ImportProblem,
} from './import-format';

/* ----------------------------------------------------------------- plan ---- */

/** Where one field value would go, and what it would replace. */
export type PlannedWrite = {
  key: string;
  label: string;
  /** `unchanged` is a value the drug already holds, word for word. */
  to: 'drug' | 'variant' | 'unchanged';
  /** What the drug holds now, for the one question a preview has to answer. */
  from: string | null;
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
  /** The file's own unresolved notes, for a person to read. */
  issues: string[];
};

const lower = (text: string) => text.trim().toLowerCase();


/** Whether a stored envelope amounts to an answer, blank or not. */
function holdsAnAnswer(value: FieldValue | undefined): boolean {
  if (!value) return false;
  return value.value !== null || value.status === 'none';
}

type Known = {
  defs: FieldDef[];
  /** Every field key the database has, soft-deleted ones included. */
  keys: Map<string, FieldDef>;
  byName: Map<string, { id: string; slug: string; generic: string; drugClass: string | null; schedule: string | null; fields: Record<string, FieldValue> }>;
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

  const byName = new Map<string, Known['byName'] extends Map<string, infer V> ? V : never>();
  for (const drug of drugRows) {
    byName.set(lower(drug.genericName), {
      id: drug.id,
      slug: drug.slug,
      generic: drug.genericName,
      drugClass: drug.drugClass,
      schedule: drug.schedule,
      fields: drug.fields,
    });
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
    brandsByDrug,
    indicationsByDrug,
    tagsByDrug,
    tagSlugs: new Map(tagRows.map((row) => [row.slug, row.id])),
  };
}

/** The drug an entry is about, matched by its name and then by its aliases. */
function matchDrug(entry: ImportDrug, known: Known) {
  for (const name of [entry.generic, ...entry.aliases]) {
    const found = known.byName.get(lower(name));
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
  const aimed = file.target === TARGET_DRUG
    ? null
    : scope.find((entry) => entry.slug === file.target) ?? null;
  if (file.target !== TARGET_DRUG && aimed === null) {
    problems.push({
      where: 'the version to correct',
      message: `"${file.target}" is not one of this file's scopes. Pick the drug's own profile, `
        + `or one of: ${scope.map((entry) => entry.slug).join(', ') || 'none'}.`,
    });
  }

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
   * What the version being corrected holds today, keyed by drug id.
   *
   * Needed only to show what each value replaces -- the drug's own value would
   * be the wrong thing to print as replaced, and a wrong *from* is how a
   * preview stops being a preview.
   *
   * Its own query rather than `allVariantLayers`, which joins membership on
   * purpose: a layer outlives the tag that created it and no study session
   * should apply one the drug has left. That is the right rule there and the
   * wrong one here, because this import is *about to* add its scope's tags, so
   * a drug not yet tagged would have its layer hidden from the very preview
   * meant to show it being overwritten.
   */
  const aimedLayers = new Map<string, Record<string, FieldValue>>();
  if (correcting && destination) {
    const rows = await db
      .select({ drugId: drugVariantValues.drugId, fields: drugVariantValues.fields })
      .from(drugVariantValues)
      .innerJoin(tags, eq(tags.id, drugVariantValues.tagId))
      .where(eq(tags.slug, destination.slug));
    for (const row of rows) aimedLayers.set(row.drugId, row.fields);
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
      const layer = existing ? aimedLayers.get(existing.id)?.[key] : undefined;
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
    declare,
    assignable,
    drugs: planned,
    regimens,
    problems,
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

  const report: ImportReport = {
    created: [], updated: [], toDrug: 0, toVariant: 0, unchanged: 0,
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

    for (const write of planned.writes) {
      if (write.to === 'unchanged') {
        report.unchanged += 1;
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
