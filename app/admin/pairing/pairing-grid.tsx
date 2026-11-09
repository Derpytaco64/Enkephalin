'use client';

import { useState } from 'react';
import type { PairingDrug } from '@/lib/admin/pairing';
import type { Result } from '@/lib/drugs/mutations';
import { savePairingAction } from './actions';

/**
 * One drug's brands against its indications.
 *
 * A client component for two reasons, both of them about telling the truth on
 * screen. `setBrandIndications` can refuse, and a server form `action` must
 * return void -- so a plain form would swallow *reload and try again* and look
 * like it had saved. And **a brand with nothing ticked means "covers all of
 * them"**, which is the importer's own default and the common case; that has to
 * be said in the row as the boxes change, or an empty row reads as "treats
 * nothing" and somebody ticks everything to be safe.
 *
 * Controlled checkboxes, and the save posts from this state rather than from
 * the form's own fields -- the lesson of *A form action resets the form*, where
 * an uncontrolled input snapped back after the action resolved.
 */
export function PairingGrid({ drug }: { drug: PairingDrug }) {
  const [ticked, setTicked] = useState<Record<string, string[]>>(
    () => Object.fromEntries(drug.brands.map((brand) => [brand.id, brand.indicationIds])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const toggle = (brandId: string, indicationId: string) => {
    setSaved(false);
    setError(null);
    setTicked((current) => {
      const have = current[brandId] ?? [];
      return {
        ...current,
        [brandId]: have.includes(indicationId)
          ? have.filter((id) => id !== indicationId)
          : [...have, indicationId],
      };
    });
  };

  const save = async () => {
    setPending(true);
    setError(null);

    const formData = new FormData();
    formData.set('slug', drug.slug);
    for (const brand of drug.brands) {
      formData.append('brand', brand.id);
      for (const indicationId of ticked[brand.id] ?? []) {
        formData.append('pair', `${brand.id}:${indicationId}`);
      }
    }

    const result: Result = await savePairingAction(formData);
    setPending(false);
    if (result.ok) setSaved(true);
    else setError(result.message);
  };

  const dirty = drug.brands.some((brand) => {
    const now = [...(ticked[brand.id] ?? [])].sort().join(',');
    const was = [...brand.indicationIds].sort().join(',');
    return now !== was;
  });

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="py-2 pr-3 text-left font-medium">Brand</th>
              {drug.indications.map((indication) => (
                <th
                  key={indication.id}
                  className="px-2 py-2 text-left align-bottom text-xs font-medium
                    text-[var(--muted)]"
                >
                  {indication.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drug.brands.map((brand, index) => {
              const mine = ticked[brand.id] ?? [];
              // The family label only earns a line when it changes, so three
              // Wellbutrins read as one brand in three forms.
              const newFamily = index === 0 || drug.brands[index - 1].family !== brand.family;

              return (
                <tr key={brand.id} className="border-t border-[var(--border)]">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {brand.name}
                    {!newFamily && (
                      <span className="ml-1 text-xs text-[var(--muted)]">
                        same brand as {brand.family}
                      </span>
                    )}
                    {mine.length === 0 && (
                      <span className="ml-1 text-xs text-[var(--muted)]">— covers all</span>
                    )}
                  </th>
                  {drug.indications.map((indication) => (
                    <td key={indication.id} className="px-2 py-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={mine.includes(indication.id)}
                          onChange={() => toggle(brand.id, indication.id)}
                        />
                        <span className="sr-only">
                          {brand.name} treats {indication.label}
                        </span>
                      </label>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="btn btn-primary btn-sm"
        >
          {pending ? 'Saving…' : 'Save pairings'}
        </button>
        {saved && !dirty && (
          <span className="text-xs text-[var(--verified)]">Saved.</span>
        )}
        {error && <span role="alert" className="text-xs text-[var(--danger)]">{error}</span>}
      </div>
    </div>
  );
}
