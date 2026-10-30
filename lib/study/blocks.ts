import { clearsBlock, type Grade } from './srs';

/**
 * A session over a list of card ids, chopped into consecutive blocks.
 *
 * A block does not advance until every card in it has been graded good (or
 * "Got it") at least once this session. Cards graded below that go back into
 * the block's queue. Block 2 is not shown until block 1 is clear.
 *
 * Positional, not semantic: tags, class and year are already scope filters on
 * the session, so blocks stay a pacing control that composes with any scope.
 */
export type Session = {
  /** Every card, in order, chopped into blocks of blockSize. */
  blocks: string[][];
  blockIndex: number;
  /** Still to show in the current block, in order. */
  queue: string[];
  /** Cleared in the current block. */
  cleared: Set<string>;
  finished: boolean;
};

export function createSession(cardIds: string[], blockSize: number): Session {
  // Zero means no blocks: one flat pass over everything.
  const size = blockSize > 0 ? blockSize : Math.max(cardIds.length, 1);
  const blocks: string[][] = [];

  for (let start = 0; start < cardIds.length; start += size) {
    blocks.push(cardIds.slice(start, start + size));
  }

  return {
    blocks,
    blockIndex: 0,
    queue: blocks[0] ? [...blocks[0]] : [],
    cleared: new Set(),
    finished: cardIds.length === 0,
  };
}

export function currentCard(session: Session): string | null {
  return session.queue[0] ?? null;
}

export function blockProgress(session: Session) {
  const block = session.blocks[session.blockIndex] ?? [];
  return {
    block: session.blockIndex + 1,
    blocks: session.blocks.length,
    cleared: session.cleared.size,
    size: block.length,
  };
}

/**
 * Grades the card at the front of the queue and returns the next state.
 *
 * A miss goes to the back of the queue rather than straight back to the front:
 * the answer is still on screen, and asking again immediately tests nothing.
 */
export function grade(session: Session, grade: Grade): Session {
  const cardId = session.queue[0];
  if (cardId === undefined) return session;

  const queue = session.queue.slice(1);
  const cleared = new Set(session.cleared);

  if (clearsBlock(grade)) cleared.add(cardId);
  else queue.push(cardId);

  if (queue.length > 0) {
    return { ...session, queue, cleared };
  }

  // Block exhausted. Anything not cleared comes round again before the next
  // block opens.
  const block = session.blocks[session.blockIndex] ?? [];
  const unresolved = block.filter((id) => !cleared.has(id));
  if (unresolved.length > 0) {
    return { ...session, queue: unresolved, cleared };
  }

  const nextIndex = session.blockIndex + 1;
  const nextBlock = session.blocks[nextIndex];
  if (!nextBlock) {
    return { ...session, queue: [], cleared, finished: true };
  }

  return {
    ...session,
    blockIndex: nextIndex,
    queue: [...nextBlock],
    cleared: new Set(),
    finished: false,
  };
}
