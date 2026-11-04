'use client';

import { startTransition, type FormEvent } from 'react';

/**
 * Hands a form's data to `run` on submit, **without React resetting the form**.
 *
 * `<form action={fn}>` looks like the right way to do this and is not, for any
 * form whose fields are seeded from something stored. React calls
 * `requestFormReset` on the form fiber before it runs the action, and the
 * commit that follows calls the DOM's own `form.reset()`. What that does:
 *
 * - An **uncontrolled `<select>`** goes back to the option selected when it
 *   mounted and stays there, because on update React only reapplies a select's
 *   `defaultValue` if `multiple` changed. The save works and the control sits
 *   there showing the old answer.
 * - A **controlled** control is no safer. `reset()` dispatches no change event,
 *   so React's restore path -- which only ever runs in response to an event it
 *   intercepted -- never fires, and the reset changes nothing in state, so
 *   there is no re-render to repaint from either. The DOM and the state
 *   disagree and React is content.
 *
 * So the escape is not to hold the value differently, it is to not use
 * `action`: `preventDefault` on a plain submit never reaches
 * `startHostTransition`, so no reset is ever scheduled.
 *
 * The transition is for `useActionState`: its dispatch only sets `isPending`
 * when it is called inside one. Forms that track their own pending flag are
 * unaffected by being wrapped.
 *
 * **A form action is still right where clearing the fields is the point** -- a
 * create form that should come back empty for the next one. `tests/form-reset.test.ts`
 * holds the list of those and fails on any form that joins it without a
 * reason being written down.
 */
export function submitTo(run: (formData: FormData) => unknown) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => { void run(formData); });
  };
}
