import { Hono } from 'hono';

import { db } from '../db/index.js';
import { runPredictIndexer } from '../predict/indexer.js';
import {
  getIndexerJobStatus,
  isIndexerRunning,
  startIndexerInBackground,
} from '../predict/indexer-run-state.js';
import { requireServiceKey } from '../middleware/auth.js';

export const internalRoutes = new Hono();

/** Poll after POST /internal/index/run — no auth required if you use service key on POST only; keep status behind key too */
internalRoutes.get('/internal/index/status', requireServiceKey, (c) => {
  return c.json({ data: getIndexerJobStatus() });
});

internalRoutes.post('/internal/index/run', requireServiceKey, async (c) => {
  const wait = c.req.query('wait') === 'true';

  if (wait) {
    const result = await runPredictIndexer(db);
    return c.json({ data: result });
  }

  if (isIndexerRunning()) {
    return c.json(
      {
        data: {
          status: 'already_running',
          message: 'Indexer is still running. GET /internal/index/status to poll.',
          job: getIndexerJobStatus(),
        },
      },
      202
    );
  }

  const started = startIndexerInBackground(() => runPredictIndexer(db));
  if (!started) {
    return c.json({ error: 'Could not start indexer' }, 500);
  }

  return c.json(
    {
      data: {
        status: 'started',
        message:
          'Indexer running in background (first run can take several minutes). Poll GET /internal/index/status.',
      },
    },
    202
  );
});
