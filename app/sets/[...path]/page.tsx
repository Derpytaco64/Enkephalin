import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { listSets } from '@/lib/sets/import';
import { loadDeck, type Deck } from '@/lib/sets/deck';
import { DeckView } from '@/app/sets/_components/deck-view';
import { FlashcardsView, type FlashcardSearch } from '@/app/sets/_components/flashcards-view';
import { QuizView, type QuizSearch } from '@/app/sets/_components/quiz-view';
import type { TreeSet } from '@/lib/sets/tree';

export const dynamic = 'force-dynamic';

type Params = {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<FlashcardSearch & QuizSearch>;
};

const SURFACES = ['flashcards', 'quiz'] as const;
type Surface = (typeof SURFACES)[number];

/**
 * One route for every deck, and the surfaces hang off the end of it.
 *
 * `/sets/thyroid`, `/sets/thyroid/flashcards`, `/sets/pharm/exam-3`,
 * `/sets/pharm/exam-3/quiz` -- a deck is a path of any length, so the route
 * has to be a catch-all, and **Next allows nothing nested under one**: a
 * `flashcards/page.tsx` inside `[...path]` builds and then answers every
 * request with *Catch-all must be the last part of the URL*. So the last
 * segment is read here instead, which is also what keeps every
 * `/sets/<slug>/flashcards` link written before the tree existed working.
 *
 * **A real deck wins over a surface name.** The whole path is resolved first,
 * so a unit somebody actually called *quiz* is still its own page; only when
 * the path is not a deck is a trailing `flashcards` or `quiz` read as the
 * surface. Without that order, naming a topic `quiz` would make it unopenable
 * and nothing would say why.
 */
async function resolve(path: string[]): Promise<{
  deck: Deck;
  surface: Surface | null;
  sets: TreeSet[];
} | null> {
  const sets = await listSets();

  const whole = await loadDeck(sets, path);
  if (whole) return { deck: whole, surface: null, sets };

  const last = path[path.length - 1];
  const surface = SURFACES.find((candidate) => candidate === last);
  if (!surface || path.length < 2) return null;

  const deck = await loadDeck(sets, path.slice(0, -1));
  return deck ? { deck, surface, sets } : null;
}

export async function generateMetadata({ params }: Params) {
  const { path } = await params;
  const found = await resolve(path);
  if (!found) return { title: 'Set' };

  return {
    title: found.surface
      ? `${found.deck.title} — ${found.surface}`
      : found.deck.title,
  };
}

export default async function DeckPage({ params, searchParams }: Params) {
  const session = await requireUser();
  const [{ path }, search] = await Promise.all([params, searchParams]);

  const found = await resolve(path);
  if (!found) notFound();

  if (found.surface === 'flashcards') {
    return <FlashcardsView deck={found.deck} search={search} userId={session.user.id} />;
  }

  if (found.surface === 'quiz') {
    return <QuizView deck={found.deck} search={search} userId={session.user.id} />;
  }

  return <DeckView deck={found.deck} sets={found.sets} userId={session.user.id} />;
}
