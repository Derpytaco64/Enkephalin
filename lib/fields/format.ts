import type { FieldValue } from '@/db/schema';
import type { FieldDef } from './registry';

/**
 * `none` and `missing` are the distinction the whole field system turns on.
 * An empty black box warning means the drug has none — a fact worth showing
 * and worth quizzing. An empty mechanism of action means nobody has filled it
 * in yet. Collapsing the two would both hide real answers and invent work.
 */
export type FormattedField =
  | { kind: 'none' }
  | { kind: 'missing' }
  | { kind: 'text'; text: string }
  | { kind: 'markdown'; paragraphs: string[] }
  | { kind: 'list'; items: string[] }
  | { kind: 'enum'; option: string }
  | { kind: 'number'; text: string }
  | { kind: 'bool'; value: boolean };

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0']);

/** Multi-line for authored content, semicolons for values that arrive inline. */
export function splitList(raw: string) {
  const parts = raw.includes('\n') ? raw.split('\n') : raw.split(';');
  return parts.map((part) => part.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
}

export function formatFieldValue(def: FieldDef, value: FieldValue | undefined): FormattedField {
  const raw = value?.value?.trim() ?? '';

  if (!raw) {
    // An explicit "none" outranks the field's default, so one drug can be
    // marked as having nothing to record on a field that is usually a gap.
    if (value?.status === 'none' || def.blankMeansNone) return { kind: 'none' };
    return { kind: 'missing' };
  }

  switch (def.dataType) {
    case 'list':
      return { kind: 'list', items: splitList(raw) };

    case 'enum':
      return { kind: 'enum', option: raw };

    case 'number': {
      const parsed = Number(raw);
      // Unparseable numbers show as themselves rather than vanishing: bad data
      // should be visible to whoever can fix it.
      return Number.isFinite(parsed) ? { kind: 'number', text: String(parsed) } : { kind: 'text', text: raw };
    }

    case 'bool': {
      const word = raw.toLowerCase();
      if (TRUE_WORDS.has(word)) return { kind: 'bool', value: true };
      if (FALSE_WORDS.has(word)) return { kind: 'bool', value: false };
      return { kind: 'text', text: raw };
    }

    case 'markdown': {
      const paragraphs = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      return { kind: 'markdown', paragraphs };
    }

    default:
      return { kind: 'text', text: raw };
  }
}

/** What to show in place of a value, so the two empties never read alike. */
export function emptyLabel(kind: 'none' | 'missing', def: FieldDef) {
  if (kind === 'none') return def.dataType === 'enum' ? 'Not controlled' : 'None';
  return 'Not recorded yet';
}
