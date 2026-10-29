/** Shared between the vitest config and the global setup. */
export const TEST_DB_CONTAINER = 'enkephalin-test-db';
export const TEST_DB_PORT = 55432;
export const TEST_DATABASE_URL =
  `postgres://enkephalin:test@127.0.0.1:${TEST_DB_PORT}/enkephalin_test`;
