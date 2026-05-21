import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../db/index.js';
import { env } from '../env.js';
import {
  createWaitlistUser,
  findWaitlistByEmail,
  getWaitlistReferralStats,
  getWaitlistStats,
  isWaitlistHandleAvailable,
  normalizeWaitlistHandle,
  toWaitlistDto,
  updateWaitlistFlags,
} from '../lib/waitlist.js';

function waitlistDisabled(c: { json: (body: unknown, status?: number) => Response }) {
  if (!env.waitlistEnabled) {
    return c.json({ error: 'Waitlist is disabled' }, 503);
  }
  return null;
}

const createSchema = z.object({
  email: z.string().email(),
  handle: z.string().min(3).max(20),
  wallet_address: z.string().optional(),
  referred_by_handle: z.string().min(3).max(20).optional(),
});

const flagsSchema = z.object({
  handle: z.string().min(3).max(20),
  shared_on_x: z.boolean().optional(),
  downloaded_app: z.boolean().optional(),
});

export const waitlistRoutes = new Hono();

waitlistRoutes.get('/waitlist/config', (c) => {
  return c.json({
    data: {
      enabled: env.waitlistEnabled,
      referral_bonus_percent: env.waitlistReferralBonusPercent,
      points: {
        base: env.waitlistBasePoints,
        referral_given: env.waitlistReferralGivenPoints,
        referral_used: env.waitlistReferralUsedPoints,
        shared_on_x: env.waitlistSharedOnXPoints,
        downloaded_app: env.waitlistDownloadedAppPoints,
      },
    },
  });
});

waitlistRoutes.post('/waitlist', async (c) => {
  const disabled = waitlistDisabled(c);
  if (disabled) return disabled;

  const parsed = createSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const user = await createWaitlistUser(db, {
      email: parsed.data.email,
      handle: parsed.data.handle,
      walletAddress: parsed.data.wallet_address ?? null,
      referredByHandle: parsed.data.referred_by_handle ?? null,
    });
    return c.json({ success: true, data: user }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to join waitlist';
    return c.json({ error: { message, code: 'WAITLIST_ERROR' } }, 400);
  }
});

waitlistRoutes.get('/waitlist', async (c) => {
  const disabled = waitlistDisabled(c);
  if (disabled) return disabled;

  const email = c.req.query('email')?.trim().toLowerCase();
  if (!email) {
    return c.json({ error: 'email query param is required' }, 400);
  }

  const user = await findWaitlistByEmail(db, email);
  if (!user) {
    return c.json({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);
  }
  return c.json({ success: true, data: toWaitlistDto(user) });
});

waitlistRoutes.get('/waitlist/stats', async (c) => {
  const disabled = waitlistDisabled(c);
  if (disabled) return disabled;

  const stats = await getWaitlistStats(db);
  return c.json({ success: true, data: stats });
});

waitlistRoutes.get('/waitlist/referral', async (c) => {
  const disabled = waitlistDisabled(c);
  if (disabled) return disabled;

  const handle = c.req.query('handle');
  if (!handle) {
    return c.json({ error: 'handle query param is required' }, 400);
  }

  const stats = await getWaitlistReferralStats(db, handle);
  if (!stats) {
    return c.json({ error: { message: 'Handle not found', code: 'NOT_FOUND' } }, 404);
  }
  return c.json({ success: true, data: stats });
});

waitlistRoutes.get('/waitlist/handle/:handle', async (c) => {
  const disabled = waitlistDisabled(c);
  if (disabled) return disabled;

  const normalized = normalizeWaitlistHandle(c.req.param('handle'));
  if (!normalized) {
    return c.json({ success: true, data: { available: false, reason: 'invalid_format' } });
  }
  const available = await isWaitlistHandleAvailable(db, normalized);
  return c.json({ success: true, data: { available, handle: normalized } });
});

waitlistRoutes.patch('/waitlist/flags', async (c) => {
  const disabled = waitlistDisabled(c);
  if (disabled) return disabled;

  const parsed = flagsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const user = await updateWaitlistFlags(db, parsed.data.handle, {
      sharedOnX: parsed.data.shared_on_x,
      downloadedApp: parsed.data.downloaded_app,
    });
    return c.json({ success: true, data: user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Update failed';
    return c.json({ error: { message, code: 'WAITLIST_ERROR' } }, 400);
  }
});
