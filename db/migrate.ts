import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Run on container start, before the server accepts traffic. Uses its own
 * single-connection pool so a failed migration cannot leave the app pool in a
 * half-open state.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const sql = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: './db/migrations' });
    console.log('migrations applied');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('migration failed:', err);
  process.exit(1);
});
