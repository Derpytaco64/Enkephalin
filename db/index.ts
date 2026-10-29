import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

// Next.js reloads modules in dev; cache the pool so we do not exhaust
// connections across hot reloads.
const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

let instance: Db | undefined;

function getDb(): Db {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = globalForDb.__sql ?? postgres(url, { max: 10 });
  if (process.env.NODE_ENV !== 'production') globalForDb.__sql = sql;
  instance = drizzle(sql, { schema });
  return instance;
}

// `next build` evaluates route modules with no env present, so resolving the
// connection at import time fails the build. Resolve on first use instead.
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const value = Reflect.get(getDb(), prop) as unknown;
    return typeof value === 'function' ? value.bind(getDb()) : value;
  },
});

export { schema };
