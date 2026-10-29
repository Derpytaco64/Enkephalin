import Link from 'next/link';

export default function AdminHome() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
      <ul className="mt-6 space-y-2">
        <li>
          <Link href="/admin/fields" className="text-[var(--accent)] underline">Fields</Link>
        </li>
        <li>
          <Link href="/admin/invites" className="text-[var(--accent)] underline">Invites</Link>
        </li>
      </ul>
    </main>
  );
}
