'use client';

import { useState, useTransition } from 'react';
import type { Result } from '@/lib/drugs/mutations';
import { clearFlagAction } from './actions';

/**
 * "Looks right" — clears the doubt and leaves the value exactly as it was.
 *
 * A client component because `clearFlag` can refuse, and a refusal has to be
 * visible: a server-rendered form would have to swallow *that drug no longer
 * exists* and would look like it had worked.
 *
 * Not a form at all. There is nothing to submit but two constants, so the
 * action takes them as arguments -- which keeps this file out of the
 * `tests/form-reset.test.ts` allowlist, where a `<form action={...}>` would
 * have put it for the sake of a reset nobody wants.
 */
export function ClearFlagButton({ slug, fieldKey }: { slug: string; fieldKey: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const clear = () => {
    setError(null);
    startTransition(async () => {
      const result: Result = await clearFlagAction(slug, fieldKey);
      // No success state to set: the action revalidates and the row leaves the
      // queue, which says more than a tick would.
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <>
      <button type="button" onClick={clear} disabled={pending} className="btn btn-quiet btn-sm">
        {pending ? 'Clearing…' : 'Looks right'}
      </button>
      {error && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
    </>
  );
}
