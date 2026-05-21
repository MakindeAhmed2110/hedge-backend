import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { assertRuntimeConfig, env } from './env.js';
import { healthRoutes } from './routes/health.js';
import { internalRoutes } from './routes/internal.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { userRoutes } from './routes/users.js';
import { waitlistRoutes } from './routes/waitlist.js';

assertRuntimeConfig();

const app = new Hono();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['Authorization', 'Content-Type', 'X-Privy-User-Id'],
    allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  })
);

const api = new Hono();
api.route('/', healthRoutes);
api.route('/', userRoutes);
api.route('/', waitlistRoutes);
api.route('/', leaderboardRoutes);
api.route('/', internalRoutes);

app.route('/', api);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((error, c) => {
  console.error(error);
  const message =
    env.nodeEnv === 'development' && error instanceof Error
      ? error.message
      : 'Internal server error';
  return c.json({ error: message }, 500);
});

const port = env.port;
console.log(`Hedge API listening on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
