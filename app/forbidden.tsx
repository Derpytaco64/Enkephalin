import Link from 'next/link';

export default function Forbidden() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">403 — not yours</h1>
      <p className="mt-2 text-[var(--muted)]">
        You are signed in, but this page is for administrators.
      </p>
      <Link href="/" className="mt-8 inline-block text-sm text-[var(--accent)] underline">
        Back to Enkephalin
      </Link>
    </main>
  );
}
