/**
 * Applies the migrations to the throwaway test database, in its own process.
 *
 * Its own process on purpose. Run inside vitest's global setup, `postgres` and
 * drizzle's migrator go through Vite's module runner, where they fail with a
 * promise that never settles -- surfacing as "No test files found" plus a
 * sourcemap TypeError from vitest's error printer, with nothing said about a
 * database. Under tsx the same code has always worked, so the global setup
 * shells out to this and keeps itself to node builtins.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { TEST_DATABASE_URL } from './test-db.mjs';

const sql = postgres(TEST_DATABASE_URL, { max: 1 });
try {
  await migrate(drizzle(sql), { migrationsFolder: './db/migrations' });
} finally {
  await sql.end();
}
process.exit(0);
