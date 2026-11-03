import { initialsFor } from '@/lib/account/shape';

/**
 * The circle that stands for a person: their picture, or their initials.
 *
 * Initials rather than a generic silhouette, because the one place this
 * appears today is the header of a site one person is signed into, and a
 * silhouette there says nothing at all. The accent fill is the only colour on
 * it, so the contrast is `--accent` against `--accent-fg`, which the theme
 * already guarantees in both schemes.
 *
 * Not a client component and not a `next/image`: the source is a data URL out
 * of the user's own row, so there is nothing for the image optimiser to fetch
 * or cache.
 */
export function Avatar({
  user,
  size = 32,
  className = '',
}: {
  user: { name?: string | null; email: string; image?: string | null };
  /** Pixels. 32 in the header, larger on the account page. */
  size?: number;
  className?: string;
}) {
  const shape = 'shrink-0 overflow-hidden rounded-full border border-[var(--border)]';

  if (user.image) {
    return (
      <img
        src={user.image}
        // Empty, because every use of this sits next to or inside a control
        // that already names the person. A screen reader reading "Daniel"
        // twice is worse than it not reading the picture.
        alt=""
        width={size}
        height={size}
        className={`${shape} object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${shape} grid place-items-center bg-[var(--accent)] font-medium
        leading-none text-[var(--accent-fg)] ${className}`}
      // Scaled off the circle rather than fixed, so one component covers the
      // 32px header and the 80px account page without a second size table.
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initialsFor(user)}
    </span>
  );
}
