import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './tests/test-db.mjs';

export default defineConfig({
  // Vitest always runs from the project root.
  resolve: { alias: { '@': process.cwd() } },
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      // No test asks the National Library of Medicine anything. The class
      // lookup's own tests drive it with a stub instead -- see
      // `tests/class-lookup.test.ts` -- and every other test creates drugs
      // without waiting on a network that may not be there.
      DRUG_CLASS_LOOKUP: 'off',
    },
    // postgres-js wants real node builtins, which forks give us.
    pool: 'forks',
    // One shared database, so files must not run at the same time: each
    // truncates the tables it seeds, and in parallel they wipe each other's
    // fixtures mid-test.
    fileParallelism: false,
    hookTimeout: 90_000,
    testTimeout: 20_000,
  },
});
