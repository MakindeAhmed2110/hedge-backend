import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { closeDb, db } from './index.js';

async function main() {
  console.log('Running migrations…');
  await migrate(db, { migrationsFolder: './drizzle' });
  await closeDb();
  console.log('Migrations complete.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
