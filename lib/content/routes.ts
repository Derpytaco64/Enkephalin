/**
 * Administration route, read only from what the source actually says.
 *
 * A drug's name may state it ("Diclofenac (topical)") and dosing text usually
 * names it ("20 mg by mouth three times a day"). Where neither does -- an
 * infusion given as "0.2-1.5 mcg/kg/hour", or an insulin whose text never says
 * subcutaneous -- this returns nothing rather than inferring from clinical
 * knowledge. Those land in the "still blank" worklist for a human, which is
 * the same rule the importer follows for drug class.
 */

export const ROUTES = [
  'Oral',
  'IV',
  'IM',
  'Subcutaneous',
  // A category rather than a specific route, but the sheet names some products
  // that way and discarding what the source states would be worse.
  'Parenteral',
  'Inhaled',
  'Topical',
  'Transdermal',
  'Ophthalmic',
  'Nasal',
  'Otic',
  'Vaginal',
  'Rectal',
] as const;

export type Route = (typeof ROUTES)[number];

/** Ordered: the first match that fires claims the text it matched. */
const PATTERNS: [Route, RegExp][] = [
  // Ophthalmic before topical, or "apply ... to the eye" reads as topical.
  ['Ophthalmic', /\bophthalmic\b|conjunctival|\beyes?\b|\beach eye\b/i],
  ['Otic', /\botic\b|\bear canal\b|\binto the ear\b/i],
  ['Nasal', /\bnasal\b|\bnostrils?\b|\bintranasal\b/i],
  ['Inhaled', /\binhal\w*|\bpuffs?\b|\bnebuliz\w*|\bvia (?:the )?inhaler\b/i],
  ['Transdermal', /\btransdermal\b|\bpatch(?:es)?\b/i],
  ['Vaginal', /\bvaginal\w*\b|\bintravaginal\b/i],
  ['Rectal', /\brectal\w*\b|\bsupposit\w*/i],
  ['Subcutaneous', /\bsubcutaneous\w*\b|\bsub-?q\b|\bsubcut\b/i],
  ['Parenteral', /\bparenteral\w*\b/i],
  // Schedule IV is a controlled-substance class, not a route.
  ['IV', /(?<!schedule )\bIV\b|\bintraven\w*/i],
  ['IM', /\bIM\b|\bintramuscular\w*/i],
  ['Oral', /\bby mouth\b|\borally\b|\boral\b|\bPO\b|\bswish\b/i],
  ['Topical', /\btopical\w*\b|\bapply\b|\bto the (?:skin|affected area)\b/i],
];

function match(text: string): Route[] {
  const found = PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([route]) => route);
  // Ordered by ROUTES rather than by which pattern fired, so a multi-route
  // drug always reads the same way round.
  return ROUTES.filter((route) => found.includes(route));
}

/**
 * A route stated in the name wins: "Methylprednisolone (oral)" is the oral
 * product, whatever a shared dosing string happens to mention.
 */
export function extractRoutes(input: { name: string; dosing?: string | null }): {
  routes: Route[];
  source: 'name' | 'dosing' | null;
} {
  const fromName = match(input.name);
  if (fromName.length > 0) return { routes: fromName, source: 'name' };

  const fromDosing = match(input.dosing ?? '');
  if (fromDosing.length > 0) return { routes: fromDosing, source: 'dosing' };

  return { routes: [], source: null };
}
