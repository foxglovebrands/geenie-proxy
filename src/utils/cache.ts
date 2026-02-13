import NodeCache from 'node-cache';
import { config } from '../config/env.js';

// Create cache instance
// TTL is set from environment (default 300 seconds = 5 minutes)
export const cache = new NodeCache({
  stdTTL: config.cache.ttlSeconds,
  checkperiod: 60, // Check for expired keys every 60 seconds
  useClones: false, // Don't clone objects (faster)
});

// Helper function to get or set cache
export async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl?: number
): Promise<T> {
  // Try to get from cache
  const cached = cache.get<T>(key);

  if (cached !== undefined) {
    return cached;
  }

  // Not in cache, fetch it
  const value = await fetcher();

  // Store in cache
  cache.set(key, value, ttl);

  return value;
}

// Helper to invalidate cache
export function invalidateCache(key: string): void {
  cache.del(key);
}

// Helper to clear all cache
export function clearCache(): void {
  cache.flushAll();
}
