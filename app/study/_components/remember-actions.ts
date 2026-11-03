'use server';

/**
 * Recording what a session was started with.
 *
 * A separate action file because it must not revalidate anything, and the two
 * study pages are `force-dynamic` with a randomised draw: re-rendering one
 * mid-session hands the runner a different deck or a different paper. That is
 * the bug that scored a finished quiz 0 of 83; see PLAN.md.
 */
import { requireUser } from '@/lib/session';
import { rememberSetup } from '@/lib/study/last-used';
import { isSurface } from '@/lib/study/presets';

export async function rememberSetupAction(
  surface: unknown,
  params: Record<string, string | string[]>,
): Promise<void> {
  const session = await requireUser();
  if (!isSurface(surface)) return;
  await rememberSetup(session.user.id, surface, params);
}
