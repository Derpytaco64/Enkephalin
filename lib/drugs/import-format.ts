/**
 * `enkephalin.drugs/1` — the shape of an import file, and reading one safely.
 *
 * Client-safe on purpose: no database import, so the admin screen can validate
 * a pasted file and show what is wrong with it before anything is sent. The
 * half that needs the database -- *does this drug exist, does this field key
 * exist, what would change* -- is `lib/drugs/import.ts`.
 *
 * The authoring guide is `docs/drug-import.md`, and it is the contract: every
 * refusal below is listed there, in the same words, because the file's author
 * is usually another model being handed that document and nothing else.
 *
 * **Refusals are collected, not thrown.** A file with eleven drugs and three
 * mistakes should report three mistakes once, rather than one mistake four
 * times over four attempts. Nothing is written until the list is empty.
 */
import { FIELD_DATA_TYPES, FIELD_KEY_PATTERN, type FieldDataType } from '@/lib/fields/constants';
import { VARIANT_KINDS, type VariantKind } from './variant-kinds';

export const IMPORT_FORMAT = 'enkephalin.drugs/1';

/** How a value reaches the database when the drug already holds one. */
export const WRITE_MODES = ['fill', 'variant', 'base'] as const;

/**
 * Which version this import means: the drug's own profile, or a scope tag's
 * slug.
 *
 * Not read out of the file, and set by the import screen -- the same division
 * `write` already follows, and for the same reason: the file's author read a
 * deck and cannot know that this database holds three readings of nivolumab
 * already.
 *
 * Naming one changes what `base` **overwrites**. *Correct the drug itself* on a
 * drug with versions had no way to say which thing was wrong, so correcting a
 * class's bad wording meant correcting the drug and watching the class's
 * version go on outranking it.
 *
 * `fill` and `variant` have no use for it: what they write that differs always
 * goes to the narrowest scope, because it is that class speaking.
 */
export const TARGET_DRUG = 'the-drug';

/**
 * *Nobody has said yet*, which is where the screen's select starts.
 *
 * A separate value from `TARGET_DRUG` because *the drug itself* and *unasked*
 * are different answers, and `base` is the one mode where the difference is
 * expensive: it is the mode that overwrites, so defaulting the question would
 * be guessing which of two people's wording to destroy. `planDrugImport`
 * reports it as `undecidedTarget` and `applyDrugImport` refuses, while a
 * preview is still shown -- the scopes to choose between are only known once
 * the file has been read, so blocking the check would leave nothing to decide
 * with.
 */
export const TARGET_UNDECIDED = '';
export type WriteMode = (typeof WRITE_MODES)[number];

/**
 * What each mode does, in the words the import screen puts on the radio.
 *
 * Here rather than in the form, because the guide, the screen and the refusal
 * message all have to describe the same three behaviours, and three
 * descriptions of one behaviour is how they stop matching. The file names a
 * mode; the person importing can change it before anything is written, which
 * is the point -- the file's author read a deck, but only the person looking at
 * the preview knows what they want done to a profile they have been curating.
 */
export const WRITE_MODE_COPY: Record<WriteMode, { label: string; detail: string }> = {
  fill: {
    label: 'Fill the gaps, split where it differs',
    detail: 'A value the drug has not got goes on the drug. A value that disagrees with what '
      + 'is already there becomes what this class says, and the drug keeps its own.',
  },
  variant: {
    label: 'Make an alternate profile, and only that',
    detail: 'Everything goes to this class\'s own version, including values the drug has not '
      + 'got. The drug itself is left exactly as it is.',
  },
  base: {
    label: 'Correct the drug itself',
    detail: 'Everything is written to the drug, overwriting what is there. For fixing the '
      + 'database from a source you trust more than it.',
  },
};

/** The roles a drug can play in a combination. `component` is the default. */
export const REGIMEN_ROLES = [
  'component', 'alternative', 'premedication', 'lymphodepletion', 'supportive', 'rescue',
] as const;
export type RegimenRole = (typeof REGIMEN_ROLES)[number];

/**
 * The five that live in their own columns and link tables.
 *
 * They are named on the drug entry (`generic`, `brands`, `indications`,
 * `class`, `schedule`) rather than inside `fields`, because a variant layer
 * cannot carry them and a file that put them there would be writing somewhere
 * it did not mean to. Listed here so the refusal can say which key to use.
 */
const CORE_KEYS: Record<string, string> = {
  generic: 'generic',
  brand: 'brands',
  indication: 'indications',
  drug_class: 'class',
  controlled: 'schedule',
};

export type ImportProblem = { where: string; message: string };

const lower = (text: string) => text.trim().toLowerCase();

/**
 * The existing field a declared one probably means, or null.
 *
 * Word overlap on the label and the key, with the words that say nothing about
 * meaning dropped. Deliberately dim: it only ever fills in a dropdown's
 * default, and a wrong suggestion that is visible beside the real field set
 * costs a click, while a clever one that silently merges two different ideas
 * costs a field nobody can untangle afterwards.
 */
const NOISE = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'for', 'to', 'in', 'notes', 'info']);

function words(text: string): Set<string> {
  return new Set(
    lower(text)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !NOISE.has(word)),
  );
}

export function likeliestField(
  declared: { key: string; label: string },
  assignable: { key: string; label: string }[],
): string | null {
  const mine = new Set([...words(declared.label), ...words(declared.key)]);
  if (mine.size === 0) return null;

  let best: { key: string; score: number } | null = null;
  for (const candidate of assignable) {
    const theirs = new Set([...words(candidate.label), ...words(candidate.key)]);
    let shared = 0;
    for (const word of mine) if (theirs.has(word)) shared += 1;
    if (shared === 0) continue;

    // Normalised, so a two-word label sharing both words beats a six-word one
    // sharing the same two.
    const score = shared / Math.max(mine.size, theirs.size);
    if (!best || score > best.score) best = { key: candidate.key, score };
  }

  return best && best.score >= 0.4 ? best.key : null;
}


/**
 * Sends a declared field's values to a field the app already has.
 *
 * The problem this solves is the one the guide can only ask nicely about: three
 * lectures inventing `adverse_effects`, `ae` and `toxicity` for one idea. A
 * file's author has read a slide deck and cannot know what this database calls
 * things, so **declaring a field is a request, not a decision** -- the person
 * importing sees each one beside the existing field set and either creates it
 * or points it at what is already there.
 *
 * Done as a rewrite of the file before anything is planned, rather than as an
 * argument threaded through the planner: a mapped file is just a file that was
 * written with the right keys, so every refusal, every preview line and every
 * writer downstream works unchanged and cannot disagree with the mapping.
 *
 * `map` is declared key -> existing key. A key not in the map is created as
 * declared. Mapping onto a core field is refused here, because `parseDrugImport`
 * refuses core keys in `fields` and a remap must not be a way around it.
 */
export function applyFieldMap(
  file: ImportFile,
  map: Record<string, string>,
): { ok: true; file: ImportFile } | { ok: false; problems: ImportProblem[] } {
  const problems: ImportProblem[] = [];
  const effective: Record<string, string> = {};

  for (const [from, to] of Object.entries(map)) {
    if (!to || to === from) continue;
    if (CORE_KEYS[to]) {
      problems.push({
        where: `declare (${from})`,
        message: `"${to}" is a core field and is written from the drug's own `
          + `"${CORE_KEYS[to]}" key, so a declared field cannot be sent to it.`,
      });
      continue;
    }
    if (!file.declare.some((entry) => entry.key === from)) {
      problems.push({
        where: `declare (${from})`,
        message: 'That key is not declared in this file, so there is nothing to send anywhere.',
      });
      continue;
    }
    effective[from] = to;
  }

  if (problems.length > 0) return { ok: false, problems };

  const rename = (key: string) => effective[key] ?? key;

  const drugs = file.drugs.map((drug) => {
    const fields: Record<string, ImportValue> = {};
    for (const [key, value] of Object.entries(drug.fields)) {
      const to = rename(key);
      // Two declared keys mapped onto one field: the later entry would silently
      // win, so say so rather than losing half the lecture's wording.
      if (to in fields && to !== key) {
        problems.push({
          where: `drugs (${drug.generic}).fields.${key}`,
          message: `Two of this file's fields are both being sent to "${to}", and one would `
            + 'overwrite the other. Send one of them somewhere else, or create it.',
        });
        continue;
      }
      fields[to] = value;
    }
    return { ...drug, fields };
  });

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    file: {
      ...file,
      // A mapped field is not declared: it already exists, under its own label.
      declare: file.declare.filter((entry) => !(entry.key in effective)),
      drugs,
    },
  };
}

export type ImportValue = {
  /** null is "this drug has none of that thing", which is an answer. */
  value: string | null;
  status: 'ok' | 'flagged' | 'none';
  /** Overrides the file's own provenance for this one value. */
  source: string | null;
};

export type ImportDrug = {
  generic: string;
  aliases: string[];
  brands: string[];
  indications: string[];
  drugClass: string | null;
  schedule: string | null;
  fields: Record<string, ImportValue>;
  source: string | null;
};

export type ImportRegimenComponent = {
  drug: string;
  dose: string | null;
  role: RegimenRole;
};

export type ImportRegimen = {
  name: string;
  when: string | null;
  components: ImportRegimenComponent[];
  flow: string | null;
  notes: string | null;
  source: string | null;
};

export type ImportFieldDef = {
  key: string;
  label: string;
  dataType: FieldDataType;
  group: string | null;
  promptTemplate: string | null;
  enumOptions: string[] | null;
  blankMeansNone: boolean;
};

export type ImportScope = { kind: VariantKind; label: string };

export type ImportFile = {
  scope: ImportScope[];
  source: { file: string; deck: string | null; pages: string | null; accessed: string | null };
  write: WriteMode;
  /** See `TARGET_DRUG`. The screen's choice, not the file's. */
  target: string;
  declare: ImportFieldDef[];
  drugs: ImportDrug[];
  regimens: ImportRegimen[];
  issues: string[];
};

export type ParseResult =
  | { ok: true; file: ImportFile }
  | { ok: false; problems: ImportProblem[] };

/* ----------------------------------------------------------------- read ---- */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A string, trimmed, or null where there is nothing. Never an empty string. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter((entry): entry is string => entry !== null);
}

/**
 * The provenance line every value from this file carries: **from PHRM 535
 * content**.
 *
 * The class's name and nothing else, on the owner's call, and the reason it is
 * the right call is that this field is read in a list. A profile shows one
 * source line per field, so fourteen fields from one lecture were fourteen
 * copies of a file name -- noise shaped like information, when the only
 * question a reader actually has is *whose words are these*. The class answers
 * that; the file name answers "which of their files", which is a question for
 * the layer, not for every field in it.
 *
 * So the file name is not lost, it is recorded once: `noteOf` puts it on the
 * layer, where it belongs and where the editor already shows it.
 *
 * The widest scope rather than the narrowest, because this says who says so and
 * the class is who -- the exam is where within the class it was said, which the
 * tag records by being the tag.
 */
export function provenanceOf(file: ImportFile): string {
  const widest = file.scope[0]?.label;
  return widest ? `from ${widest} content` : `from ${file.source.file}`;
}

/**
 * The layer's note: where the file name, the deck and the pages go.
 *
 * One line per layer instead of the same line on every value in it. A second
 * import of the same lecture rewrites it, which is correct -- it is a record of
 * where this layer's wording came from, not a log of visits.
 */
export function noteOf(file: ImportFile): string {
  const parts = [file.source.file];
  if (file.source.deck) parts.push(`slides: ${file.source.deck}`);
  if (file.source.pages) parts.push(`pages ${file.source.pages}`);
  if (file.source.accessed) parts.push(`read ${file.source.accessed}`);
  return parts.join(' · ');
}

/** What arrived, for a refusal that can say so rather than only say what it wanted. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'an object with no "value"';
  if (typeof value === 'string') return 'an empty string';
  return `a ${typeof value}`;
}

const VALUE_FORMS = 'A value is a string, a list of strings, null, '
  + 'or an object with a "value".';

/**
 * A list written as an array, folded into the one string the column holds.
 *
 * `drugs.fields` stores every value as a string and `splitList` reads a list
 * back out of it, newline first -- so an array is not a second kind of value,
 * it is the same value written the way a list-typed field reads most naturally.
 * Newline rather than "; " because that is what the drug form puts there when a
 * person types a list by hand, so an imported value and an authored one are the
 * same bytes and the textarea shows it back correctly.
 *
 * Which fields are list-typed cannot be checked here: a parse has no database,
 * and an existing field's type is known only once the plan reads it. So an
 * array is accepted for any field -- the same latitude a string already has,
 * where nothing stops "IV; PO" being written into a markdown field.
 */
function readItems(raw: unknown[], where: string, problems: ImportProblem[]): string | null {
  const items: string[] = [];
  for (const [index, entry] of raw.entries()) {
    const item = text(entry);
    if (item === null) {
      problems.push({
        where,
        message: `Item ${index + 1} of this list is ${describe(entry)}. `
          + 'Every item is a non-empty string.',
      });
      return null;
    }
    items.push(item);
  }
  if (items.length === 0) {
    problems.push({
      where,
      message: 'An empty list says neither "none" nor "not said". Use null for none, '
        + 'or leave the key out entirely.',
    });
    return null;
  }
  return items.join('\n');
}

function readValue(raw: unknown, where: string, problems: ImportProblem[]): ImportValue | null {
  // `null` is the file saying *there is none of this*, which is a fact worth
  // storing and worth asking about -- the whole reason `status` exists.
  if (raw === null) return { value: null, status: 'none', source: null };

  if (typeof raw === 'string') {
    if (raw.trim() === '') {
      problems.push({
        where,
        message: 'An empty string says neither "none" nor "not said". Use null for none, '
          + 'or leave the key out entirely.',
      });
      return null;
    }
    return { value: raw.trim(), status: 'ok', source: null };
  }

  if (Array.isArray(raw)) {
    const items = readItems(raw, where, problems);
    return items === null ? null : { value: items, status: 'ok', source: null };
  }

  if (!isObject(raw)) {
    problems.push({ where, message: `${VALUE_FORMS} This is ${describe(raw)}.` });
    return null;
  }

  const inner = raw.value;
  const status = text(raw.status) ?? 'ok';
  if (status !== 'ok' && status !== 'flagged' && status !== 'none') {
    problems.push({ where, message: `"${status}" is not a status. Use ok, flagged or none.` });
    return null;
  }
  if (inner === null) return { value: null, status: 'none', source: text(raw.source) };

  // The envelope carries a list as readily as a string: a flagged route with a
  // source is still a route, and the status is about the value, not its shape.
  const value = Array.isArray(inner) ? readItems(inner, where, problems) : text(inner);
  if (value === null) {
    if (!Array.isArray(inner)) {
      problems.push({
        where,
        message: `This value is ${describe(inner)}. A value is a string or a list of strings; `
          + 'use null if the drug has none.',
      });
    }
    return null;
  }

  return { value, status, source: text(raw.source) };
}

function readDeclaration(raw: unknown, at: number, problems: ImportProblem[]): ImportFieldDef | null {
  const where = `declare[${at}]`;
  if (!isObject(raw)) {
    problems.push({ where, message: 'Each declaration is an object.' });
    return null;
  }

  const key = text(raw.key);
  const label = text(raw.label);
  const dataType = text(raw.type);

  if (!key || !FIELD_KEY_PATTERN.test(key)) {
    problems.push({
      where,
      message: `"${key ?? ''}" is not a field key. Keys are lower snake_case, 2-41 characters, `
        + 'and permanent once created.',
    });
    return null;
  }
  if (!label) {
    problems.push({ where: `${where} (${key})`, message: 'A declared field needs a label.' });
    return null;
  }
  if (!dataType || !(FIELD_DATA_TYPES as string[]).includes(dataType)) {
    problems.push({
      where: `${where} (${key})`,
      message: `"${dataType ?? ''}" is not a field type. Use one of: ${FIELD_DATA_TYPES.join(', ')}.`,
    });
    return null;
  }
  const options = stringList(raw.options);
  if (dataType === 'enum' && options.length === 0) {
    problems.push({ where: `${where} (${key})`, message: 'An enum field needs its options.' });
    return null;
  }

  return {
    key,
    label,
    dataType: dataType as FieldDataType,
    group: text(raw.group),
    promptTemplate: text(raw.prompt),
    enumOptions: options.length > 0 ? options : null,
    blankMeansNone: raw.blank_means_none === true,
  };
}

function readDrug(raw: unknown, at: number, problems: ImportProblem[]): ImportDrug | null {
  const where = `drugs[${at}]`;
  if (!isObject(raw)) {
    problems.push({ where, message: 'Each drug is an object.' });
    return null;
  }

  const generic = text(raw.generic);
  if (!generic) {
    problems.push({ where, message: 'A drug needs a generic name; there is nothing to match on.' });
    return null;
  }

  const named = `${where} (${generic})`;
  const fields: Record<string, ImportValue> = {};

  if (raw.fields !== undefined) {
    if (!isObject(raw.fields)) {
      problems.push({ where: named, message: '"fields" is an object of field key to value.' });
    } else {
      for (const [key, value] of Object.entries(raw.fields)) {
        const core = CORE_KEYS[key];
        if (core) {
          problems.push({
            where: `${named}.fields.${key}`,
            message: `${key} lives in its own column, not in fields. Use the drug's "${core}" key.`,
          });
          continue;
        }
        if (!FIELD_KEY_PATTERN.test(key)) {
          problems.push({
            where: `${named}.fields.${key}`,
            message: 'Not a field key. Keys are lower snake_case.',
          });
          continue;
        }
        const read = readValue(value, `${named}.fields.${key}`, problems);
        if (read) fields[key] = read;
      }
    }
  }

  return {
    generic,
    aliases: stringList(raw.aliases),
    brands: stringList(raw.brands),
    indications: stringList(raw.indications),
    drugClass: text(raw.class),
    schedule: text(raw.schedule)?.toUpperCase() ?? null,
    fields,
    source: text(raw.source),
  };
}

function readRegimen(raw: unknown, at: number, problems: ImportProblem[]): ImportRegimen | null {
  const where = `regimens[${at}]`;
  if (!isObject(raw)) {
    problems.push({ where, message: 'Each regimen is an object.' });
    return null;
  }

  const name = text(raw.name);
  if (!name) {
    problems.push({ where, message: 'A regimen needs a name — what clinicians call it.' });
    return null;
  }

  const named = `${where} (${name})`;
  const components: ImportRegimenComponent[] = [];

  for (const [index, entry] of (Array.isArray(raw.components) ? raw.components : []).entries()) {
    if (!isObject(entry)) {
      problems.push({ where: `${named}.components[${index}]`, message: 'Each component is an object.' });
      continue;
    }
    const drug = text(entry.drug);
    if (!drug) {
      problems.push({
        where: `${named}.components[${index}]`,
        message: 'A component names a drug.',
      });
      continue;
    }
    const role = text(entry.role) ?? 'component';
    if (!(REGIMEN_ROLES as readonly string[]).includes(role)) {
      problems.push({
        where: `${named}.components[${index}] (${drug})`,
        message: `"${role}" is not a role. Use one of: ${REGIMEN_ROLES.join(', ')}.`,
      });
      continue;
    }
    components.push({ drug, dose: text(entry.dose), role: role as RegimenRole });
  }

  // Two is what makes it a regimen. One drug on its own is that drug's dosing,
  // and storing it as a combination would say something untrue about it.
  if (components.length < 2) {
    problems.push({
      where: named,
      message: 'A regimen needs at least two components. Monotherapy belongs in the drug’s '
        + 'own dosing field.',
    });
    return null;
  }

  return {
    name,
    when: text(raw.when),
    components,
    flow: text(raw.flow),
    notes: text(raw.notes),
    source: text(raw.source),
  };
}

/**
 * Reads a pasted file into the shape above, or into a list of what is wrong.
 *
 * Pure: it can say that a field key is not snake_case but not that the key is
 * unknown, and that a regimen names a drug the file does not carry but not
 * whether the database already holds it. Those are `planDrugImport`'s job.
 */
export function parseDrugImport(raw: string): ParseResult {
  const problems: ImportProblem[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      problems: [{
        where: 'the file',
        message: `That is not valid JSON. ${err instanceof Error ? err.message : ''}`.trim(),
      }],
    };
  }

  if (!isObject(parsed)) {
    return { ok: false, problems: [{ where: 'the file', message: 'The file is one JSON object.' }] };
  }

  if (parsed.format !== IMPORT_FORMAT) {
    return {
      ok: false,
      problems: [{
        where: 'format',
        message: `This reader only understands "${IMPORT_FORMAT}". `
          + `The file says ${JSON.stringify(parsed.format ?? null)}.`,
      }],
    };
  }

  /* --------------------------------------------------------------- scope -- */
  const scope: ImportScope[] = [];
  if (!isObject(parsed.scope)) {
    problems.push({
      where: 'scope',
      message: 'A file needs a scope: the class, the exam, or both.',
    });
  } else {
    // In VARIANT_KINDS order, which is the order they overlay in -- so the
    // narrowest named scope is always last and the widest always first.
    for (const kind of VARIANT_KINDS) {
      const label = text(parsed.scope[kind]);
      if (label) scope.push({ kind, label });
    }
    if (scope.length === 0) {
      problems.push({
        where: 'scope',
        message: 'Neither course nor exam is filled in. Values would have nowhere to land.',
      });
    }
    // Refused rather than ignored, because an author working from an older copy
    // of the guide would otherwise watch a scope they wrote disappear. What the
    // lecture is *about* is an indication, and indications are a field.
    if (text(parsed.scope.topic)) {
      problems.push({
        where: 'scope',
        message: 'A "topic" scope is no longer a thing a tag can be. What the lecture is about '
          + 'belongs in each drug\'s "indications", which is already a field and already an axis '
          + 'in the study scope. Use "course" and "exam".',
      });
    }
  }

  /* -------------------------------------------------------------- source -- */
  const sourceRaw = isObject(parsed.source) ? parsed.source : {};
  const sourceFile = text(sourceRaw.file);
  if (!sourceFile) {
    problems.push({
      where: 'source.file',
      message: 'Name the file these facts were read from. It becomes the provenance on every value.',
    });
  }

  /* --------------------------------------------------------------- write -- */
  const write = text(parsed.write) ?? 'fill';
  if (!(WRITE_MODES as readonly string[]).includes(write)) {
    problems.push({
      where: 'write',
      message: `"${write}" is not a write mode. Use one of: ${WRITE_MODES.join(', ')}.`,
    });
  }

  /* ------------------------------------------------------------- declare -- */
  const declare: ImportFieldDef[] = [];
  for (const [index, entry] of (Array.isArray(parsed.declare) ? parsed.declare : []).entries()) {
    const read = readDeclaration(entry, index, problems);
    if (read) declare.push(read);
  }

  /* --------------------------------------------------------------- drugs -- */
  const drugs: ImportDrug[] = [];
  if (!Array.isArray(parsed.drugs) || parsed.drugs.length === 0) {
    problems.push({ where: 'drugs', message: 'A file with no drugs in it has nothing to import.' });
  } else {
    for (const [index, entry] of parsed.drugs.entries()) {
      const read = readDrug(entry, index, problems);
      if (read) drugs.push(read);
    }
  }

  // Two entries for one drug: refused rather than merged, because one of them
  // would silently win and nobody would know which.
  const byName = new Map<string, number>();
  for (const drug of drugs) {
    const key = drug.generic.toLowerCase();
    byName.set(key, (byName.get(key) ?? 0) + 1);
  }
  for (const [name, count] of byName) {
    if (count > 1) {
      problems.push({
        where: 'drugs',
        message: `"${name}" appears ${count} times. One entry per drug — merge them.`,
      });
    }
  }

  /* ------------------------------------------------------------ regimens -- */
  const regimens: ImportRegimen[] = [];
  for (const [index, entry] of (Array.isArray(parsed.regimens) ? parsed.regimens : []).entries()) {
    const read = readRegimen(entry, index, problems);
    if (read) regimens.push(read);
  }

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    file: {
      scope,
      source: {
        file: sourceFile!,
        deck: text(sourceRaw.deck),
        pages: text(sourceRaw.pages),
        accessed: text(sourceRaw.accessed),
      },
      write: write as WriteMode,
      // The screen's to set: a file names what it is, not what this database
      // needs doing to it. The drug's own profile is the default here rather
      // than *unasked*, because a caller building a file in code -- a script, a
      // test -- has answered by not naming a version; only a screen with the
      // question on it can have left it unanswered.
      target: TARGET_DRUG,
      declare,
      drugs,
      regimens,
      issues: stringList(parsed.issues),
    },
  };
}

/* -------------------------------------------------------------- compose ---- */

/**
 * One regimen, written out for one of its members' `regimen` field.
 *
 * Composed rather than stored once and pointed at, and the trade is in
 * `lib/fields/core-fields.ts`: a regimen table is the right shape for a
 * pharmacy system, and markdown on each member is the right shape for a study
 * app, where the thing being learned is the sentence *this drug appears in
 * these protocols at these doses, chosen on these grounds*. Re-importing
 * rebuilds the text, so the duplication cannot drift.
 *
 * The member's own line is marked, because the point of reading this on
 * dabrafenib's profile is to find dabrafenib's dose in it.
 */
/**
 * What marks the member whose profile this copy of a protocol is on.
 *
 * Exported because the study side takes it back off: a flashcard about FOLFOX
 * is built once, not once per member, so there is no "this drug" for the arrow
 * to point at. See `partsOf` in `lib/study/cards.ts`.
 */
export const OWN_LINE_MARKER = ' ← this drug';

export function renderRegimen(regimen: ImportRegimen, forDrug: string): string {
  const lines: string[] = [`### ${regimen.name}`, ''];

  if (regimen.when) lines.push(regimen.when, '');

  for (const component of regimen.components) {
    const mine = component.drug.toLowerCase() === forDrug.toLowerCase();
    const parts = [component.drug];
    if (component.dose) parts.push(component.dose);
    if (component.role !== 'component') parts.push(`(${component.role})`);
    lines.push(`- ${parts.join(' — ')}${mine ? OWN_LINE_MARKER : ''}`);
  }

  if (regimen.flow) {
    lines.push('', 'Choosing it:', '', regimen.flow.trim());
  }
  if (regimen.notes) lines.push('', regimen.notes);

  return lines.join('\n');
}

/**
 * The whole `regimen` field for one drug: what the file said, then every
 * combination the drug is in.
 *
 * Returns null where there is nothing to say, so the field is left untouched
 * rather than written blank -- `regimen` reads a blank as *this drug is in no
 * named protocol*, which is true of most drugs and is not what an import of a
 * cardiology lecture should assert about them.
 */
export function regimenFieldFor(drug: ImportDrug, regimens: ImportRegimen[]): string | null {
  const names = new Set([drug.generic.toLowerCase(), ...drug.aliases.map((a) => a.toLowerCase())]);
  const mine = regimens.filter((regimen) =>
    regimen.components.some((component) => names.has(component.drug.toLowerCase())));

  const own = drug.fields.regimen?.value ?? null;
  if (mine.length === 0) return own;

  const blocks = mine.map((regimen) => renderRegimen(regimen, drug.generic));
  return [own, ...blocks].filter(Boolean).join('\n\n');
}
