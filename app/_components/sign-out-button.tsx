'use client';

import { signOut } from '@/lib/auth-client';

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await signOut();
        window.location.assign('/');
      }}
      // Quiet, but a real edge: it sits beside the avatar, and the two of them
      // are the only controls in the bar that are not navigation.
      className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm
        text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--fg)]"
    >
      Sign out
    </button>
  );
}
