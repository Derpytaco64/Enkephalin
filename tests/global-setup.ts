import { execFileSync } from 'node:child_process';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { TEST_DATABASE_URL, TEST_DB_CONTAINER, TEST_DB_PORT } from './test-db';

function docker(args: string[]) {
  return execFileSync('docker', args, { stdio: 'pipe' }).toString();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  docker([
    'run', '-d', '--rm', '--name', TEST_DB_CONTAINER,
    '-e', 'POSTGRES_USER=enkephalin',
    '-e', 'POSTGRES_PASSWORD=test',
    '-e', 'POSTGRES_DB=enkephalin_test',
    '-p', `127.0.0.1:${TEST_DB_PORT}:5432`,
    'postgres:17-alpine',
  ]);

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
