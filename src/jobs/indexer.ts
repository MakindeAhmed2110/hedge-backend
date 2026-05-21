import { closeDb, db } from '../db/index.js';
import { runPredictIndexer } from '../predict/indexer.js';

async function main() {
  const result = await runPredictIndexer(db);
  console.log(JSON.stringify(result, null, 2));
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
