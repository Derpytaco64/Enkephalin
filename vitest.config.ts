import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './tests/test-db';

export default defineConfig({
  // The config is loaded as CommonJS (no "type": "module"), so import.meta
  // is unavailable here. Vitest always runs from the project root.
  resolve: { alias: { '@': process.cwd() } },
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    env: { DATABASE_URL: TEST_DATABASE_URL },
    // postgres-js wants real node builtins, which forks give us.
    pool: 'forks',
    hookTimeout: 90_000,
    testTimeout: 20_000,
  },
});
