import Link from 'next/link';

export default function Forbidden() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">403 — not yours</h1>
      <p className="mt-2 text-[var(--muted)]">
        You are signed in, but this page is for administrators.
      </p>
      {/* The only thing to do on this page, so it is shaped like a thing to
          do. Quiet rather than primary: it is a way out, not an achievement. */}
      <Link href="/" className="btn btn-quiet mt-8">
        Back to Enkephalin
      </Link>
    </main>
  );
}
