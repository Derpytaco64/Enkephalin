'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { ListPlace } from '@/lib/drugs/filter';

/**
 * Where this drug sits in the list you came from, and the way to the next one.
 *
 * *Filter to an exam, open the third drug, then page to the second and the
 * fourth* -- the owner's ask. The list is the **filtered** one, in the order it
 * was on screen, which is why the links carry the filter along: step to the
 * next drug and it can answer the same question about itself.
 *
 * Three ways to move, because this is read on a phone and on a laptop: the
 * two links, the arrow keys, and a horizontal swipe.
 */
export function ListPager({
  place,
  prevHref,
  nextHref,
}: {
  place: ListPlace;
  /**
   * The neighbours' addresses, built on the server with the filter and the
   * reading already in them.
   *
   * Strings rather than a function of the slug, which is what this wanted to
   * be: a function cannot cross into a client component, and the page that
   * knows how to spell one of these URLs is the one holding the search params.
   */
  prevHref: Route | null;
  nextHref: Route | null;
}) {
  const router = useRouter();
  const prev = prevHref === null ? null : place.prev;
  const next = nextHref === null ? null : place.next;

  // Prefetched on render rather than on hover: paging is the thing you do
  // repeatedly here, and the second drug should be ready before you ask.
  useEffect(() => {
    if (prevHref) router.prefetch(prevHref);
    if (nextHref) router.prefetch(nextHref);
  }, [router, prevHref, nextHref]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // A keystroke aimed at a text field is not a keystroke aimed at the
      // page: the arrow keys move a caret, and the profile has a search box on
      // it in the lookup panel.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      // Left alone when a modifier is held: ctrl/cmd-arrow is the browser's
      // own history navigation on some platforms, and taking it would be rude.
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

      if (event.key === 'ArrowLeft' && prevHref) {
        event.preventDefault();
        router.push(prevHref);
      }
      if (event.key === 'ArrowRight' && nextHref) {
        event.preventDefault();
        router.push(nextHref);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, prevHref, nextHref]);

  /**
   * A swipe, told apart from a scroll by which way it went further.
   *
   * The page scrolls vertically and a profile is long, so a gesture that moves
   * mostly up or down is a scroll and must not page. 60px is the floor for the
   * horizontal part -- below that it is a tap with a shaky thumb.
   *
   * Listeners on the window rather than a wrapper, and passive: this reads the
   * gesture and never prevents it, so a diagonal flick still scrolls.
   */
  const from = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    function start(event: TouchEvent) {
      if (event.touches.length !== 1) return;
      from.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }

    function end(event: TouchEvent) {
      const began = from.current;
      from.current = null;
      if (!began || event.changedTouches.length !== 1) return;

      const dx = event.changedTouches[0].clientX - began.x;
      const dy = event.changedTouches[0].clientY - began.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return;

      // Swiping left pulls the next drug in from the right, which is the way
      // every list on a phone behaves.
      if (dx < 0 && nextHref) router.push(nextHref);
      if (dx > 0 && prevHref) router.push(prevHref);
    }

    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchend', end, { passive: true });
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchend', end);
    };
  }, [router, prevHref, nextHref]);

  const stub = 'pill pointer-events-none opacity-40';

  return (
    <nav
      aria-label="The filtered list you came from"
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      {prev && prevHref ? (
        <Link href={prevHref} className="pill" rel="prev" title="Left arrow, or swipe right">
          ← {prev.generic}
        </Link>
      ) : (
        <span className={stub} aria-hidden="true">← first</span>
      )}

      {/* The count is the reason to trust the arrows: *3 of 90* says which list
          this is the third of, and that there are 87 more to work through. */}
      <span className="text-xs text-[var(--muted)]">
        {place.at} of {place.total}
      </span>

      {next && nextHref ? (
        <Link href={nextHref} className="pill" rel="next" title="Right arrow, or swipe left">
          {next.generic} →
        </Link>
      ) : (
        <span className={stub} aria-hidden="true">last →</span>
      )}
    </nav>
  );
}
