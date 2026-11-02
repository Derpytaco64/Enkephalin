import {
  MODIFIERS,
  ROUTES,
  SITE_LABELS,
  UNITS,
  type Amount,
  type Duration,
  type Frequency,
  type Regimen,
  type Site,
} from './model';

/**
 * Printing, not storing. Both renderings below are derived from the components
 * every time they are shown, which is what keeps the coded form and the
 * displayed form from ever disagreeing.
 *
 * `toSig` is the prescription shorthand, worth drilling in its own right.
 * `toEnglish` is the readback: the drug editor shows it beside the sheet's
 * original prose, so a mis-coding is visible at a glance without the reader
 * having to know the component model. That comparison is the safety net for
 * the backfill -- a sig alone looks plausible whatever the source said.
 */

/** Trims float artifacts without rounding a real value away: 0.25, 2.5, 10. */
function num(value: number): string {
  return String(Number(value.toFixed(4)));
}

function amountRange(amount: Amount, join: string): string {
  return amount.high === null ? num(amount.low) : `${num(amount.low)}${join}${num(amount.high)}`;
}

function amountTail(amount: Amount, unitText: string): string {
  const perKg = amount.perKg ? '/kg' : '';
  const perTime = amount.per ? `/${amount.per === 'minute' ? 'min' : amount.per}` : '';
  return `${unitText}${perKg}${perTime}`;
}

/**
 * Combination products print as the sheet writes them -- carbidopa/levodopa is
 * "25/100 mg", one unit named once -- but only when the units genuinely match.
 * Mixed units are never collapsed, since that is the 15 mg / 15 mL confusion.
 */
function renderAmounts(amounts: Amount[], sig: boolean): string {
  if (amounts.length === 0) return '';

  const text = (amount: Amount) => {
    const unit = UNITS[amount.unit];
    const plural = amount.high !== null || amount.low !== 1;
    const unitText = sig ? unit.sig : plural ? unit.plural : unit.label;
    const space = sig && unit.class === 'count' ? ' ' : ' ';
    return `${amountRange(amount, sig ? '-' : ' to ')}${space}${amountTail(amount, unitText)}`;
  };

  const first = amounts[0];
  const sameShape = amounts.every(
    (a) => a.unit === first.unit && a.perKg === first.perKg && a.per === first.per,
  );

  if (amounts.length > 1 && sameShape) {
    const unit = UNITS[first.unit];
    const unitText = sig ? unit.sig : unit.plural;
    const numbers = amounts.map((a) => amountRange(a, sig ? '-' : ' to ')).join('/');

    // A sig is written the way the product is labelled -- "25/100 mg" -- so the
    // actives are named only in the readback, where the point is for a human to
    // see which number went to which drug.
    const actives = amounts.every((a) => a.active)
      ? ` (${amounts.map((a) => a.active).join('/')})`
      : '';

    return `${numbers} ${amountTail(first, unitText)}${sig ? '' : actives}`;
  }

  return amounts.map(text).join(' + ');
}

function renderFrequency(frequency: Frequency, sig: boolean): string {
  switch (frequency.kind) {
    case 'per_day': {
      // A range of counts has no sig abbreviation -- there is no code meaning
      // "two or three times a day" -- so it is spelled out either way.
      if (frequency.timesHigh !== null) {
        const span = `${num(frequency.times)}${sig ? '-' : ' to '}${num(frequency.timesHigh)}`;
        return sig ? `${span}x/day` : `${span} times a day`;
      }

      if (sig) {
        const codes: Record<number, string> = { 1: 'QD', 2: 'BID', 3: 'TID', 4: 'QID' };
        return codes[frequency.times] ?? `${frequency.times}x/day`;
      }
      const words: Record<number, string> = {
        1: 'once a day', 2: 'twice a day', 3: 'three times a day', 4: 'four times a day',
      };
      return words[frequency.times] ?? `${frequency.times} times a day`;
    }
    case 'interval': {
      const span = frequency.high === null
        ? num(frequency.low)
        : `${num(frequency.low)}${sig ? '-' : ' to '}${num(frequency.high)}`;

      if (sig) {
        const letter = { minute: 'MIN', hour: 'H', day: 'D', week: 'WK', month: 'MO' }[frequency.unit];
        if (frequency.unit === 'day' && frequency.low === 2 && frequency.high === null) return 'QOD';
        if (frequency.low === 1 && frequency.high === null) return `Q${letter}`;
        return `Q${span}${letter}`;
      }

      const plural = frequency.high !== null || frequency.low !== 1;
      const word = plural ? `${frequency.unit}s` : frequency.unit;
      return frequency.low === 1 && frequency.high === null
        ? `every ${frequency.unit}`
        : `every ${span} ${word}`;
    }
    case 'once':
      return sig ? 'x1' : 'once';
    case 'continuous':
      return sig ? '' : 'as a continuous infusion';
    case 'unspecified':
      return '';
  }
}

function renderSite(site: Site, sig: boolean): string {
  const labels = SITE_LABELS[site.region];
  const head = site.basis === 'each' ? `each ${labels.one}` : `affected ${labels.one}`;
  const note = site.note ? ` (${site.note})` : '';
  // "into" reads as instruction in the readback; the sig stays terse.
  return sig ? `${head}${note}` : `${site.basis === 'each' ? 'in' : 'to the'} ${head}${note}`;
}

function renderDuration(duration: Duration, sig: boolean): string {
  const span = duration.high === null
    ? num(duration.low)
    : `${num(duration.low)}${sig ? '-' : ' to '}${num(duration.high)}`;
  const unit = duration.unit === 'dose' ? 'dose' : duration.unit;
  const plural = duration.high !== null || duration.low !== 1 ? `${unit}s` : unit;
  const cycle = duration.cycleDays ? ` every ${duration.cycleDays}-day cycle` : '';
  return `${sig ? 'x' : 'for'} ${span} ${plural}${cycle}`;
}

/** The prescription shorthand: `0.25-0.5 mg PO TID PRN`. */
export function toSig(regimen: Regimen): string {
  const parts: string[] = [];

  if (regimen.label) parts.push(`${regimen.label}:`);

  const amounts = renderAmounts(regimen.amounts, true);
  if (amounts) parts.push(amounts);

  if (regimen.routes.length > 0) parts.push(regimen.routes.map((code) => ROUTES[code].sig).join('/'));
  if (regimen.site) parts.push(renderSite(regimen.site, true));

  const frequency = renderFrequency(regimen.frequency, true);
  if (frequency) parts.push(frequency);

  for (const modifier of regimen.modifiers) parts.push(MODIFIERS[modifier].sig);
  if (regimen.duration) parts.push(renderDuration(regimen.duration, true));
  if (regimen.ceiling) parts.push(`(max ${renderAmounts([regimen.ceiling], true)})`);

  return parts.join(' ');
}

/** The readback: `0.25 to 0.5 mg by mouth three times a day as needed`. */
export function toEnglish(regimen: Regimen): string {
  const parts: string[] = [];

  const amounts = renderAmounts(regimen.amounts, false);
  if (amounts) parts.push(amounts);

  if (regimen.routes.length > 0) {
    parts.push(regimen.routes.map((code) => ROUTES[code].label).join(' or '));
  }
  if (regimen.site) parts.push(renderSite(regimen.site, false));

  const frequency = renderFrequency(regimen.frequency, false);
  if (frequency) parts.push(frequency);

  for (const modifier of regimen.modifiers) parts.push(MODIFIERS[modifier].label);
  if (regimen.duration) parts.push(renderDuration(regimen.duration, false));
  if (regimen.ceiling) {
    parts.push(`not to exceed ${renderAmounts([regimen.ceiling], false)}`);
  }

  const sentence = parts.join(' ');
  const led = regimen.label ? `${regimen.label}: ${sentence}` : sentence;
  const tail = regimen.qualifiers.length > 0 ? ` (${regimen.qualifiers.join('; ')})` : '';
  return led.charAt(0).toUpperCase() + led.slice(1) + tail;
}
