import type { IndexerRunResult } from './indexer.js';

export type IndexerJobStatus = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  result: IndexerRunResult | null;
  error: string | null;
};

let running = false;
let startedAt: Date | null = null;
let finishedAt: Date | null = null;
let lastResult: IndexerRunResult | null = null;
let lastError: string | null = null;

export function getIndexerJobStatus(): IndexerJobStatus {
  return {
    running,
    startedAt: startedAt?.toISOString() ?? null,
    finishedAt: finishedAt?.toISOString() ?? null,
    result: lastResult,
    error: lastError,
  };
}

export function isIndexerRunning(): boolean {
  return running;
}

export function startIndexerInBackground(run: () => Promise<IndexerRunResult>): boolean {
  if (running) return false;

  running = true;
  startedAt = new Date();
  finishedAt = null;
  lastError = null;

  void run()
    .then((result) => {
      lastResult = result;
    })
    .catch((error) => {
      lastError = error instanceof Error ? error.message : 'Indexer failed';
      console.error('[indexer]', error);
    })
    .finally(() => {
      running = false;
      finishedAt = new Date();
    });

  return true;
}
