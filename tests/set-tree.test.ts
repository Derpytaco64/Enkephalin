import { describe, expect, it } from 'vitest';
import {
  buildScopeTree,
  flattenTree,
  resolveScope,
  scopePath,
  scopeSegment,
  type TreeSet,
} from '@/lib/sets/tree';

/**
 * The deck tree over the scope columns.
 *
 * What is being pinned here is the two rules that make a path addressable: an
 * empty level collapses instead of becoming a blank node, and a node is
 * grouped by the same slug it is addressed by -- so the tree and the resolver
 * cannot disagree about which node a set is in.
 */

let seq = 0;

function set(scope: Partial<TreeSet>, items = 10): TreeSet {
  seq += 1;
  return {
    id: `id-${seq}`,
    slug: scope.slug ?? `set-${seq}`,
    name: scope.name ?? `Set ${seq}`,
    course: null, exam: null, unit: null, topic: null,
    ...scope,
    items,
  };
}

describe('a scope value as a segment', () => {
  it('slugs the way the rest of the app slugs', () => {
    expect(scopeSegment('Exam 3')).toBe('exam-3');
    expect(scopeSegment('Pharmacology II')).toBe('pharmacology-ii');
    expect(scopeSegment('  Endocrine  ')).toBe('endocrine');
  });

  it('folds accents rather than dropping the letter', () => {
    expect(scopeSegment('Bézière')).toBe('beziere');
  });

  it('is empty for a value with nothing sluggable in it', () => {
    expect(scopeSegment('—')).toBe('');
    expect(scopeSegment('???')).toBe('');
  });
});

describe('a set as a path', () => {
  it('reads the levels outermost first', () => {
    const steps = scopePath({ course: 'Pharm', exam: 'Exam 3', unit: 'Endocrine', topic: 'Thyroid' });
    expect(steps.map((step) => step.level)).toEqual(['course', 'exam', 'unit', 'topic']);
    expect(steps.map((step) => step.segment)).toEqual(['pharm', 'exam-3', 'endocrine', 'thyroid']);
  });

  it('skips an empty level instead of leaving a hole in the path', () => {
    const steps = scopePath({ course: 'Pharm', exam: null, unit: 'Endocrine', topic: null });
    expect(steps.map((step) => step.segment)).toEqual(['pharm', 'endocrine']);
    // And the level is carried, so a heading can still say which column it is.
    expect(steps[1].level).toBe('unit');
  });

  it('treats whitespace as empty', () => {
    expect(scopePath({ course: '  ', exam: 'Exam 1', unit: null, topic: null }))
      .toHaveLength(1);
  });

  it('drops a level that slugs to nothing rather than making an empty segment', () => {
    expect(scopePath({ course: 'Pharm', exam: '—', unit: 'Thyroid', topic: null })
      .map((step) => step.segment)).toEqual(['pharm', 'thyroid']);
  });
});

describe('the tree', () => {
  it('nests a set under each of its levels', () => {
    const tree = buildScopeTree([
      set({ course: 'Pharm', exam: 'Exam 3', unit: 'Endocrine', slug: 'thyroid' }),
    ]);

    expect(tree.children).toHaveLength(1);
    const [pharm] = tree.children;
    expect(pharm.label).toBe('Pharm');
    expect(pharm.sets).toEqual([]);
    const [exam] = pharm.children;
    expect(exam.path).toEqual(['pharm', 'exam-3']);
    const [unit] = exam.children;
    expect(unit.sets.map((s) => s.slug)).toEqual(['thyroid']);
  });

  it('puts two sets in the same unit side by side', () => {
    const tree = buildScopeTree([
      set({ course: 'Pharm', unit: 'Endocrine', slug: 'thyroid' }),
      set({ course: 'Pharm', unit: 'Endocrine', slug: 'adrenal' }),
    ]);

    const unit = tree.children[0].children[0];
    expect(unit.sets.map((s) => s.slug)).toEqual(['thyroid', 'adrenal']);
    expect(tree.children[0].children).toHaveLength(1);
  });

  it('hangs a set with a gap in its scope under the level it did fill in', () => {
    const tree = buildScopeTree([
      set({ course: 'Pharm', exam: 'Exam 3', unit: 'Endocrine', slug: 'with-exam' }),
      set({ course: 'Pharm', exam: null, unit: 'Endocrine', slug: 'no-exam' }),
    ]);

    const pharm = tree.children[0];
    // Not a sibling called "(no exam)": the unit hangs off the course directly.
    expect(pharm.children.map((child) => child.label).sort()).toEqual(['Endocrine', 'Exam 3']);
    const endocrine = pharm.children.find((child) => child.label === 'Endocrine');
    expect(endocrine?.sets.map((s) => s.slug)).toEqual(['no-exam']);
  });

  it('keeps a set with no scope at all out of the tree', () => {
    const tree = buildScopeTree([set({ slug: 'loose' }), set({ course: 'Pharm', slug: 'filed' })]);

    expect(tree.loose.map((s) => s.slug)).toEqual(['loose']);
    expect(tree.children).toHaveLength(1);
    // Still counted: the totals are what the page says out loud.
    expect(tree.totals.sets).toBe(2);
  });

  it('rolls counts up from every descendant', () => {
    const tree = buildScopeTree([
      set({ course: 'Pharm', exam: 'Exam 3', unit: 'Endocrine' }, 9),
      set({ course: 'Pharm', exam: 'Exam 3', unit: 'Renal' }, 4),
      set({ course: 'Pharm', exam: 'Exam 1' }, 7),
      set({ course: 'Path' }, 2),
    ]);

    const pharm = tree.children.find((child) => child.label === 'Pharm')!;
    expect(pharm.totals).toEqual({ sets: 3, items: 20 });
    const exam3 = pharm.children.find((child) => child.label === 'Exam 3')!;
    expect(exam3.totals).toEqual({ sets: 2, items: 13 });
    expect(tree.totals).toEqual({ sets: 4, items: 22 });
  });

  it('sorts siblings by label so a list of exams reads in order', () => {
    const tree = buildScopeTree([
      set({ course: 'Pharm', exam: 'Exam 3' }),
      set({ course: 'Pharm', exam: 'Exam 1' }),
      set({ course: 'Pharm', exam: 'Exam 2' }),
    ]);

    expect(tree.children[0].children.map((child) => child.label))
      .toEqual(['Exam 1', 'Exam 2', 'Exam 3']);
  });

  /**
   * The rule that keeps the tree and the url in agreement: these two values
   * are one node, not two nodes with the same address.
   */
  it('folds two scope values that slug alike into one node', () => {
    const tree = buildScopeTree([
      set({ course: 'Exam 3', slug: 'a' }),
      set({ course: 'exam-3', slug: 'b' }),
    ]);

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].sets.map((s) => s.slug)).toEqual(['a', 'b']);
    // Labelled with the first spelling seen; both are reachable either way.
    expect(tree.children[0].label).toBe('Exam 3');
  });

  it('carries the level each node came from', () => {
    const tree = buildScopeTree([set({ course: 'Pharm', exam: 'Exam 3', topic: 'Thyroid' })]);
    const flat = flattenTree(tree);
    expect(flat.map((node) => `${node.level}:${node.label}`))
      .toEqual(['course:Pharm', 'exam:Exam 3', 'topic:Thyroid']);
  });

  it('has nothing to say about no sets', () => {
    expect(buildScopeTree([])).toEqual({
      children: [], loose: [], totals: { sets: 0, items: 0 },
    });
  });
});

describe('resolving a path to a deck', () => {
  const sets = [
    set({ course: 'Pharm', exam: 'Exam 3', unit: 'Endocrine', topic: 'Thyroid', slug: 'thyroid' }, 9),
    set({ course: 'Pharm', exam: 'Exam 3', unit: 'Endocrine', topic: 'Adrenal', slug: 'adrenal' }, 6),
    set({ course: 'Pharm', exam: 'Exam 3', unit: 'Renal', slug: 'renal' }, 4),
    set({ course: 'Pharm', exam: 'Exam 1', slug: 'intro' }, 3),
    set({ course: 'Path', slug: 'path' }, 2),
  ];

  it('gathers every set under the node, not just the ones filed at it', () => {
    const scope = resolveScope(sets, ['pharm', 'exam-3']);
    expect(scope?.sets.map((s) => s.slug).sort())
      .toEqual(['adrenal', 'renal', 'thyroid']);
  });

  it('resolves a leaf to one set', () => {
    const scope = resolveScope(sets, ['pharm', 'exam-3', 'endocrine', 'thyroid']);
    expect(scope?.sets.map((s) => s.slug)).toEqual(['thyroid']);
  });

  it('resolves a whole course', () => {
    const scope = resolveScope(sets, ['pharm']);
    expect(scope?.sets).toHaveLength(4);
    expect(scope?.label).toBe('Pharm');
  });

  it('gives back the trail, so a page can show where it is', () => {
    const scope = resolveScope(sets, ['pharm', 'exam-3', 'endocrine']);
    expect(scope?.trail.map((step) => step.label)).toEqual(['Pharm', 'Exam 3', 'Endocrine']);
    expect(scope?.trail.map((step) => step.path.join('/'))).toEqual([
      'pharm', 'pharm/exam-3', 'pharm/exam-3/endocrine',
    ]);
  });

  it('refuses a path that is not in the tree', () => {
    expect(resolveScope(sets, ['nope'])).toBeNull();
    expect(resolveScope(sets, ['pharm', 'exam-9'])).toBeNull();
    // A real node in the wrong order is not a path to it.
    expect(resolveScope(sets, ['exam-3', 'pharm'])).toBeNull();
  });

  it('refuses the empty path, which is the index rather than a deck', () => {
    expect(resolveScope(sets, [])).toBeNull();
  });

  it('does not reach a node through a level the set skipped', () => {
    const loose = [set({ course: 'Pharm', unit: 'Endocrine', slug: 'x' })];
    expect(resolveScope(loose, ['pharm', 'endocrine'])?.sets.map((s) => s.slug)).toEqual(['x']);
    expect(resolveScope(loose, ['pharm', 'exam-3', 'endocrine'])).toBeNull();
  });
});
