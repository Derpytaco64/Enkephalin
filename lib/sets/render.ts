/**
 * Showing a cell that was written in several parts.
 *
 * `docs/set-format.md` tells an author to break a long answer with `<br>`
 * rather than running it together with semicolons, which puts a small
 * requirement on this side: **there is no markdown library in this project at
 * all.** A `markdown` field is split on blank lines by `formatFieldValue` and
 * rendered as `<p>{paragraph}</p>`, which React escapes -- so a literal `<br>`
 * would reach a reader as four characters.
 *
 * Two properties matter, and each has a test:
 *
 * - **The split is presentational only.** A cell is still one answer, so
 *   `answerKey`, the distractor pool and the alias folding see the whole value
 *   and never a line of it. Nothing in this file is called by the quiz builder.
 * - **Nothing is ever injected as HTML.** Accepting one tag from an imported
 *   file is how a format grows an XSS hole, so the tag is *recognised and
 *   discarded*, never passed through: the return is plain strings that React
 *   escapes like any other text.
 */

/**
 * Where an author may break a line. A real newline is treated identically,
 * because a JSON string can carry one and an author who writes `\n` means the
 * same thing as one who writes `<br>`.
 */
const BREAK = /\s*(?:<br\s*\/?>|\r?\n)\s*/i;

/**
 * Splits a cell into the lines it was written as.
 *
 * Always at least one entry for a non-empty cell, so a caller can render the
 * result the same way whether the author broke the line or not.
 */
export function cellLines(text: string | null | undefined): string[] {
  if (!text) return [];
  const lines = text.split(BREAK).map((line) => line.trim()).filter((line) => line !== '');
  return lines.length > 0 ? lines : [];
}

/** Whether a cell was written in more than one part. */
export function isMultiline(text: string | null | undefined): boolean {
  return cellLines(text).length > 1;
}

/**
 * The cell as one line of plain text, for somewhere there is no room to break
 * -- a table column, a card's one-line summary.
 *
 * Joined with a middot rather than a space: the parts were written apart on
 * purpose, and running them together reads as one garbled sentence, which is
 * the thing `<br>` was introduced to stop.
 */
export function cellOneLine(text: string | null | undefined): string {
  return cellLines(text).join(' · ');
}
