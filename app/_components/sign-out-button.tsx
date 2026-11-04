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
      // A chip rather than a nav pill: it sits beside the avatar, and the two
      // of them are the only controls in the bar that are not navigation. The
      // hover used to lift the edge to `--accent`, which the seasons never
      // move -- `.pill-edge` takes it to `--btn-edge` instead, so it warms
      // with the rest of the bar.
      className="pill pill-edge"
    >
      Sign out
    </button>
  );
}
