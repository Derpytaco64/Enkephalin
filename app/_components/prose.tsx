import { groupProse, parseProse, type ProseItem, type ProseNode } from '@/lib/fields/prose';

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
 * The blocks of one level, with every heading drawn as something that folds.
 *
 * `startOpen` is the caller's judgement about whether folding helps here. A
 * regimen with one protocol is already short, so hiding it only adds a click;
 * a regimen with several is the thing we are trying to make scrollable, so
 * those start shut and the headings become the list you pick from. A nested
 * section always starts open, because its parent is already hiding it and two
 * triangles to reach one dose is a worse answer than a long open section.
 */
function Nodes({ nodes, startOpen }: { nodes: ProseNode[]; startOpen: boolean }) {
  return (
    <div className="space-y-2 leading-relaxed">
      {nodes.map((node, index) => {
        // Index in the key: these are positional lines of one text, and two
        // identical steps in a taper are a real thing to write.
        const key = `${node.kind}-${index}`;

        if (node.kind === 'section') {
          return (
            <details key={key} open={startOpen} className="group rounded border border-[var(--border)]">
              <summary className="cursor-pointer px-3 py-2">
                <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  {node.heading}
                </span>

                {/*
                  What the protocol is for, beside its name, because the names
                  do not tell three of ceftriaxone's four apart and the
                  indications do. Two lines while it is shut and all of it once
                  it is open -- clamped rather than cut, so nothing is lost and
                  no sentence is chopped mid-abbreviation (*S. aureus*,
                  *P. aeruginosa*: there is no safe place to split on a full
                  stop in this library).
                */}
                {node.lede !== null && (
                  <span className="mt-0.5 line-clamp-2 text-sm text-[var(--muted)] group-open:line-clamp-none">
                    {node.lede}
                  </span>
                )}
              </summary>

              <div className="border-t border-[var(--border)] px-3 pb-3 pt-2">
                <Nodes nodes={node.body} startOpen />
              </div>
            </details>
          );
        }
        if (node.kind === 'paragraph') return <p key={key}>{node.text}</p>;
        if (node.kind === 'heading') {
          // Only reachable if grouping ever hands a heading back ungrouped;
          // drawn the way it always was rather than dropped.
          return (
            <p key={key} className="pt-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              {node.text}
            </p>
          );
        }

        return (
          <ul key={key} className="space-y-1">
            {node.items.map((item, at) => <Item key={`${at}-${item.text}`} item={item} />)}
          </ul>
        );
      })}
    </div>
  );
}

/**
 * A markdown field, drawn as the headings, paragraphs and nested lists it is.
 *
 * Profiles **and the study screens**. It was profiles only, on the reasoning
 * that a card wants the words in a row; that was wrong about the one field
 * whose shape is the answer -- a regimen read `- Oxaliplatin --- 85 mg/m2 IV
 * day 1` with its hyphens showing, and a decision tree arrived as one
 * paragraph. A search index and a bulk-set preview still want the flat form,
 * which is what `formatFieldValue` goes on giving them.
 *
 * `fold` is for where a `<details>` cannot go: inside a quiz option, which is
 * a button, and inside a prompt, which is a question rather than a document.
 * The headings are then drawn as headings and everything stays open.
 */
export function Prose({ text, fold = true, sort = false }: {
  text: string;
  fold?: boolean;
  /**
   * Order the folded sections by name instead of by where they were written.
   *
   * For the two fields whose sections are a **set** rather than a sequence:
   * dosing, whose headings are indications, and regimen, whose headings are
   * protocol names. Nineteen of either in the order three lectures happened to
   * mention them is a list you read end to end to find one entry; alphabetical
   * is a list you can land in.
   *
   * Off everywhere else, and off by default, because a heading can just as
   * easily be a step: sorting "Induction, Consolidation, Maintenance" into
   * "Consolidation, Induction, Maintenance" would be telling a lie about the
   * order of treatment. The caller knows which field it is holding; this
   * component does not.
   */
  sort?: boolean;
}) {
  const blocks = parseProse(text);
  if (!fold) return <Nodes nodes={blocks} startOpen />;

  const grouped = groupProse(blocks);
  const sections = grouped.filter((node) => node.kind === 'section').length;

  // Only the sections move. Anything before the first heading introduces all
  // of them and belongs where it was put.
  const nodes = sort
    ? [
      ...grouped.filter((node) => node.kind !== 'section'),
      ...grouped
        .filter((node) => node.kind === 'section')
        .sort((a, b) => a.heading.localeCompare(b.heading, undefined, { sensitivity: 'base' })),
    ]
    : grouped;

  return <Nodes nodes={nodes} startOpen={sections < 2} />;
}
