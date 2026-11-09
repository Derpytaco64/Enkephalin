/**
 * Reading several set files at once.
 *
 * Nine endocrine decks arrive as nine files, and importing them one at a time
 * through a form that holds one file is the kind of chore that stops you
 * writing the tenth. This is the layer above `parseSet`: it reads a list of
 * files and says, per file, what would happen -- without touching the
 * database, which is what makes the two policy decisions below testable.
 *
 * **A file is still the unit of success.** `parseSet` refuses a whole file
 * rather than importing the good half of it, and a batch keeps that shape one
 * level up: each file stands or falls alone, and one bad file does not stop
 * the good ones. The alternative -- refuse the batch if any file is wrong --
 * sounds tidier and is worse in practice: eight decks held hostage by a typo
 * in the ninth, with nothing to show for the run.
 *
 * **Except a slug collision, which refuses the batch.** Two files claiming the
 * same set are not two imports, they are a race: whichever is read second
 * wins, and in `replace` mode it deletes the rows the first one just wrote.
 * The outcome would depend on the order the file picker happened to hand them
 * over, which is not a thing a person can reason about -- so nothing is
 * written and both files are named.
 */
import { parseSet, type ParsedSet, type SetProblem } from './format.ts';

/** One file, as it arrives from the form. */
export type SetInput = {
  /** What to call it in the report. A filename, or something like `pasted`. */
  name: string;
  text: string;
};

export type ParsedEntry = { name: string; ok: true; set: ParsedSet };

export type FailedEntry =
  /** It parsed as JSON but is not a valid set. Every problem, not the first. */
  | { name: string; ok: false; problems: SetProblem[] }
  /** It never got as far as parsing, or the batch refused it. */
  | { name: string; ok: false; message: string };

export type BatchEntry = ParsedEntry | FailedEntry;

/**
 * Parses every file, then applies the collision rule.
 *
 * Order is preserved: the report reads in the order the files were given,
 * which is the order a person listed them.
 */
export function parseBatch(inputs: SetInput[]): BatchEntry[] {
  const entries: BatchEntry[] = inputs.map(readOne);

  // Which slugs more than one file claims. Counted over the files that parsed,
  // since a file that failed has no slug to collide with.
  const claims = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.ok) continue;
    claims.set(entry.set.slug, (claims.get(entry.set.slug) ?? 0) + 1);
  }

  return entries.map((entry) => {
    if (!entry.ok) return entry;
    if ((claims.get(entry.set.slug) ?? 0) < 2) return entry;

    const others = entries
      .filter((other): other is ParsedEntry =>
        other.ok && other.set.slug === entry.set.slug && other.name !== entry.name)
      .map((other) => other.name);

    return {
      name: entry.name,
      ok: false,
      message: `Two files in this batch are the set "${entry.set.slug}"`
        + `${others.length > 0 ? ` -- this one and ${others.join(', ')}` : ''}.`
        + ' Which one won would depend on the order they were read, so neither'
        + ' was imported. Rename one slug, or import them separately.',
    };
  });
}

/** One file: JSON, then set. The two failures read differently on purpose. */
function readOne(input: SetInput): BatchEntry {
  const text = input.text.trim();
  if (!text) {
    return { name: input.name, ok: false, message: 'The file is empty.' };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    // The position is the one useful thing about a JSON syntax error, and the
    // thing a generic "invalid file" throws away.
    return {
      name: input.name,
      ok: false,
      message: `That is not valid JSON. ${error instanceof Error ? error.message : ''}`.trim(),
    };
  }

  const parsed = parseSet(json);
  return parsed.ok
    ? { name: input.name, ok: true, set: parsed.set }
    : { name: input.name, ok: false, problems: parsed.problems };
}
