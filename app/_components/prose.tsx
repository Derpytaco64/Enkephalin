import { parseProse, type ProseItem } from '@/lib/fields/prose';

/** One step in from its parent, enough to read as nesting and no more. */
const INDENT = ['pl-0', 'pl-4', 'pl-8', 'pl-12'] as const;

/**
 * A bullet for a plain item, the author's own number for a step.
 *
 * The marker sits outside the text so a wrapped line lines up under its own
 * first word -- the same rule the list fields follow on a profile.
 */
function Item({ item }: { item: ProseItem }) {
  return (
    <li className={`flex gap-2 ${INDENT[item.depth]}`}>
      <span aria-hidden="true" className="select-none text-[var(--muted)]">
        {item.marker ?? (item.depth === 0 ? '•' : '–')}
      </span>
      <span className="min-w-0">{item.text}</span>
    </li>
  );
}

/**
 * A markdown field, drawn as the headings, paragraphs and nested lists it is.
 *
 * Profiles only. A card, a search index and a bulk-set preview all want the
 * words in a row, which is what `formatFieldValue` gives them; this is the one
 * place where the shape of the text carries meaning -- a regimen's decision
 * tree, a taper's steps -- and flattening it there loses the answer.
 */
export function Prose({ text }: { text: string }) {
  const blocks = parseProse(text);

  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((block, index) => {
        // Index as key: these are positional lines of one text, and two
        // identical steps in a taper are a real thing to write.
        const key = `${block.kind}-${index}`;

        if (block.kind === 'heading') {
          return (
            <p key={key} className="pt-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              {block.text}
            </p>
          );
        }
        if (block.kind === 'paragraph') return <p key={key}>{block.text}</p>;

        return (
          <ul key={key} className="space-y-1">
            {block.items.map((item, at) => <Item key={`${at}-${item.text}`} item={item} />)}
          </ul>
        );
      })}
    </div>
  );
}
