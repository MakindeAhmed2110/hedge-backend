import { env } from '../env.js';

const SCALE = 10 ** env.quoteDecimals;

/** Convert on-chain DUSDC raw amount to USD. */
export function rawQuoteToUsd(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw / SCALE;
}
