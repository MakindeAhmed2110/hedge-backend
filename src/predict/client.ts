import { env } from '../env.js';
import type {
  PredictPositionMintedEvent,
  PredictPositionRedeemedEvent,
} from './types.js';

async function predictFetch<T>(path: string): Promise<T> {
  const url = `${env.predictServerUrl}${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `Predict server error (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function fetchPositionsMinted(
  limit = 500
): Promise<PredictPositionMintedEvent[]> {
  return predictFetch<PredictPositionMintedEvent[]>(`/positions/minted?limit=${limit}`);
}

export async function fetchPositionsRedeemed(
  limit = 500
): Promise<PredictPositionRedeemedEvent[]> {
  return predictFetch<PredictPositionRedeemedEvent[]>(`/positions/redeemed?limit=${limit}`);
}
