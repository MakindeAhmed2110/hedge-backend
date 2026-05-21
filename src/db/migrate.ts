import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { assertRuntimeConfig } from '../env.js';
import { closeDb, db } from './index.js';

async function main() {
  assertRuntimeConfig();
  console.log('Running migrations…');
  await migrate(db, { migrationsFolder: './drizzle' });
  await closeDb();
  console.log('Migrations complete.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
