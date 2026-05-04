// @acmd/api — Trusted-proxy IP extractor (T-065 / SEC-001 fix)
//
// Auditor T-063 SEC-001 (review-auditor.md L54-L88) flagged that beta-signup
// reads `x-forwarded-for` unconditionally → an attacker can spoof a fresh IP
// on every request and bypass the 5/IP/hour rate limit entirely.
//
// Fix: only trust forwarded-for headers when the actual TCP peer IP is in
// the operator-configured `TRUSTED_PROXY_IPS` allowlist. Default = empty
// allowlist = trust nothing = always use the raw connection IP. Caddy /
// nginx / Cloudflare operators set TRUSTED_PROXY_IPS to the proxy IP(s)
// during deploy.
//
// Usage:
//   import { getTrustedClientIp } from '../middleware/trusted-proxy.js';
//   const ip = getTrustedClientIp(c);   // safe IP key for rate-limit + audit
//
// Format of TRUSTED_PROXY_IPS (env):
//   - comma-separated list
//   - IPv4 single host:    "10.0.0.5"
//   - IPv4 CIDR:           "10.0.0.0/8"
//   - IPv6 single host:    "::1"
//   - IPv6 CIDR:           "fc00::/7"
//   - Mixed:               "10.0.0.0/8,127.0.0.1,::1"
//   - Empty / unset:       trust nothing (use peer IP only)
//
// We deliberately re-parse the env on every call so tests can flip the
// value mid-suite without re-importing the module. The parse is cheap
// (split + length check) and the cache below avoids repeating the IPv4
// numeric conversion for the common case.

import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

/** Cache parsed CIDR list keyed on the raw env string. */
let cachedEnv = '';
let cachedNets: ParsedCidr[] = [];

interface ParsedCidr {
  /** Family discriminant — IPv6 uses BigInt math, IPv4 uses Number. */
  family: 4 | 6;
  /** Address as integer (IPv4) or BigInt (IPv6). */
  address: number | bigint;
  /** Mask as integer (IPv4) or BigInt (IPv6). */
  mask: number | bigint;
}

function parseTrustedProxyIps(): ParsedCidr[] {
  const raw = process.env['TRUSTED_PROXY_IPS'] ?? '';
  if (raw === cachedEnv) return cachedNets;
  cachedEnv = raw;
  cachedNets = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseCidr)
    .filter((n): n is ParsedCidr => n !== null);
  return cachedNets;
}

function parseCidr(entry: string): ParsedCidr | null {
  const slash = entry.indexOf('/');
  const ipPart = slash === -1 ? entry : entry.slice(0, slash);
  const prefixPart = slash === -1 ? null : entry.slice(slash + 1);

  if (ipPart.includes(':')) {
    // IPv6
    const addr = ipv6ToBigInt(ipPart);
    if (addr === null) return null;
    const prefix = prefixPart === null ? 128 : Number.parseInt(prefixPart, 10);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null;
    const mask = prefix === 0
      ? 0n
      : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - prefix)) - 1n);
    return { family: 6, address: addr & mask, mask };
  }

  const addr = ipv4ToInt(ipPart);
  if (addr === null) return null;
  const prefix = prefixPart === null ? 32 : Number.parseInt(prefixPart, 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  // Use unsigned shift: 32-bit mask. >>> 0 keeps it as a positive integer.
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { family: 4, address: (addr & mask) >>> 0, mask };
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const byte = Number.parseInt(part, 10);
    if (byte < 0 || byte > 255) return null;
    n = (n * 256 + byte) >>> 0;
  }
  return n;
}

function ipv6ToBigInt(ip: string): bigint | null {
  // Strip IPv4-mapped suffix into hex for simplicity (e.g. ::ffff:1.2.3.4).
  const lastColon = ip.lastIndexOf(':');
  let normalized = ip;
  if (lastColon !== -1 && ip.slice(lastColon + 1).includes('.')) {
    const v4 = ipv4ToInt(ip.slice(lastColon + 1));
    if (v4 === null) return null;
    const high = (v4 >>> 16) & 0xffff;
    const low = v4 & 0xffff;
    normalized = `${ip.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }
  const dblColon = normalized.indexOf('::');
  let head: string[] = [];
  let tail: string[] = [];
  if (dblColon === -1) {
    head = normalized.split(':');
  } else {
    head = normalized.slice(0, dblColon).split(':').filter((s) => s.length > 0);
    tail = normalized.slice(dblColon + 2).split(':').filter((s) => s.length > 0);
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...new Array<string>(missing).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    n = (n << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return n;
}

function isInTrustedSet(peerIp: string, nets: ParsedCidr[]): boolean {
  if (nets.length === 0) return false;
  if (peerIp.includes(':')) {
    const addr = ipv6ToBigInt(peerIp);
    if (addr === null) return false;
    for (const net of nets) {
      if (net.family !== 6) continue;
      if ((addr & (net.mask as bigint)) === (net.address as bigint)) return true;
    }
    return false;
  }
  const addr = ipv4ToInt(peerIp);
  if (addr === null) return false;
  for (const net of nets) {
    if (net.family !== 4) continue;
    if (((addr & (net.mask as number)) >>> 0) === (net.address as number)) return true;
  }
  return false;
}

/**
 * Read the underlying TCP peer IP via Hono's ConnInfo helper.
 *
 * Returns null when ConnInfo is unavailable (e.g., test request paths that
 * don't go through @hono/node-server). Tests can override the peer IP by
 * setting the `x-test-peer-ip` header — production code never reads it.
 */
function getPeerIp(c: Context): string | null {
  const testOverride = c.req.header('x-test-peer-ip');
  if (testOverride && (process.env['VITEST'] !== undefined || process.env['NODE_ENV'] === 'test')) {
    return testOverride;
  }
  try {
    const info = getConnInfo(c);
    const addr = info.remote?.address;
    if (typeof addr === 'string' && addr.length > 0) return addr;
  } catch {
    // ConnInfo not available (e.g. app.request() in unit tests). Caller
    // falls back to the header-only path below.
  }
  return null;
}

/**
 * Resolve the rate-limit / audit IP for a request.
 *
 * Decision tree:
 *   1. Read peer IP from ConnInfo. If unavailable (test path) → fall back to
 *      x-real-ip → 'unknown'.
 *   2. If peer IP is in TRUSTED_PROXY_IPS → trust the first entry of
 *      x-forwarded-for (strip whitespace), else fall back to peer IP.
 *   3. If peer IP is NOT trusted → ignore x-forwarded-for entirely; return
 *      peer IP. This is the SEC-001 fix: spoofed XFF cannot mint fresh keys.
 *
 * Returns 'unknown' as a last resort so the rate-limit key is never empty.
 */
export function getTrustedClientIp(c: Context): string {
  const nets = parseTrustedProxyIps();
  const peerIp = getPeerIp(c);

  if (peerIp && isInTrustedSet(peerIp, nets)) {
    const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (xff && xff.length > 0) return xff;
    const xri = c.req.header('x-real-ip')?.trim();
    if (xri && xri.length > 0) return xri;
    return peerIp;
  }

  if (peerIp && peerIp.length > 0) return peerIp;

  // Last-resort fallback for environments that don't expose ConnInfo (mostly
  // unit-test app.request() calls). This is intentionally conservative: if
  // we cannot identify the peer, prefer x-real-ip (set by reverse proxies)
  // over x-forwarded-for (easier to spoof). Never return an empty string —
  // an empty rate-limit key would let every spoofed request share one bucket.
  const xri = c.req.header('x-real-ip')?.trim();
  if (xri && xri.length > 0) return xri;
  const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (xff && xff.length > 0) return xff;
  return 'unknown';
}

/** Test-only — clear the parse cache so a test can change the env mid-suite. */
export function _resetTrustedProxyCacheForTests(): void {
  cachedEnv = '';
  cachedNets = [];
}
