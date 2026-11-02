/**
 * Shared between the vitest config and the global setup.
 *
 * Plain `.mjs` on purpose. As a `.ts` file imported without an extension it
 * went through Vite's CommonJS config-loading path, which vite 8 warns is
 * going away -- and which crashed vitest's startup on roughly half of runs,
 * reported as "No test files found" plus a sourcemap TypeError thrown from the
 * error printer rather than as anything to do with this file.
 */
export const TEST_DB_CONTAINER = 'enkephalin-test-db';
export const TEST_DB_PORT = 55432;
export const TEST_DATABASE_URL =
  `postgres://enkephalin:test@127.0.0.1:${TEST_DB_PORT}/enkephalin_test`;
