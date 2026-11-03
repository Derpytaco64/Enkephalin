import { motesFor, ORNAMENTS, type Season } from '@/lib/theme/seasons';

/**
 * The seasonal ornament: a wash and a handful of drifting motes.
 *
 * Rendered **once, by the root layout**, from one value, identical on every
 * page. That is not an implementation detail, it is the rule it lives under:
 * this app may not let decoration carry meaning, and an ornament that varied
 * from page to page — or worse, beside a question — could. The mote table in
 * `lib/theme/seasons.ts` is a fixed list rather than randomised for the same
 * reason. See `tests/colour-is-cosmetic.test.ts` and `tests/seasons.test.ts`.
 *
 * A server component with no state and no client bundle: every bit of the
 * movement is CSS, so there is nothing for the browser to run. The per-mote
 * numbers ride in as custom properties, which is what lets twenty elements
 * share four keyframes.
 *
 * Inert by construction — `aria-hidden`, `pointer-events: none`, and hidden
 * outright under `prefers-reduced-motion` and when printing (app/globals.css).
 */
export function SeasonLayer({ season }: { season: Season | null }) {
  if (season === null) return null;

  const ornament = ORNAMENTS[season];

  return (
    <div className="season" aria-hidden="true">
      <div className="season-wash" />
      {motesFor(season).map((mote, index) => (
        <span
          // The index is the identity: the table is fixed and ordered, so mote
          // 7 is always mote 7.
          key={index}
          className={[
            'season-mote',
            `season-${ornament.shape}`,
            ornament.motion === 'fall' ? 'season-fall' : 'season-rise',
            ornament.spins ? 'season-spins' : '',
          ].filter((name) => name !== '').join(' ')}
          style={{
            left: `${mote.left}%`,
            // Custom properties the keyframes read. Typed loosely because
            // React's CSSProperties does not know about them.
            ['--size' as string]: `${mote.size}px`,
            ['--dur' as string]: `${mote.duration}s`,
            // Negative, so the screen is already populated on arrival rather
            // than filling up over the first half-minute.
            ['--delay' as string]: `${mote.delay}s`,
            ['--drift' as string]: `${mote.drift}vw`,
            ['--spin' as string]: `${mote.spin}deg`,
            ['--mote-opacity' as string]: String(mote.opacity),
            ['--mote-ink' as string]: mote.ink === 1
              ? 'var(--season-ink)'
              : 'var(--season-ink-2)',
          }}
        />
      ))}
    </div>
  );
}
