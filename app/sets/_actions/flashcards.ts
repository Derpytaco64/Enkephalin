'use server';

import { requireUser } from '@/lib/session';
import { normalizeConfig, type StudyConfig } from '@/lib/study/config';
import { recordGrade } from '@/lib/study/session';
import type { Grade } from '@/lib/study/srs';

/**
 * One answer about a set item.
 *
 * Identical to the drug version but for `subject: 'item'`, which is the whole
 * reason this file exists rather than a flag on the other one: the id a card
 * carries looks the same either way, and only the server knows which column it
 * belongs in. Getting that wrong would fail the check constraint rather than
 * writing to the wrong row -- which is exactly why the constraint is there.
 */
export async function gradeSetCardAction(input: {
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
    subject: 'item',
  });
}
