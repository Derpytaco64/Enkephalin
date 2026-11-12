/**
 * Every drug as the card and question builders want it: core fields folded in
 * beside the stored ones, tags and indications already slugged.
 *
 * Shared by flashcards and the quiz on purpose. Two loaders would be two
 * answers to "what is in scope", and the two modes are meant to disagree about
 * nothing.
 */
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  dosingRegimens,
  drugBrands,
  drugIndications,
  drugTags,
  drugs,
  indications,
  tags,
  type FieldValue,
} from '@/db/schema';
import { toSig } from '@/lib/dosing/sig';
import {
  allVariantLayers, baseVariantsByDrug, numberedVariantsByDrug, overlayFields, overriddenKeys,
} from '@/lib/drugs/variants';
import type { CardSource, CardVariant } from './cards';

/**
 * Core fields wrapped in the same envelope as the stored ones, so the card
 * builder treats every field alike. Their provenance is the sheet.
 */
function sheetValue(value: string | null): FieldValue {
  return { value, status: 'ok', source: 'class sheet', updatedAt: '', updatedBy: null };
}

/**
 * @param variantSlugs Classes or exams whose own wording to study,
 *   narrowest last.
 * @param byMembership The version each drug is *on a list* as, per drug --
 *   `membershipVariants`. Applied first, so it is the default a scoped class
 *   can still override.
 *
 * Studying a class studies **that class's version** of each drug: its values
 * where it has them, the drug's everywhere else. Passed in rather than read
 * from the config here, because the scope's list dropdown holds every kind of
 * tag and only the caller has already asked which of them can carry a variant.
 *
 * Two sources of "which version", and they are ordered rather than ranked
 * against each other. A list can say *hold amoxicillin as the ID class words
 * it*, which is a standing choice made when the list was built; a scope can
 * say *study this as PHRM 535 teaches it*, which is a decision made just now.
 * The standing choice goes on first and the deliberate one last, so the
 * deliberate one wins -- for the same reason an exam beats the class it is in.
 *
 * It changes the *values*, never the card: `cardKey` is built from field keys,
 * so a mechanism studied through two different classes is one card with one
 * schedule. That is deliberate -- the alternative is a second kind of study
 * subject, which this database had and dropped in migration 0013.
 */
export async function loadCardSources(
  variantSlugs: string[] = [],
  byMembership: Map<string, string[]> = new Map(),
): Promise<CardSource[]> {
  // Every layer the session might read: the ones the scope named, plus the
  // ones individual lists named for individual drugs.
  const layersWanted = [
    ...new Set([...variantSlugs, ...[...byMembership.values()].flat()]),
  ];
  const [
    drugRows, brandRows, indicationRows, tagRows, regimenRows, variantLayers, numbered, bases,
  ] = await Promise.all([
    db.select().from(drugs).orderBy(asc(drugs.genericName)),
    db
      .select({ drugId: drugBrands.drugId, name: drugBrands.name })
      .from(drugBrands)
      .orderBy(asc(drugBrands.sortOrder)),
    db
      .select({
        // The link row's own id, because a dosing row points at the link and
        // not at the shared vocabulary -- a dose belongs to "this drug, for
        // this condition", which is what a link row is.
        linkId: drugIndications.id,
        drugId: drugIndications.drugId,
        slug: indications.slug,
        label: indications.label,
      })
      .from(drugIndications)
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
      .orderBy(asc(drugIndications.sortOrder)),
    db
      .select({ drugId: drugTags.drugId, slug: tags.slug })
      .from(drugTags)
      .innerJoin(tags, eq(tags.id, drugTags.tagId)),
    db
      .select().from(dosingRegimens)
      .orderBy(asc(dosingRegimens.alternative), asc(dosingRegimens.step)),
    allVariantLayers(layersWanted),
    // Every drug's versions, numbered the way the browse list and the list
    // builder number them -- so V-2 on a card is the same V-2 everywhere else.
    numberedVariantsByDrug(),
    // And whose words each drug's *own* profile is, for the drugs a lecture
    // created: those have no layer, so without this a card asks Exam 1's
    // wording with nothing on screen saying so, beside its own sibling cards
    // that name Exam 2 and Exam 3.
    baseVariantsByDrug(),
  ]);

  const indicationLabelByLink = new Map(indicationRows.map((row) => [row.linkId, row.label]));

  // One comparable key per drug: every regimen printed as sig and joined. Null
  // the moment a row has no components, because half a reading compares to
  // nothing -- such a drug falls back to being compared by its wording, which
  // is all it ever had.
  //
  // Rows carrying an indication are held out of it and gathered per branch
  // below. Folding them in would be the original bug in a new place: one
  // string holding two different doses, with nothing saying which is which.
  const sigByDrug = new Map<string, string | null>();
  for (const regimen of regimenRows) {
    if (regimen.indicationId !== null) continue;
    if (sigByDrug.get(regimen.drugId) === null) continue;
    const sig = regimen.amounts.length > 0 ? toSig(regimen) : '';
    if (!sig) {
      sigByDrug.set(regimen.drugId, null);
      continue;
    }
    const current = sigByDrug.get(regimen.drugId);
    sigByDrug.set(regimen.drugId, current ? `${current} | ${sig}` : sig);
  }

  /**
   * The indication-scoped rows, gathered per drug and per branch.
   *
   * A branch's sig goes null on the same rule as a drug's -- one unreadable
   * row and the branch is compared by its wording -- and the text is the slice
   * of prose the branch was read from, which is what the editor typed and what
   * a reader should see.
   */
  const branchesByDrug = new Map<string, Map<string, { label: string; text: string; sig: string | null }>>();
  for (const regimen of regimenRows) {
    if (regimen.indicationId === null) continue;
    const label = indicationLabelByLink.get(regimen.indicationId);
    // A link row deleted under us: the dose is still the drug's, it just has
    // no branch to hang off any more.
    if (label === undefined) continue;

    const branches = branchesByDrug.get(regimen.drugId) ?? new Map();
    branchesByDrug.set(regimen.drugId, branches);

    const sig = regimen.amounts.length > 0 ? toSig(regimen) : null;
    const held = branches.get(regimen.indicationId);
    if (held === undefined) {
      branches.set(regimen.indicationId, { label, text: regimen.sourceText, sig });
      continue;
    }
    branches.set(regimen.indicationId, {
      label,
      text: `${held.text} | ${regimen.sourceText}`,
      sig: held.sig === null || sig === null ? null : `${held.sig} | ${sig}`,
    });
  }

  const group = <T, K extends keyof T>(rows: T[], pick: K) => {
    const map = new Map<string, T[K][]>();
    for (const row of rows) {
      const id = (row as unknown as { drugId: string }).drugId;
      const list = map.get(id);
      if (list) list.push(row[pick]);
      else map.set(id, [row[pick]]);
    }
    return map;
  };

  const brandsByDrug = group(brandRows, 'name');
  const indicationsByDrug = group(indicationRows, 'label');
  const indicationSlugsByDrug = group(indicationRows, 'slug');
  const tagsByDrug = group(tagRows, 'slug');

  /**
   * The layers that apply to one drug, in order, each with the version it is.
   *
   * One function so the overlay and the "whose words" record cannot disagree
   * about either the set or the order -- a pill naming a class whose value did
   * not win would be worse than no pill.
   */
  const layersFor = (drugId: string) =>
    [...(byMembership.get(drugId) ?? []), ...variantSlugs].map((slug) => {
      const found = (numbered.get(drugId) ?? []).find((entry) => entry.slug === slug);
      return {
        fields: variantLayers.get(drugId)?.get(slug) ?? {},
        // Narrowed to the three things a card may show, rather than passed
        // through whole: the kind and the override count are no business of a
        // card, and this payload is sent to the browser for every card in the
        // deck.
        variant: found ? { n: found.n, label: found.label, slug: found.slug } : null,
      };
    });

  return drugRows.map((drug) => {
    const brands = brandsByDrug.get(drug.id) ?? [];
    const indicationLabels = indicationsByDrug.get(drug.id) ?? [];

    // Who worded each field, in the order the layers apply -- so the last one
    // to speak about a key is the one recorded, which is the one whose value
    // the overlay above kept.
    const wordedBy: Record<string, CardVariant> = {};
    // The drug's own words go in first, where a lecture is whose they are: a
    // drug that arrived with one holds its wording as the base, so every field
    // it answers is that class's until a layer speaks over the key -- which the
    // loop below then does, in overlay order. `overriddenKeys` is the right
    // test for the base as well as for a layer: it asks which keys hold an
    // answer, and it leaves the core fields out, which are the sheet's.
    const base = bases.get(drug.id);
    if (base) {
      for (const key of overriddenKeys(drug.fields)) {
        wordedBy[key] = { n: 1, label: base.label, slug: base.slug };
      }
    }
    for (const layer of layersFor(drug.id)) {
      if (!layer.variant) continue;
      for (const key of overriddenKeys(layer.fields)) wordedBy[key] = layer.variant;
    }
    const routeValue = drug.fields.route?.value ?? '';

    return {
      drugId: drug.id,
      slug: drug.slug,
      generic: drug.genericName,
      drugClass: drug.drugClass,
      schedule: drug.schedule,
      routes: routeValue ? routeValue.split('\n').map((route) => route.trim()).filter(Boolean) : [],
      tags: tagsByDrug.get(drug.id) ?? [],
      // The stored slug, which is the same row the picker listed -- so the
      // scope a link carries and the drugs it selects cannot drift apart.
      indications: [...new Set(indicationSlugsByDrug.get(drug.id) ?? [])],
      dosingSig: sigByDrug.get(drug.id) ?? null,
      dosingBranches: [...(branchesByDrug.get(drug.id)?.values() ?? [])],
      needsPairingReview: drug.needsPairingReview,
      wordedBy,
      values: {
        // The variant layers first, so a class's own wording is what the card
        // asks about. In the order the caller gave them, which is the order
        // `variantSlugsAmong` sorted the tags in: course, then exam.
        ...overlayFields(
          drug.fields,
          ...layersFor(drug.id).map(({ fields }) => fields),
        ),
        generic: sheetValue(drug.genericName),
        brand: sheetValue(brands.join('\n') || null),
        indication: sheetValue(indicationLabels.join('\n') || null),
        drug_class: sheetValue(drug.drugClass),
        // Not controlled is an answer, not a gap -- 213 of the 236 are not --
        // so it is recorded as "none" and the card asks the question honestly.
        controlled: drug.schedule
          ? sheetValue(drug.schedule)
          : { value: null, status: 'none', source: 'class sheet', updatedAt: '', updatedBy: null },
      },
    };
  });
}

