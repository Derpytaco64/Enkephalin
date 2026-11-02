/**
 * Reading study config out of a URL, in one place because both pages were
 * getting it wrong in the same way.
 *
 * A checkbox group submits its name once per ticked box -- `fields=moa&
 * fields=dosing` -- which Next hands over as an array. A single tick arrives
 * as a string, and nothing at all as undefined. Code that assumed only the
 * string case worked for one field and threw `.split is not a function` for
 * two, which is exactly the shape a bug takes when the URL you test by hand is
 * not the URL the form produces.
 *
 * Client-safe, so the pickers and the pages agree by construction.
 */

/** Repeated, single or absent -- always a list. */
export function manyParam(value: string | string[] | undefined): string[] {
  return [value ?? []].flat().filter(Boolean);
}

/**
 * Field keys, from either shape: repeated params as the form submits them, or
 * comma-joined as a hand-written or bookmarked link may carry them. Both have
 * to work, and a link someone saved is not a thing to break.
 */
export function fieldKeysParam(value: string | string[] | undefined): string[] {
  return manyParam(value)
    .flatMap((part) => part.split(','))
    .map((key) => key.trim())
    .filter(Boolean);
}
