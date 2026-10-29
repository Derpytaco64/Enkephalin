import { execFileSync } from 'node:child_process';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { TEST_DATABASE_URL, TEST_DB_CONTAINER, TEST_DB_PORT } from './test-db';

/**
 * Surfaces docker's stderr. Without it a failure here reaches you as vitest's
 * "No test files found" plus a sourcemap TypeError from its error printer,
 * which reads like a broken config and is not one.
 */
function docker(args: string[]) {
  try {
    return execFileSync('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (err) {
    const { stderr, message } = err as { stderr?: Buffer; message?: string };
    throw new Error(`docker ${args.join(' ')} failed: ${stderr?.toString().trim() || message}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retried because the published port can still be held for a moment after a
 * previous run's container goes away, and a first attempt then fails with
 * "port is already allocated".
 */
async function startContainer() {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      docker([
        'run', '-d', '--rm', '--name', TEST_DB_CONTAINER,
        '-e', 'POSTGRES_USER=enkephalin',
        '-e', 'POSTGRES_PASSWORD=test',
        '-e', 'POSTGRES_DB=enkephalin_test',
        '-p', `127.0.0.1:${TEST_DB_PORT}:5432`,
        'postgres:17-alpine',
      ]);
      return;
    } catch (err) {
      lastError = err;
      await sleep(2000);
    }
  }

  throw lastError;
}

/**
 * Tests run against a real Postgres, never a mock: a mocked database cannot
 * tell us whether the invite claim is actually atomic. It is a throwaway
 * container on its own port, dropped in teardown, so a test run can never
 * reach the development database.
 */
export async function setup() {
  try {
    docker(['rm', '-f', TEST_DB_CONTAINER]);
  } catch {
    // not running, which is the normal case
  }

  await startContainer();

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      docker(['exec', TEST_DB_CONTAINER, 'pg_isready', '-U', 'enkephalin', '-d', 'enkephalin_test']);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error('test database never became ready');
      await sleep(500);
    }
  }

  const sql = postgres(TEST_DATABASE_URL, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: './db/migrations' });
  } finally {
    await sql.end();
  }
}

export async function teardown() {
  try {
    docker(['rm', '-f', TEST_DB_CONTAINER]);
  } catch {
    // already gone
  }
}
