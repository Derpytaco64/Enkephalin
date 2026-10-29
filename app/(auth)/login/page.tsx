import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in — Enkephalin' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Registration is invite-only.
      </p>
      <LoginForm next={next} />
    </main>
  );
}
