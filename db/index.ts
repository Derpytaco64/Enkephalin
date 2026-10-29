import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// Next.js reloads modules in dev; cache the pool so we do not exhaust
// connections across hot reloads.
const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };
const sql = globalForDb.__sql ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== 'production') globalForDb.__sql = sql;

export const db = drizzle(sql, { schema });
export { schema };
