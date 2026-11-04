import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { fieldDefs } from '@/db/schema';
import { updateFieldAction } from '../actions';
import { FieldForm } from '../field-form';

export default async function EditFieldPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [field] = await db.select().from(fieldDefs).where(eq(fieldDefs.id, id));
  if (!field) notFound();

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <Link href="/admin/fields" className="pill">← Fields</Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{field.label}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {field.isCore
          ? 'Core field: its value lives in its own column, so it cannot be removed.'
          : 'Values are stored under the key, so renaming the label keeps them.'}
      </p>
      <FieldForm action={updateFieldAction} field={field} submitLabel="Save changes" />
    </main>
  );
}
