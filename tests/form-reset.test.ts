import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `<form action={fn}>` makes React reset the form, and that is a bug in every
 * form whose fields are seeded from something stored.
 *
 * The mechanism, and why holding the value in state does not save you, is
 * written out in `app/_components/submit.ts`. What this file holds is the
 * decision: a form action is allowed *only* where the reset is the point, and
 * the reason has to be stated here. It is a list rather than a ban because the
 * reset is genuinely the right behaviour for a create form -- the boxes should
 * come back empty for the next one -- and banning it outright would push
 * somebody into re-implementing that by hand.
 *
 * This cost two rounds of the owner reporting the same bug to find, the second
 * time after a "fix" that changed nothing, so it is worth a test that fails on
 * the next form to join the category by accident.
 */
const ALLOWED: Record<string, string> = {
  'app/admin/tags/new-tag-form.tsx':
    'create form: coming back empty for the next list is the wanted behaviour',
  'app/admin/invites/page.tsx':
    'create form (the reset restores the 1 and the 14), plus a revoke button with no fields',
  'app/admin/fields/page.tsx':
    'restore button; a hidden id and nothing to reset',
  'app/admin/fields/field-list.tsx':
    'remove button; a hidden id and nothing to reset. The list holds its order and its '
    + 'tick boxes in state, and both are written by an action call rather than by this form',
  'app/admin/tags/[slug]/page.tsx':
    'delete button; a hidden slug and nothing to reset',
  'app/drugs/[slug]/page.tsx':
    'the per-field flag button; hidden inputs only',
  'app/drugs/[slug]/edit/danger-zone.tsx':
    'merge and delete buttons; every control that holds a value is outside the form',
};

/**
 * The text of a JSX opening tag starting at `at`.
 *
 * Stops at the first `>` that is not the tail of an arrow -- these tags carry
 * `onSubmit={submitTo(...)}` and `action={async () => ...}`, so a naive
 * `indexOf('>')` ends in the middle of the attribute it is trying to read.
 */
function openingTag(source: string, at: number): string {
  for (let i = at; i < source.length; i += 1) {
    if (source[i] === '>' && source[i - 1] !== '=') return source.slice(at, i + 1);
  }
  return source.slice(at);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) return walk(full);
    return entry.endsWith('.tsx') ? [full] : [];
  });
}

/**
 * Every file with at least one `<form action={...}>`.
 *
 * Comments are stripped first: several of these files *discuss*
 * `<form action={...}>` -- including the one explaining why it is wrong -- and
 * a scanner that counted prose would report the fix as the defect.
 */
function usesFormAction(): string[] {
  return walk('app').filter((path) => {
    const source = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (let at = source.indexOf('<form'); at >= 0; at = source.indexOf('<form', at + 1)) {
      if (/\baction=\{/.test(openingTag(source, at))) return true;
    }
    return false;
  });
}

describe('a form action is a decision, not a default', () => {
  it('finds a form action only where one is written down as wanted', () => {
    expect(usesFormAction().sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it('says why, for each of them', () => {
    for (const [path, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, path).toBeGreaterThan(20);
    }
  });

  it('reads an opening tag past the arrow in its own attributes', () => {
    // The helper above is the whole reason this file can tell the two apart,
    // so it gets its own check rather than being trusted.
    const sample = '<form onSubmit={submitTo((fd) => run(fd))} className="x">body</form>';
    expect(openingTag(sample, 0)).toBe('<form onSubmit={submitTo((fd) => run(fd))} className="x">');
  });
});

/**
 * A submit button's name and value are contributed by the *submission*, not by
 * the form's controls, so `new FormData(form)` leaves them out. A form whose
 * action branches on which button was pressed therefore read no button at all
 * and took its default branch every time -- which on the import screen meant
 * *Import it* quietly previewing the file again, the failure mode with no error
 * message to go on.
 *
 * Two assertions rather than one, because the fix has two halves that can drift
 * apart: the helper has to pass the submitter, and a form with a deciding
 * button has to be going through the helper to benefit.
 */
describe('a button that says what to do arrives with the data', () => {
  /** Files with a `<button type="submit">` that carries a name. */
  function decidesBySubmitter(): string[] {
    return walk('app').filter((path) => {
      const source = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (let at = source.indexOf('<button'); at >= 0; at = source.indexOf('<button', at + 1)) {
        const tag = openingTag(source, at);
        if (/type="submit"/.test(tag) && /\sname="/.test(tag)) return true;
      }
      return false;
    });
  }

  it('hands the submitter to FormData, or no named button is ever read', () => {
    const helper = readFileSync('app/_components/submit.ts', 'utf8');
    expect(helper).toContain('new FormData(event.currentTarget, submitter)');
  });

  it('routes every form that branches on a button through the helper', () => {
    const files = decidesBySubmitter();
    // Not a fixed list: a new one is welcome, it just has to submit through the
    // helper. An empty sweep would mean the scanner stopped finding anything,
    // which is the way this guard could pass while guarding nothing.
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const source = readFileSync(path, 'utf8');
      const viaHelper = source.includes('onSubmit={submitTo(');
      const viaAction = Object.keys(ALLOWED).includes(path);
      expect(viaHelper || viaAction, `${path} reads its own buttons`).toBe(true);
    }
  });
});

describe('every other form hands its data over itself', () => {
  const converted = [
    'app/settings/look-form.tsx',
    'app/admin/look/site-theme-form.tsx',
    'app/admin/fields/field-form.tsx',
    'app/drugs/drug-form.tsx',
    'app/admin/tags/[slug]/member-picker.tsx',
    'app/admin/data/restore-form.tsx',
    'app/admin/indications/indication-list.tsx',
    'app/study/setups/setup-manager.tsx',
  ];

  it('submits through the one helper, so the reasoning has one home', () => {
    for (const path of converted) {
      const source = readFileSync(path, 'utf8');
      expect(source, `${path} import`).toContain("from '@/app/_components/submit'");
      expect(source, `${path} onSubmit`).toContain('onSubmit={submitTo(');
    }
  });

  it('leaves no form in those files on an action', () => {
    expect(usesFormAction().filter((path) => converted.includes(path))).toEqual([]);
  });

  it('is the only thing that calls preventDefault on a submit', () => {
    // If a form grows its own handler again, the explanation stops being in
    // one place and the next person re-derives it.
    const helper = readFileSync('app/_components/submit.ts', 'utf8');
    expect(helper).toContain('event.preventDefault();');
    expect(helper).toContain('startTransition(');

    for (const path of walk('app')) {
      if (path === 'app/_components/submit.ts') continue;
      expect(readFileSync(path, 'utf8'), path).not.toContain('new FormData(event.currentTarget)');
    }
  });
});
