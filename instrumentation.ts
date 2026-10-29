export async function register() {
  // Must be a positive condition wrapping the import, not an early return:
  // NEXT_RUNTIME is inlined per build target, so this lets the edge bundle
  // drop the import entirely. db/index.ts reaches postgres, which needs node
  // APIs the edge runtime does not have.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { bootstrap } = await import('@/lib/bootstrap');
    await bootstrap();
  }
}
