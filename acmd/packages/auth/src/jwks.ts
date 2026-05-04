// @acmd/auth — JWKS Fetch + Cache Utility
//
// Fetches public keys from a JWKS endpoint (e.g. VOLLOS_AUTH_URL/.well-known/jwks.json)
// and caches them for 1 hour. Force-refreshes the cache when a kid is not found.
//
// Usage:
//   const publicKey = await fetchJwks('http://vollos-core-auth:3004');
//   // or with a specific kid:
//   const publicKey = await fetchJwks('http://vollos-core-auth:3004', 'vollos-access-v1');

import { importJWK } from 'jose';
import type { KeyLike, JWK } from 'jose';

// Cache TTL: 1 hour in milliseconds
const CACHE_TTL_MS = 60 * 60 * 1000;

interface JwksCache {
  keys: Map<string, KeyLike>; // kid → KeyLike
  fetchedAt: number;           // timestamp ms
}

// Module-level cache — shared across all calls in the same process
let cache: JwksCache | null = null;

/**
 * Fetch a JWKS endpoint and import all keys.
 * Returns a Map<kid, KeyLike>.
 */
async function loadJwks(jwksUrl: string): Promise<Map<string, KeyLike>> {
  const res = await fetch(jwksUrl);
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: ${res.status} ${res.statusText} — ${jwksUrl}`);
  }

  const body = (await res.json()) as { keys: JWK[] };
  if (!Array.isArray(body.keys)) {
    throw new Error(`JWKS response missing "keys" array — ${jwksUrl}`);
  }

  const result = new Map<string, KeyLike>();
  for (const jwk of body.keys) {
    if (!jwk.kid) continue; // skip keys without kid
    const key = await importJWK(jwk, jwk.alg ?? 'RS256') as KeyLike;
    result.set(jwk.kid, key);
  }

  if (result.size === 0) {
    throw new Error(`JWKS endpoint returned no usable keys — ${jwksUrl}`);
  }

  return result;
}

/**
 * Get the JWKS URL from a base auth URL.
 * Appends /.well-known/jwks.json if not already present.
 */
function toJwksUrl(authUrl: string): string {
  const base = authUrl.replace(/\/$/, '');
  return `${base}/.well-known/jwks.json`;
}

/**
 * Fetch (or return cached) public key from JWKS endpoint.
 *
 * Cache policy:
 * - Cache is valid for 1 hour after last fetch.
 * - If a requested kid is not in cache, force-refresh once.
 * - If kid is still not found after refresh, throws.
 *
 * @param authUrl - Base URL of the auth service (e.g. http://vollos-core-auth:3004)
 * @param kid     - Optional key ID to retrieve. If omitted, returns the first key.
 * @returns KeyLike suitable for jwtVerify
 */
export async function fetchJwks(authUrl: string, kid?: string): Promise<KeyLike> {
  const jwksUrl = toJwksUrl(authUrl);
  const now = Date.now();

  // Use cache if still fresh
  const cacheValid = cache !== null && now - cache.fetchedAt < CACHE_TTL_MS;

  if (cacheValid) {
    const key = kid ? cache!.keys.get(kid) : cache!.keys.values().next().value;
    if (key) return key;
    // kid not in cache — fall through to force-refresh
  }

  // Fetch (or force-refresh)
  const keys = await loadJwks(jwksUrl);
  cache = { keys, fetchedAt: now };

  const key = kid ? keys.get(kid) : keys.values().next().value;
  if (!key) {
    throw new Error(
      `JWKS key not found — kid="${kid ?? '<first>'}" not present in ${jwksUrl}`,
    );
  }

  return key;
}

/**
 * Invalidate the JWKS cache. Useful in tests.
 */
export function clearJwksCache(): void {
  cache = null;
}
