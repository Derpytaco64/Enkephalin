import Link from 'next/link';
import { createFieldAction } from '../actions';
import { FieldForm } from '../field-form';

export const metadata = { title: 'New field — Enkephalin' };

export default function NewFieldPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <Link href="/admin/fields" className="pill">← Fields</Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">New field</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        It appears on profiles and in the field picker immediately — no deploy, no migration.
      </p>
      <FieldForm action={createFieldAction} submitLabel="Create field" />
    </main>
  );
}
