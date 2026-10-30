'use server';

import { recordGrade } from '@/lib/study/session';
import { normalizeConfig, type StudyConfig } from '@/lib/study/config';
import type { Grade } from '@/lib/study/srs';
import { requireUser } from '@/lib/session';

/**
 * One answer. The config comes back from the client so the server decides
 * whether to reschedule from the mode rather than trusting a flag the page
 * could have got wrong.
 */
export async function gradeCardAction(input: {
  drugId: string;
  cardKey: string;
  fieldKeys: string[];
  grade: Grade;
  config: Partial<StudyConfig>;
}): Promise<void> {
  const session = await requireUser();

  await recordGrade({
    userId: session.user.id,
    card: { drugId: input.drugId, cardKey: input.cardKey, fieldKeys: input.fieldKeys },
    config: normalizeConfig(input.config),
    grade: input.grade,
  });
}
