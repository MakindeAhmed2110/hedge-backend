import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { databaseSslMode, env } from '../env.js';
import * as schema from './schema.js';

const ssl = databaseSslMode();
const client = postgres(env.databaseUrl, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 8),
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: true,
  ...(ssl ? { ssl } : {}),
});

export const db = drizzle(client, { schema });

export type Database = typeof db;

export async function closeDb(): Promise<void> {
  await client.end();
}
