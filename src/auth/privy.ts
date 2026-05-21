import { createRemoteJWKSet, jwtVerify } from 'jose';

import { env } from '../env.js';

export type VerifiedPrivyToken = {
  userId: string;
  sessionId: string;
};

const PRIVY_AUTH_API = 'https://auth.privy.io/api';
const jwksByAppId = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(appId: string) {
  let jwks = jwksByAppId.get(appId);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${PRIVY_AUTH_API}/v1/apps/${appId}/jwks.json`), {
      cacheMaxAge: 60 * 60 * 1000,
    });
    jwksByAppId.set(appId, jwks);
  }
  return jwks;
}

export async function verifyPrivyAccessToken(
  accessToken: string
): Promise<VerifiedPrivyToken> {
  const appId = env.privyAppId;
  if (!appId) {
    throw new Error('PRIVY_APP_ID is not configured');
  }

  const { payload } = await jwtVerify(accessToken, getJwks(appId), {
    typ: 'JWT',
    algorithms: ['ES256'],
    issuer: 'privy.io',
    audience: appId,
  });

  const userId = payload.sub;
  const sessionId = payload.sid;
  if (typeof userId !== 'string' || typeof sessionId !== 'string') {
    throw new Error('Invalid Privy token payload');
  }

  return { userId, sessionId };
}
