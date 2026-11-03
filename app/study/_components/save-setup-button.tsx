import type { Surface } from '@/lib/study/presets';

/**
 * *Save this setup*, standing next to Start inside the settings form.
 *
 * This is the one that works **before** you start anything, and the reason is
 * the whole point of it: it is a second submit button on the same form, so the
 * browser sends the controls as they are *right now* rather than as the URL
 * last recorded them. `formAction` redirects that submission to the manager
 * instead of back to the study page.
 *
 * No JavaScript, and no client boundary: `formaction`, `formmethod` and
 * `formtarget` are plain HTML on a submit button.
 *
 * `formTarget="_blank"` so the form you are in the middle of filling stays
 * exactly as you left it -- and so a session already running is not thrown
 * away by navigating off the page it lives in.
 *
 * The surface rides along as a hidden field rather than in the `formAction`
 * query, because a GET submission replaces the action's query string with the
 * form data. It costs a `surface=quiz` on the Start URL, which that page
 * ignores and `setupParams` never stores.
 */
export function SaveSetupButton({ surface }: { surface: Surface }) {
  return (
    <>
      <input type="hidden" name="surface" value={surface} />
      <button
        type="submit"
        formAction="/study/setups"
        formMethod="get"
        formTarget="_blank"
        className="mt-4 rounded border border-[var(--border)] px-4 py-2 text-[var(--fg)]"
      >
        Save this setup ↗
      </button>
    </>
  );
}
