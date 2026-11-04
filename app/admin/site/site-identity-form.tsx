'use client';

import { useState } from 'react';
import { submitTo } from '@/app/_components/submit';
import type { Result } from '@/lib/drugs/mutations';
// `/shape` and not `@/lib/settings`: this runs in a browser, and the module
// next door reaches for the database. See the comment at the top of shape.ts.
import {
  DISCLAIMER_MAX, REGISTRATION_LABELS, REGISTRATION_MODES, SITE_NAME_MAX,
  type RegistrationMode, type SiteIdentity,
} from '@/lib/settings/shape';

/**
 * What the site is called, who may register, and the sentence at the foot of
 * the page.
 *
 * One form for all three, because the writer is one call: an admin changing
 * two of them in a sitting should not be able to land one and be refused the
 * other.
 *
 * `onSubmit` rather than `action`, and controlled throughout, for the reason
 * written out in `app/_components/submit.ts` -- a form action makes React
 * reset the form, and a reset select goes back to the option it mounted with
 * however the value is held. The registration mode is a select, so this form
 * is squarely in that bug's path.
 */
export function SiteIdentityForm({
  settings,
  save,
}: {
  settings: SiteIdentity;
  save: (formData: FormData) => Promise<Result<SiteIdentity>>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const [name, setName] = useState(settings.siteName);
  const [mode, setMode] = useState(settings.registrationMode);
  const [disclaimer, setDisclaimer] = useState(settings.disclaimerText);

  /** Any edit retires the last "Saved." -- it no longer describes this form. */
  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      setSaved(false);
      set(value);
    };
  }

  const control = 'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';

  return (
    <form
      onSubmit={submitTo(async (formData: FormData) => {
        setPending(true);
        setError(null);
        const result = await save(formData);
        setPending(false);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setSaved(true);
        // Seeded from what was stored, not from what was typed: the writer
        // trims, so a name entered with a trailing space should visibly lose
        // it rather than sit here looking unsaved.
        if (result.value !== undefined) {
          setName(result.value.siteName);
          setMode(result.value.registrationMode);
          setDisclaimer(result.value.disclaimerText);
        }
      })}
      className="mt-4 rounded border border-[var(--border)] p-4"
    >
      <label htmlFor="siteName" className="block text-sm font-medium">Name</label>
      <input
        id="siteName" name="siteName" type="text"
        maxLength={SITE_NAME_MAX}
        className={`${control} h-9 max-w-xs`}
        value={name}
        onChange={(event) => edited(setName)(event.target.value)}
      />
      <p className="mt-1 text-xs text-[var(--muted)]">
        The wordmark in the top bar, the tab title, and the heading on the signed-out front page.
        The mark beside it is a file in <code className="font-mono">public/</code> and does not
        change with this.
      </p>

      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <label htmlFor="registrationMode" className="block text-sm font-medium">
          Who may register
        </label>
        <select
          id="registrationMode" name="registrationMode"
          className={`${control} h-9 max-w-sm`}
          value={mode}
          onChange={(event) => edited(setMode)(event.target.value as RegistrationMode)}
        >
          {REGISTRATION_MODES.map((value) => (
            <option key={value} value={value}>{REGISTRATION_LABELS[value]}</option>
          ))}
        </select>

        {/* The one setting on this page with a consequence somebody else can
            walk into, so each mode says what it does to the register page
            rather than leaving it to be discovered. */}
        <p className="mt-1 text-xs text-[var(--muted)]">
          {mode === 'invite'
            && 'The register page asks for a code and refuses anything else. '
              + 'Codes are minted in Invites.'}
          {mode === 'open'
            && 'Anyone who can reach the address can make an account without a code. '
              + 'This site is on the public internet.'}
          {mode === 'closed'
            && 'The register page turns everyone away, codes included, and the sign-in page '
              + 'stops offering it. Existing accounts are unaffected.'}
        </p>
      </div>

      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <label htmlFor="disclaimerText" className="block text-sm font-medium">Disclaimer</label>
        <textarea
          id="disclaimerText" name="disclaimerText"
          rows={3}
          maxLength={DISCLAIMER_MAX}
          className={`${control} py-2 leading-relaxed`}
          value={disclaimer}
          onChange={(event) => edited(setDisclaimer)(event.target.value)}
        />
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-[var(--muted)]">
          <span>
            At the foot of the front page and under the heading on Drugs. Reword it as you like —
            it cannot be emptied, because the sentence saying this is not a clinical reference is
            the one this app should not be able to lose.
          </span>
          <span className="tabular-nums">
            {disclaimer.trim().length}/{DISCLAIMER_MAX}
          </span>
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save'}
        </button>
        {error !== null && <span className="text-sm text-[var(--danger)]">{error}</span>}
        {error === null && saved && <span className="text-sm text-[var(--ok)]">Saved.</span>}
      </div>
    </form>
  );
}
