/** Matches Privy app username: `my-app/lib/privy/custom-metadata.ts` */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Canonical form for DB + URLs: `hedgeapp.trade/?ref=mankind` */
export function normalizeReferralCodeInput(code: string): string {
  return code.trim().toLowerCase();
}

export function referralCodeFromHandle(handle: string): string | null {
  const normalized = normalizeReferralCodeInput(handle);
  if (!USERNAME_PATTERN.test(normalized)) return null;
  return normalized;
}

export function validateHandleInput(handle: string): string | null {
  const normalized = referralCodeFromHandle(handle);
  if (!normalized) {
    return 'Use 3–20 characters: lowercase letters, numbers, and underscores only.';
  }
  return null;
}

export function buildReferralUrl(baseUrl: string, username: string): string {
  const base = baseUrl.replace(/\/$/, '');
  const code = normalizeReferralCodeInput(username);
  return `${base}/?ref=${encodeURIComponent(code)}`;
}
