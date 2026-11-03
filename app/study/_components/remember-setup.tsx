'use client';

import { useEffect, useRef } from 'react';
import type { SetupParams, Surface } from '@/lib/study/presets';
import { rememberSetupAction } from './remember-actions';

/**
 * Renders nothing; tells the server a session was started here.
 *
 * In the browser rather than in the page's own render, because the page is a
 * GET -- and a GET that writes is a GET a link prefetch performs. From here it
 * fires once a session is actually on screen, which is the thing being
 * remembered.
 *
 * Fire-and-forget on purpose. The home page's "pick up where you left off" is
 * a convenience; nothing in the session depends on the write landing, so a
 * failure must not interrupt a deck being studied.
 */
export function RememberSetup({ surface, params }: { surface: Surface; params: SetupParams }) {
  // A ref rather than an empty dependency list: `params` is a fresh object
  // every render, and this must not re-send on each one.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void rememberSetupAction(surface, params).catch(() => {});
  }, [surface, params]);

  return null;
}
