type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const stores = new Map<string, Map<string, CacheEntry<unknown>>>();

function getStore(name: string): Map<string, CacheEntry<unknown>> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

export function cacheGet<T>(namespace: string, key: string): T | null {
  const entry = getStore(namespace).get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    getStore(namespace).delete(key);
    return null;
  }
  return entry.value as T;
}

export function cacheSet<T>(namespace: string, key: string, value: T, ttlMs: number): void {
  getStore(namespace).set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheDelete(namespace: string, key: string): void {
  getStore(namespace).delete(key);
}

export function cacheClearNamespace(namespace: string): void {
  stores.delete(namespace);
}
