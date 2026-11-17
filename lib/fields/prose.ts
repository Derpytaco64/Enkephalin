/**
 * The little bit of markdown a field's prose is allowed to be.
 *
 * `formatFieldValue` splits a markdown field into paragraphs and that is the
 * right answer for a flashcard, a search haystack and a bulk-set preview --
 * every one of those wants the words and nothing else. It is the wrong answer
 * on a profile for the one shape that arrives nested: a regimen.
 *
 * A combination protocol is a decision before it is a paragraph --
 *
 *     BRAF V600E positive?
 *       Yes -> dabrafenib + trametinib
 *       No  -> ipilimumab + nivolumab
 *
 * -- and run together into one paragraph it stops being readable at all. So
 * this is a parser for exactly three things: a heading, a paragraph, and a
 * list that can nest. No bold, no links, no tables, no code. Not a markdown
 * subset waiting to grow into markdown: the import format tells an author to
 * use these three and nothing else, and what is unsupported stays legible
 * because it falls through as plain text rather than as syntax nobody drew.
 *
 * Deliberately not a library, and deliberately not mermaid. A `graph TD` block
 * needs a renderer, a renderer needs a CDN or a bundle, and this app runs on a
 * box in a cupboard that may have neither. A nested list *is* the flowchart
 * when the flowchart is six nodes deep, and it is the only form that still
 * reads as itself in the raw text, in a backup file, and on a phone.
 */

import { normalizeNewlines } from './format';

export type ProseBlock =
  | { kind: 'heading'; text: string; level: number }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: ProseItem[] };

export type ProseItem = {
  text: string;
  /** 0 is the outermost level. Capped at 3: past that nothing is readable. */
  depth: number;
  /** A numbered item keeps its own marker, because a step is ordered. */
  marker: string | null;
};

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^([ \t]*)[-*•]\s+(.*)$/;
const NUMBERED = /^([ \t]*)(\d+)[.)]\s+(.*)$/;

const MAX_DEPTH = 3;

/** Two spaces, four spaces or a tab: all three mean "one level in". */
function depthOf(indent: string): number {
  const spaces = indent.replace(/\t/g, '  ').length;
  return Math.min(Math.floor(spaces / 2), MAX_DEPTH);
}

/**
 * Blocks in the order they were written.
 *
 * A blank line ends a block, and so does a change of kind: a list that starts
 * under a paragraph does not need the blank line that markdown would want,
 * because the hyphen already said so and an author writing notes will not put
 * one there.
 */
export function parseProse(raw: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let paragraph: string[] = [];
  let items: ProseItem[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
    if (items.length > 0) {
      blocks.push({ kind: 'list', items });
      items = [];
    }
  };

  for (const line of normalizeNewlines(raw).split('\n')) {
    if (line.trim() === '') {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[2].trim(), level: heading[1].length });
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      if (paragraph.length > 0) flush();
      items.push({ text: numbered[3].trim(), depth: depthOf(numbered[1]), marker: `${numbered[2]}.` });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      if (paragraph.length > 0) flush();
      items.push({ text: bullet[2].trim(), depth: depthOf(bullet[1]), marker: null });
      continue;
    }

    // A plain line that follows a list item is that item's own continuation,
    // not a new paragraph: an author wrapping a long step mid-sentence means
    // one step, and starting a paragraph there would break the list in two.
    if (items.length > 0) {
      const last = items[items.length - 1];
      items[items.length - 1] = { ...last, text: `${last.text} ${line.trim()}` };
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}

/** A heading and everything written under it, so the whole lot can fold. */
export type ProseSection = {
  kind: 'section';
  heading: string;
  level: number;
  /**
   * The paragraph the section opens with, which is what it is *for*.
   *
   * Held apart from the body so a folded section can show it beside its name.
   * The regimen field is why: a heading there is the drugs in a protocol and
   * the paragraph under it is the indication, so three of ceftriaxone's four
   * protocols collapse to *Ceftriaxone + doxycycline*, *Ceftriaxone +
   * azithromycin*, *Ceftriaxone + doxycycline + metronidazole* -- names that
   * are nearly the same and never the thing you are picking by, which is
   * gonorrhea, gonorrhea in pregnancy, or pelvic inflammatory disease.
   *
   * Only a paragraph, only the first one, and only where it opens the section.
   * That is an authoring convention rather than a syntax, so it is read where
   * it is kept and ignored where it is not: all 324 regimen sections in the
   * library open this way and none of the 117 in `dosing`, `ae` and
   * `monitoring` do -- those open with a list and get a null here, which draws
   * exactly as it did before.
   */
  lede: string | null;
  body: ProseNode[];
};

export type ProseNode = ProseBlock | ProseSection;

/**
 * The same blocks, with each heading holding its own contents.
 *
 * A heading in a regimen is not decoration, it is the name of a protocol, and
 * carboplatin's regimen is nineteen of them in eight thousand characters. Flat
 * blocks make that one unbroken scroll with no way to skip a protocol you are
 * not studying, so a heading owns what follows it until the next heading at
 * its own level or shallower -- which is what lets a profile draw it folded.
 *
 * Text written before any heading belongs to no section and stays where it is:
 * it is the sentence that introduces the protocols, and hiding it behind a
 * triangle would hide the first thing to read.
 *
 * A section's own opening paragraph comes out of its body as its `lede`, so a
 * shut section can still say what it is for. That is the same argument one
 * level down: a fold is only useful if what you are choosing between is
 * visible on the outside of it.
 */
export function groupProse(blocks: ProseBlock[]): ProseNode[] {
  const root: ProseNode[] = [];
  const open: ProseSection[] = [];
  const into = () => (open.length > 0 ? open[open.length - 1].body : root);

  for (const block of blocks) {
    if (block.kind !== 'heading') {
      // The paragraph a section opens with is its subtitle, not its first
      // sentence of content: taken once, and only while nothing else has
      // landed under the heading yet.
      const section = open.length > 0 ? open[open.length - 1] : null;
      if (section && block.kind === 'paragraph' && section.lede === null && section.body.length === 0) {
        section.lede = block.text;
        continue;
      }
      into().push(block);
      continue;
    }

    // A deeper heading nests, a same-or-shallower one closes what it follows.
    while (open.length > 0 && open[open.length - 1].level >= block.level) open.pop();

    const section: ProseSection = {
      kind: 'section', heading: block.text, level: block.level, lede: null, body: [],
    };
    into().push(section);
    open.push(section);
  }

  return root;
}

/** One top-level heading of a prose field, and the raw text written under it. */
export type ProseSlice = { heading: string; text: string };

/**
 * A prose field cut into its named pieces, or empty where it has none.
 *
 * The regimen field is the reason: a heading in it is the **name of a
 * protocol**, and carboplatin's is nineteen of them in eight thousand
 * characters. One flashcard for the lot is a card nobody can grade -- you
 * either know all nineteen or you do not -- so each one is asked on its own.
 * See `partsOf` in `lib/study/cards.ts`.
 *
 * Cut at the **shallowest** heading level present rather than at a fixed one,
 * so a field written with `##` splits the same way as one written with `###`,
 * and a deeper heading inside a protocol stays part of that protocol.
 *
 * **Nothing is returned where words come before the first heading.** Those
 * words introduce all of the protocols and belong to none of them; splitting
 * would either orphan them or repeat them on every piece, and asking the field
 * whole is the honest answer for prose shaped that way.
 */
export function splitSections(raw: string): ProseSlice[] {
  const lines = normalizeNewlines(raw).split('\n');
  const found = lines
    .map((line, at) => ({ at, heading: HEADING.exec(line) }))
    .filter((row): row is { at: number; heading: RegExpExecArray } => row.heading !== null);

  if (found.length === 0) return [];

  const top = Math.min(...found.map((row) => row.heading[1].length));
  const starts = found.filter((row) => row.heading[1].length === top);

  if (lines.slice(0, starts[0].at).join('\n').trim() !== '') return [];

  return starts
    .map((start, index) => {
      const ends = index + 1 < starts.length ? starts[index + 1].at : lines.length;
      return {
        heading: start.heading[2].trim(),
        text: lines.slice(start.at + 1, ends).join('\n').trim(),
      };
    })
    // A heading with nothing under it is a name, not an answer.
    .filter((slice) => slice.heading !== '' && slice.text !== '');
}
