/**
 * @vollos/crypto
 *
 * Product-agnostic AES-256-GCM encryption utilities.
 *
 * Usage:
 *   import { validateKey, encrypt, decrypt, rotateKey, rotateAllRecords, decryptWithFallback } from '@vollos/crypto';
 *
 * Key management:
 *   - Key format: hex string 64 characters = 32 bytes
 *   - Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   - Store key in product-specific env var (e.g. ACMD_ENCRYPTION_KEY)
 *   - Call validateKey() at startup — fail fast if key is missing/malformed
 *   - Back up keys separately from the database — loss of key = all encrypted data unreadable
 *
 * Key rotation strategy:
 *   1. Set new key in env (keep old key accessible too)
 *   2. Call rotateAllRecords() to re-encrypt all records
 *   3. During rotation use decryptWithFallback(newKey, oldKey) so both key versions work
 *   4. After all records rotated, remove old key from env
 */

export { decrypt, encrypt, validateKey } from './encrypt.js';
export {
  decryptWithFallback,
  rotateAllRecords,
  rotateKey,
  type RotateAllOptions,
  type RotateAllResult,
  type RotateRecord,
  type RotateResult,
} from './rotate.js';
