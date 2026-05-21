import type { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';

import { verifyPrivyAccessToken } from '../auth/privy.js';
import { env, isServiceKeyConfigured } from '../env.js';
import { findUserIdByPrivyId } from '../lib/users.js';
import { db } from '../db/index.js';

export type AuthVariables = {
  privyUserId: string;
  userId?: string;
};

function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

/** Service key for BFF/cron, or Privy JWT when PRIVY_APP_ID is set. */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c: Context, next: Next) => {
    const token = parseBearer(c.req.header('Authorization'));

    if (!token) {
      return c.json({ error: 'Missing Authorization header' }, 401);
    }

    if (isServiceKeyConfigured() && token === env.serviceKey) {
      const privyUserId = c.req.header('X-Privy-User-Id')?.trim();
      if (!privyUserId) {
        return c.json({ error: 'X-Privy-User-Id required with service key' }, 401);
      }
      c.set('privyUserId', privyUserId);
      const userId = await findUserIdByPrivyId(db, privyUserId);
      if (userId) c.set('userId', userId);
      await next();
      return;
    }

    if (!env.privyAppId) {
      return c.json({ error: 'Auth not configured (set PRIVY_APP_ID or HEDGE_SERVICE_KEY)' }, 503);
    }

    try {
      const verified = await verifyPrivyAccessToken(token);
      c.set('privyUserId', verified.userId);
      const userId = await findUserIdByPrivyId(db, verified.userId);
      if (userId) c.set('userId', userId);
      await next();
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
  }
);

export const requireServiceKey = createMiddleware(async (c: Context, next: Next) => {
  const token = parseBearer(c.req.header('Authorization'));
  if (!isServiceKeyConfigured() || token !== env.serviceKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});
