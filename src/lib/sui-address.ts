/** Canonical form for comparing Privy wallets to Predict `trader` / `owner` fields. */
export function normalizeSuiAddress(address: string): string {
  return address.trim().toLowerCase();
}
