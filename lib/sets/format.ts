/**
 * Reading an `enkephalin.set/1` file.
 *
 * **It refuses rather than guesses, and refuses the whole file.** That is the
 * dosing parser's rule one level up, and it is what makes a format safe to
 * point at a file somebody else wrote: a half-imported set is a set whose gaps
 * nobody knows about, and a *coerced* cell is a wrong answer in somebody's
 * quiz. Every refusal names the row and the column, because "that file is
 * invalid" is not a message anyone can act on.
 *
 * Pure: no database, no clock, no io. It turns unknown JSON into either a
 * `ParsedSet` or a list of problems, which is what lets the whole refusal list
 * be tested without a container.
 *
 * `docs/set-format.md` is the authoring guide for this file and the two have to
 * stay in step. Where they disagree, the guide is what somebody was handed, so
 * the guide is right and this is the bug.
 */
import {
  defaultDataType, isAnswerType, reversibleByDefault, type AnswerType,
} from './vocabulary';

export const SET_FORMAT = 'enkephalin.set/1';

const DATA_TYPES = ['text', 'markdown', 'enum', 'list', 'number', 'bool'] as const;
export type SetDataType = (typeof DATA_TYPES)[number];

export type ParsedField = {
  key: string;
  label: string;
  dataType: SetDataType;
  answersType: AnswerType | null;
  enumOptions: string[] | null;
  prompt: string | null;
  asks: boolean;
  reversible: boolean;
  measuredIn: string | null;
  ordinal: boolean;
  sortOrder: number;
};

export type ParsedItem = {
  name: string;
  slug: string;
  kind: string;
  aliases: string[];
  sequence: string | null;
  sequenceOrder: number | null;
  recallOnly: boolean;
  /** Column key to cell text. A `list` cell arrives joined by newline. */
  values: Record<string, string>;
  sortOrder: number;
};

export type ParsedSet = {
  slug: string;
  name: string;
  course: string | null;
  exam: string | null;
  unit: string | null;
  topic: string | null;
  sourceFile: string | null;
  sourcePages: string | null;
  identityKey: string;
  identityLabel: string;
  identityKind: string;
  groupKey: string | null;
  kinds: string[];
  fields: ParsedField[];
  items: ParsedItem[];
};

/** Where a problem is, in the words the file itself uses. */
export type SetProblem = {
  /** `items[3].mechanism`, `fields[1].answers`, `group` -- a path into the file. */
  at: string;
  message: string;
};

export type ParseResult =
  | { ok: true; set: ParsedSet }
  | { ok: false; problems: SetProblem[] };

/* ----------------------------------------------------------------- bits -- */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * The slug a row is stored under.
 *
 * Derived from the name rather than asked for, because an author writing a
 * table of nine hormones should not also be inventing nine keys -- and the
 * identity value is already required to be unique within the set, so there is
 * nothing a separate key would buy.
 */
export function itemSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * How a cell is read into one string.
 *
 * A `list` column may arrive as a JSON array, which is the shape the guide
 * teaches, and is stored newline-joined -- the same spelling `splitList` reads
 * one table over, so the field formatter needs no special case for sets.
 */
function cellText(raw: unknown, dataType: SetDataType): string | null {
  if (raw === null || raw === undefined) return null;

  if (Array.isArray(raw)) {
    const parts = raw.map((part) => str(part)).filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join('\n') : null;
  }
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : null;

  const text = str(raw);
  if (text === null) return null;
  // A single string in a list column is one item, not a parse target: splitting
  // on a comma here would turn "Diabetes, type 2" into two indications.
  if (dataType === 'list') return text;
  return text;
}

/* ---------------------------------------------------------------- parse -- */

export function parseSet(input: unknown): ParseResult {
  const problems: SetProblem[] = [];
  const fail = (at: string, message: string) => problems.push({ at, message });

  if (!isObject(input)) {
    return { ok: false, problems: [{ at: 'file', message: 'That is not a set: the file has to be a JSON object.' }] };
  }

  // The format marker first and alone. A file that does not claim to be one of
  // ours gets one clear refusal rather than forty confusing ones.
  const format = str(input.format);
  if (format !== SET_FORMAT) {
    return {
      ok: false,
      problems: [{
        at: 'format',
        message: format
          ? `This says "${format}". A set has to say "${SET_FORMAT}".`
          : `No "format" key. A set has to say "${SET_FORMAT}".`,
      }],
    };
  }

  const slug = str(input.slug);
  if (!slug) fail('slug', 'Every set needs a slug: a short kebab-case name, unique across sets.');
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    fail('slug', `"${slug}" is not kebab-case. Lower case, digits and single hyphens.`);
  }

  const name = str(input.name);
  if (!name) fail('name', 'Every set needs a name: what a person reading it sees.');

  /* -- identity ------------------------------------------------------- */

  const identity = isObject(input.identity) ? input.identity : null;
  if (!identity) fail('identity', 'Every set needs an identity: which column names the subject.');

  const identityKey = identity ? str(identity.key) : null;
  const identityLabel = identity ? str(identity.label) : null;
  const identityKind = identity ? str(identity.kind) : null;
  if (identity && !identityKey) fail('identity.key', 'Which property on each item holds its name?');
  if (identity && !identityKind) {
    fail('identity.kind', 'What sort of thing are these rows? A kind, declared in "kinds".');
  }

  /* -- kinds ---------------------------------------------------------- */

  const rawKinds = Array.isArray(input.kinds) ? input.kinds : null;
  if (!rawKinds) fail('kinds', 'Declare every kind your items use, as a list.');
  const kinds = (rawKinds ?? [])
    .map((kind) => str(kind))
    .filter((kind): kind is string => kind !== null);
  if (rawKinds && kinds.length === 0) fail('kinds', '"kinds" is empty. Declare at least one.');

  // Declared up front means declared: the set's own default has to be in there
  // too, or the first row silently uses a kind the set says it does not have.
  if (identityKind && kinds.length > 0 && !kinds.includes(identityKind)) {
    fail('identity.kind', `"${identityKind}" is not in "kinds": [${kinds.join(', ')}].`);
  }

  /* -- fields --------------------------------------------------------- */

  const rawFields = Array.isArray(input.fields) ? input.fields : null;
  if (!rawFields) fail('fields', 'Declare your columns, as a list.');

  const fields: ParsedField[] = [];
  const seenKeys = new Set<string>();

  (rawFields ?? []).forEach((raw, index) => {
    const at = `fields[${index}]`;
    if (!isObject(raw)) {
      fail(at, 'A column has to be an object.');
      return;
    }

    const key = str(raw.key);
    const label = str(raw.label);
    if (!key) {
      fail(`${at}.key`, 'A column needs a key: the property name on each item.');
      return;
    }
    if (seenKeys.has(key)) {
      fail(`${at}.key`, `Two columns are both called "${key}".`);
      return;
    }
    seenKeys.add(key);

    const asks = raw.asks === undefined ? true : raw.asks !== false;

    const rawAnswers = raw.answers === undefined || raw.answers === null ? null : raw.answers;
    let answersType: AnswerType | null = null;
    if (rawAnswers !== null && !isAnswerType(rawAnswers)) {
      // Named rather than listed: the vocabulary is 26 entries and dumping it
      // into an error message buries the one thing that is wrong.
      fail(`${at}.answers`, `"${String(rawAnswers)}" is not an answer type. See docs/set-format.md.`);
    } else if (isAnswerType(rawAnswers)) {
      answersType = rawAnswers;
    }

    // The rule that stops a Notes column becoming a terrible question: a column
    // either says what kind of answer it holds, or says it is not an answer.
    if (asks && answersType === null) {
      fail(
        `${at}.answers`,
        `"${key}" is asked but says nothing about what it holds. Give it an "answers" type, or "asks": false.`,
      );
    }

    const statedType = str(raw.type);
    if (statedType && !(DATA_TYPES as readonly string[]).includes(statedType)) {
      fail(`${at}.type`, `"${statedType}" is not a type. One of: ${DATA_TYPES.join(', ')}.`);
    }
    const dataType: SetDataType = (statedType && (DATA_TYPES as readonly string[]).includes(statedType)
      ? statedType
      : answersType
        ? defaultDataType(answersType)
        : 'text') as SetDataType;

    const rawOptions = Array.isArray(raw.options) ? raw.options : null;
    const enumOptions = rawOptions
      ? rawOptions.map((option) => str(option)).filter((option): option is string => option !== null)
      : null;
    if (dataType === 'enum' && (!enumOptions || enumOptions.length === 0)) {
      fail(`${at}.options`, `"${key}" is an enum and needs its allowed values.`);
    }

    fields.push({
      key,
      label: label ?? key,
      dataType,
      answersType,
      enumOptions: dataType === 'enum' ? enumOptions : null,
      prompt: str(raw.prompt),
      asks,
      reversible: typeof raw.reversible === 'boolean'
        ? raw.reversible
        : answersType !== null && reversibleByDefault(answersType),
      measuredIn: str(raw.measured_in),
      ordinal: raw.ordinal === true,
      sortOrder: index,
    });
  });

  /* -- group ---------------------------------------------------------- */

  const groupKey = str(input.group);
  if (groupKey && !seenKeys.has(groupKey)) {
    fail('group', `"${groupKey}" is not one of your columns, so nothing can be grouped by it.`);
  }

  /* -- items ---------------------------------------------------------- */

  const rawItems = Array.isArray(input.items) ? input.items : null;
  if (!rawItems) fail('items', 'A set needs its rows, as a list.');
  if (rawItems && rawItems.length === 0) fail('items', 'This set has no rows in it.');

  const items: ParsedItem[] = [];
  const seenNames = new Map<string, number>();
  const seenSlugs = new Map<string, number>();
  const seenAliases = new Map<string, string>();
  const seenPositions = new Map<string, number>();
  const byKey = new Map(fields.map((field) => [field.key, field]));

  (rawItems ?? []).forEach((raw, index) => {
    const at = `items[${index}]`;
    if (!isObject(raw)) {
      fail(at, 'A row has to be an object.');
      return;
    }

    const itemName = identityKey ? str(raw[identityKey]) : null;
    if (!itemName) {
      fail(
        identityKey ? `${at}.${identityKey}` : at,
        identityKey
          ? `This row has no "${identityKey}", so there is nothing to call it.`
          : 'This row has no name.',
      );
      return;
    }

    const lowered = itemName.toLowerCase();
    const clash = seenNames.get(lowered);
    if (clash !== undefined) {
      fail(`${at}.${identityKey}`, `"${itemName}" is already row ${clash}. Two rows cannot be the same thing.`);
      return;
    }
    seenNames.set(lowered, index);

    const slugged = itemSlug(itemName);
    if (!slugged) {
      fail(`${at}.${identityKey}`, `"${itemName}" has no letters or digits in it, so it cannot be addressed.`);
      return;
    }
    const slugClash = seenSlugs.get(slugged);
    if (slugClash !== undefined) {
      // Different words, same slug -- which would collide in the database and
      // in a URL. Caught here, where the file can still say which two rows.
      fail(
        `${at}.${identityKey}`,
        `"${itemName}" and row ${slugClash} both shorten to "${slugged}". Make one of them distinct.`,
      );
      return;
    }
    seenSlugs.set(slugged, index);

    const kind = str(raw.kind) ?? identityKind ?? '';
    if (kinds.length > 0 && kind && !kinds.includes(kind)) {
      fail(`${at}.kind`, `"${kind}" is not in "kinds": [${kinds.join(', ')}].`);
    }

    const rawAliases = Array.isArray(raw.aliases) ? raw.aliases : [];
    const aliases: string[] = [];
    for (const rawAlias of rawAliases) {
      const alias = str(rawAlias);
      if (!alias) continue;
      const aliasKey = alias.toLowerCase();

      // An alias claimed by two rows is two right answers in one question,
      // which is the exact failure aliases exist to prevent.
      const owner = seenAliases.get(aliasKey);
      if (owner !== undefined && owner !== lowered) {
        fail(`${at}.aliases`, `"${alias}" is already an alias of "${owner}".`);
        continue;
      }
      // And an alias that is another row's name is the same problem wearing a
      // different hat.
      const asName = seenNames.get(aliasKey);
      if (asName !== undefined && asName !== index) {
        fail(`${at}.aliases`, `"${alias}" is already the name of row ${asName}.`);
        continue;
      }
      seenAliases.set(aliasKey, lowered);
      aliases.push(alias);
    }

    /* -- sequence -- */

    const sequence = str(raw.sequence);
    const rawOrder = raw.order;
    const hasOrder = rawOrder !== undefined && rawOrder !== null;
    const order = typeof rawOrder === 'number' && Number.isInteger(rawOrder) ? rawOrder : null;

    if (hasOrder && order === null) {
      fail(`${at}.order`, `"${String(rawOrder)}" is not a whole number.`);
    }
    if (hasOrder && !sequence) {
      // One set holds more than one sequence -- T4 synthesis and the GPCR
      // cascade are both "Step / Detail" tables -- so a bare position would
      // silently interleave them.
      fail(`${at}.order`, 'An "order" needs a "sequence" to be ordered within.');
    }
    if (sequence && !hasOrder) {
      fail(`${at}.sequence`, `"${sequence}" needs an "order": which step this is.`);
    }
    if (sequence && order !== null) {
      const positionKey = `${sequence} ${order}`;
      const taken = seenPositions.get(positionKey);
      if (taken !== undefined) {
        fail(`${at}.order`, `Row ${taken} is already position ${order} of "${sequence}".`);
      } else {
        seenPositions.set(positionKey, index);
      }
    }

    /* -- cells -- */

    const values: Record<string, string> = {};
    for (const [key, raw2] of Object.entries(raw)) {
      // The structural keys are not columns, and the identity column is stored
      // as the row's name rather than twice.
      if (['kind', 'aliases', 'sequence', 'order', 'recall_only'].includes(key)) continue;
      if (key === identityKey) continue;

      const field = byKey.get(key);
      if (!field) {
        fail(`${at}.${key}`, `There is no column called "${key}". Declare it in "fields" or remove it.`);
        continue;
      }

      const text = cellText(raw2, field.dataType);
      if (text === null) continue;

      if (field.dataType === 'enum' && field.enumOptions) {
        // Not coerced and not dropped: a cell outside its own options is
        // either a typo or a missing option, and both want a human.
        if (!field.enumOptions.includes(text)) {
          fail(
            `${at}.${key}`,
            `"${text}" is not one of ${field.label}'s options: ${field.enumOptions.join(', ')}.`,
          );
          continue;
        }
      }

      if (field.dataType === 'number' && !Number.isFinite(Number(text))) {
        fail(`${at}.${key}`, `${field.label} is a number column and "${text}" is not one.`);
        continue;
      }

      values[key] = text;
    }

    items.push({
      name: itemName,
      slug: slugged,
      kind,
      aliases,
      sequence: sequence && order !== null ? sequence : null,
      sequenceOrder: sequence && order !== null ? order : null,
      recallOnly: raw.recall_only === true,
      values,
      sortOrder: index,
    });
  });

  if (problems.length > 0) return { ok: false, problems };

  const source = isObject(input.source) ? input.source : null;

  return {
    ok: true,
    set: {
      slug: slug!,
      name: name!,
      course: str(input.course),
      exam: str(input.exam),
      unit: str(input.unit),
      topic: str(input.topic),
      sourceFile: source ? str(source.file) : null,
      sourcePages: source ? str(source.pages) : null,
      identityKey: identityKey!,
      identityLabel: identityLabel ?? identityKey!,
      identityKind: identityKind!,
      groupKey,
      kinds,
      fields,
      items,
    },
  };
}
