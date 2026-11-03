import { DUST, STARS } from '@/lib/theme/ambience';

/**
 * The decorations belonging to light and dark rather than to a season.
 *
 * **Both halves are rendered and the stylesheet hides one.** A theme of
 * `system` means the server does not know whether it is light or dark — only
 * `prefers-color-scheme` does — so choosing here would mean choosing wrong for
 * half the readers, or waiting for the browser and flashing the other one.
 * Twenty-two spare spans, most of them `display: none`, is the cheaper trade.
 *
 * Same rules as the season layer, and the same reasons: one inert layer in the
 * root layout, fixed tables rather than randomised ones, nothing that varies
 * by page, and not one token that text is drawn in is touched. It sits *behind*
 * `<header>` and `<main>`, which paint their own grounds — see the "nothing
 * drifts behind text" note in `app/globals.css`.
 */
export function AmbienceLayer({ on }: { on: boolean }) {
  if (!on) return null;

  return (
    <div className="ambience" aria-hidden="true">
      {/* The clock's warmth, and the paper. Neither moves, so neither is
          affected by a reduced-motion preference. */}
      <div className="ambience-wash" />
      <div className="ambience-grain" />

      {/* Light: one wide diagonal band, and the dust caught in it. */}
      <div className="ambience-beam" />
      {DUST.map((mote, index) => (
        <span
          key={`dust-${index}`}
          className="ambience-mote ambience-dust"
          style={{
            left: `${mote.left}%`,
            top: `${mote.top}%`,
            ['--size' as string]: `${mote.size}px`,
            ['--dur' as string]: `${mote.duration}s`,
            ['--delay' as string]: `${mote.delay}s`,
            ['--mote-opacity' as string]: String(mote.opacity),
          }}
        />
      ))}

      {/* Dark: a sky. These do not travel, only breathe. */}
      {STARS.map((star, index) => (
        <span
          key={`star-${index}`}
          className="ambience-mote ambience-star"
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            ['--size' as string]: `${star.size}px`,
            ['--dur' as string]: `${star.duration}s`,
            ['--delay' as string]: `${star.delay}s`,
            ['--mote-opacity' as string]: String(star.opacity),
          }}
        />
      ))}
    </div>
  );
}
