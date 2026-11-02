/**
 * Env for host-run scripts, imported for its side effect before anything
 * touches the database.
 *
 * The app gets `DATABASE_URL` from compose, where the host is `db` -- a name
 * that only resolves inside the compose network. A script run from a terminal
 * needs the published loopback address instead, which is what
 * `DATABASE_URL_HOST` carries. Preferring it here means `npm run export` works
 * from a terminal and from a scheduled task without anyone exporting a
 * variable by hand.
 *
 * Reading .env is deliberate and narrow: these scripts are operator tools on
 * the machine that owns the database, not part of the served app.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // No .env is fine: a real environment may supply the variables directly.
}

if (process.env.DATABASE_URL_HOST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_HOST;
}

if (!process.env.DATABASE_URL) {
  console.error(
    'No DATABASE_URL. Set DATABASE_URL_HOST in .env to the published address,\n'
    + 'e.g. postgres://enkephalin:<password>@127.0.0.1:5432/enkephalin',
  );
  process.exit(1);
}
