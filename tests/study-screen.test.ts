import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * What the study screens put on the page, read out of their source.
 *
 * None of this has a runtime here -- the suite has no DOM and these are server
 * and client components -- so every invariant below is the kind that fails
 * silently: the page renders, nothing throws, and a line that should be there
 * is not. Which is exactly how the review screen went a month without the
 * *Also right* line that the question card has always had.
 */

const QUIZ_RUNNER = readFileSync('app/study/quiz/quiz-runner.tsx', 'utf8');
const QUIZ_PAGE = readFileSync('app/study/quiz/page.tsx', 'utf8');
const DECK_PAGE = readFileSync('app/study/flashcards/page.tsx', 'utf8');
const SETUP_BAR = readFileSync('app/study/_components/setup-bar.tsx', 'utf8');

describe('a shared answer is named in full', () => {
  it('reads every owner, not the one the option was drawn from', () => {
    // `fromGeneric` is the drug an option came from, which for the controlled
    // schedule is whichever of nine the draw reached for first.
    expect(QUIZ_RUNNER).toContain('fromOwners');
  });

  it('says so on the card and again in the review', () => {
    // Twice, because they are read at different moments: once with the drug
    // still in your head, once going back over what you missed.
    expect((QUIZ_RUNNER.match(/<SharedAnswer /g) ?? [])).toHaveLength(2);
    expect((QUIZ_RUNNER.match(/<AlsoRight /g) ?? [])).toHaveLength(2);
  });

  it('leaves the asked drug out of the list', () => {
    // It is already named in the prompt, so repeating it reads as though the
    // answer were somehow also true of something else called the same thing.
    const shared = QUIZ_RUNNER.slice(QUIZ_RUNNER.indexOf('function SharedAnswer'));
    expect(shared.slice(0, shared.indexOf('return ('))).toContain('owner.slug !== question.slug');
  });

  it('caps the list and counts the rest', () => {
    // Nine names in a sentence is a list nobody reads, and the *number* is the
    // thing worth taking away: this answer does not distinguish.
    const owners = QUIZ_RUNNER.slice(QUIZ_RUNNER.indexOf('function Owners'));
    const body = owners.slice(0, owners.indexOf('function Mismatch'));
    expect(body).toMatch(/owners\.slice\(0, \d+\)/);
    expect(body).toContain('owners.length - shown.length');
  });
});

describe('Again', () => {
  it('redraws from the settings the page already has', () => {
    // `router.refresh()` rather than a link: the filters are what this render
    // was made from, and rebuilding them as a query would be a second opinion
    // about what they were. The page keys the runner on the paper's id, so a
    // fresh draw remounts it.
    expect(QUIZ_RUNNER).toContain('router.refresh()');
    expect(QUIZ_PAGE).toContain('key={paper.id}');
  });

  it('waits for the attempt to be recorded', () => {
    // The write happens in an effect on this component. Remounting mid-write
    // would throw away the quiz just sat -- which is the same class of bug as
    // the re-render that once scored a finished paper 0 of 83.
    const again = QUIZ_RUNNER.slice(QUIZ_RUNNER.indexOf('startAgain(() => router.refresh())') - 400);
    expect(again.slice(0, 500)).toContain('disabled={saved === null || starting}');
  });

  it('is offered beside starting a different quiz, not instead of it', () => {
    expect(QUIZ_RUNNER).toContain('Another quiz');
  });
});

describe('the room above the question', () => {
  const PAGES: [string, string][] = [['quiz', QUIZ_PAGE], ['flashcards', DECK_PAGE]];

  it('shrinks the title and the padding once a session is on screen', () => {
    // It was 140px of title, summary, setup bar and panel -- enough to push
    // the fourth option of a four-option question below the fold on a laptop.
    for (const [name, page] of PAGES) {
      expect(page, name).toContain('text-base font-semibold tracking-tight');
      expect(page, name).toMatch(/\? 'py-5' : 'py-10'/);
    }
  });

  it('folds the saved setups onto that line rather than dropping them', () => {
    // They are still reachable mid-session, which is the only time the "save
    // what is running" link means anything -- see the note in setup-bar.tsx.
    for (const [name, page] of PAGES) {
      expect(page, name).toMatch(/compact=\{(started|running)\}/);
    }
    expect(SETUP_BAR).toContain('compact = false');
  });

  it('keeps the settings panel open when there is nothing to study', () => {
    // No fields picked, nothing matched, everything scheduled for later: those
    // are exactly the moments the controls are what you came for.
    expect(QUIZ_PAGE).toContain('open={!started}');
    expect(DECK_PAGE).toContain('open={!running}');
  });
});

/**
 * Markdown drawn as markdown, on the two screens that used to print it raw.
 *
 * `formatFieldValue` hands a card the words in a row, which is right for a
 * search index and was taken for granted on a card too -- so a regimen read
 * `- Oxaliplatin --- 85 mg/m2 IV day 1` with its hyphens showing and a
 * decision tree arrived as one paragraph. The fix is `Prose`, the same
 * renderer the profile uses, and these pin the three places it goes.
 */
describe('a markdown field on a study screen', () => {
  const DECK_RUNNER = readFileSync('app/study/flashcards/session-runner.tsx', 'utf8');
  const PROSE = readFileSync('app/_components/prose.tsx', 'utf8');

  it('is drawn by the same renderer the profile uses', () => {
    expect(DECK_RUNNER).toContain("import { Prose } from '@/app/_components/prose'");
    expect(QUIZ_RUNNER).toContain("import { Prose } from '@/app/_components/prose'");
  });

  it('is told which text is markdown rather than guessing', () => {
    // The runners have no field definitions -- they are handed a deck and
    // draw it -- so the builder has to say. A runner sniffing for a leading
    // hyphen would turn a dose that happens to start with one into a list.
    expect(DECK_RUNNER).toContain('face.prose');
    expect(DECK_RUNNER).toContain('card.promptProse');
    expect(QUIZ_RUNNER).toContain('question.prose');
  });

  it('never folds one inside a button or a question', () => {
    // A `<details>` inside a quiz option is a control inside a control, and a
    // prompt is a question rather than a document.
    expect(PROSE).toContain('fold = true');
    for (const folded of QUIZ_RUNNER.match(/<Prose[\s\S]{0,120}?\/>/g) ?? []) {
      expect(folded, 'quiz').toContain('fold={false}');
    }
    // The deck folds on the answer -- a regimen with several protocols is
    // what folding is for -- and not on the prompt.
    const deck = DECK_RUNNER.match(/<Prose[\s\S]{0,120}?\/>/g) ?? [];
    expect(deck.filter((tag) => tag.includes('fold={false}'))).toHaveLength(1);
    expect(deck.length).toBeGreaterThan(1);
  });
});
