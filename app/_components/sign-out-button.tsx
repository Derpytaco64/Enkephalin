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
      className="text-sm text-[var(--muted)] underline"
    >
      Sign out
    </button>
  );
}
