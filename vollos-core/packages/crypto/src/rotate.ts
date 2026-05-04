/**
 * Key rotation utilities.
 *
 * rotateKey      — re-encrypt a single ciphertext with a new key.
 * rotateAllRecords — batch re-encrypt with rollback on failure.
 *
 * Dual-key support:
 *   During an in-progress rotation the app should call decrypt() trying newKey
 *   first, falling back to oldKey.  Use `decryptWithFallback()` for this.
 *
 * SECURITY: Never log decrypted content.
 */

import { decrypt, encrypt, validateKey } from './encrypt.js';

// ---------------------------------------------------------------------------
// rotateKey
// ---------------------------------------------------------------------------

/**
 * Re-encrypt a single ciphertext from oldKey to newKey.
 *
 * @param ciphertext - `${iv}:${authTag}:${ciphertext}` produced by encrypt()
 * @param oldKeyHex  - 64-char hex key that was used to encrypt the record
 * @param newKeyHex  - 64-char hex key to re-encrypt with
 * @returns New ciphertext encrypted with newKey
 */
export function rotateKey(
  ciphertext: string,
  oldKeyHex: string,
  newKeyHex: string,
): string {
  // Validate both keys upfront — fail fast before any decryption
  validateKey(oldKeyHex);
  validateKey(newKeyHex);

  const plaintext = decrypt(ciphertext, oldKeyHex);
  return encrypt(plaintext, newKeyHex);
}

// ---------------------------------------------------------------------------
// decryptWithFallback  (dual-key support during rotation)
// ---------------------------------------------------------------------------

/**
 * Try decrypting with newKey first; if that fails fall back to oldKey.
 * Use this during a rolling rotation so both old- and new-encrypted records
 * are readable without downtime.
 *
 * @param ciphertext - ciphertext to decrypt
 * @param newKeyHex  - preferred (new) key
 * @param oldKeyHex  - fallback key
 * @returns Decrypted plaintext
 * @throws Error only when both keys fail
 */
export function decryptWithFallback(
  ciphertext: string,
  newKeyHex: string,
  oldKeyHex: string,
): string {
  validateKey(newKeyHex);
  validateKey(oldKeyHex);

  try {
    return decrypt(ciphertext, newKeyHex);
  } catch {
    // newKey failed — try oldKey (record not yet rotated)
    return decrypt(ciphertext, oldKeyHex);
  }
}

// ---------------------------------------------------------------------------
// rotateAllRecords
// ---------------------------------------------------------------------------

export interface RotateRecord {
  id: string | number;
  ciphertext: string;
}

export interface RotateResult {
  id: string | number;
  /** New ciphertext encrypted with newKey */
  ciphertext: string;
}

export interface RotateAllOptions {
  /** Number of records per batch (default: 100) */
  batchSize?: number;
}

export interface RotateAllResult {
  /** Records successfully rotated */
  rotated: RotateResult[];
  /** Records that failed (with error messages — no plaintext) */
  failed: Array<{ id: string | number; error: string }>;
}

/**
 * Batch re-encrypt all records from oldKey to newKey.
 *
 * Batch semantics:
 *   - Processes records in chunks of `batchSize`.
 *   - If any record in a batch fails, that entire batch is rolled back
 *     (its records are excluded from `rotated`) and each failure is
 *     reported in `failed`.
 *   - Successfully completed batches are NOT rolled back when a later
 *     batch fails — the caller is responsible for persisting `rotated`
 *     records and retrying `failed` ones.
 *
 * @param records  - Array of { id, ciphertext } to rotate
 * @param oldKeyHex - Current encryption key (hex 64 chars)
 * @param newKeyHex - New encryption key (hex 64 chars)
 * @param options   - { batchSize } defaults to 100
 * @returns { rotated, failed }
 */
export function rotateAllRecords(
  records: RotateRecord[],
  oldKeyHex: string,
  newKeyHex: string,
  options: RotateAllOptions = {},
): RotateAllResult {
  // Validate both keys once upfront — fail fast
  validateKey(oldKeyHex);
  validateKey(newKeyHex);

  const { batchSize = 100 } = options;
  const rotated: RotateResult[] = [];
  const failed: Array<{ id: string | number; error: string }> = [];

  // Process in batches
  for (let start = 0; start < records.length; start += batchSize) {
    const batch = records.slice(start, start + batchSize);
    const batchResults: RotateResult[] = [];
    let batchFailed = false;
    const batchErrors: Array<{ id: string | number; error: string }> = [];

    for (const record of batch) {
      try {
        const newCiphertext = rotateKey(record.ciphertext, oldKeyHex, newKeyHex);
        batchResults.push({ id: record.id, ciphertext: newCiphertext });
      } catch {
        // Do NOT include plaintext in error — generic message only
        batchFailed = true;
        batchErrors.push({
          id: record.id,
          error: 'encryption/decryption error',
        });
      }
    }

    if (batchFailed) {
      // Rollback: discard all batchResults for this batch
      for (const err of batchErrors) {
        failed.push(err);
      }
      // Also mark successfully-processed records in this batch as failed
      // so none of the partial batch is committed
      for (const r of batchResults) {
        failed.push({ id: r.id, error: 'batch rolled back due to sibling failure' });
      }
    } else {
      for (const r of batchResults) {
        rotated.push(r);
      }
    }
  }

  return { rotated, failed };
}
