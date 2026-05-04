import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../src/encrypt.js';
import {
  decryptWithFallback,
  rotateAllRecords,
  rotateKey,
} from '../src/rotate.js';
import { randomBytes } from 'node:crypto';

function makeKeyHex(): string {
  return randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// rotateKey
// ---------------------------------------------------------------------------

describe('rotateKey()', () => {
  it('produces ciphertext decryptable by newKey', () => {
    const oldKey = makeKeyHex();
    const newKey = makeKeyHex();
    const plaintext = 'top secret medical note';

    const original = encrypt(plaintext, oldKey);
    const rotated = rotateKey(original, oldKey, newKey);

    expect(decrypt(rotated, newKey)).toBe(plaintext);
  });

  it('rotated ciphertext cannot be decrypted with oldKey', () => {
    const oldKey = makeKeyHex();
    const newKey = makeKeyHex();
    const original = encrypt('data', oldKey);
    const rotated = rotateKey(original, oldKey, newKey);

    expect(() => decrypt(rotated, oldKey)).toThrow('encryption/decryption error');
  });

  it('throws on invalid oldKey', () => {
    const newKey = makeKeyHex();
    expect(() => rotateKey('a:b:c', 'bad', newKey)).toThrow();
  });

  it('throws on invalid newKey', () => {
    const oldKey = makeKeyHex();
    const ct = encrypt('x', oldKey);
    expect(() => rotateKey(ct, oldKey, 'bad')).toThrow();
  });

  it('throws when oldKey cannot decrypt ciphertext', () => {
    const oldKey = makeKeyHex();
    const wrongKey = makeKeyHex();
    const newKey = makeKeyHex();
    const ct = encrypt('secret', wrongKey);

    expect(() => rotateKey(ct, oldKey, newKey)).toThrow('encryption/decryption error');
  });

  it('re-encrypted ciphertext differs from original (fresh IV)', () => {
    const oldKey = makeKeyHex();
    const newKey = makeKeyHex();
    const ct = encrypt('data', oldKey);
    const rotated = rotateKey(ct, oldKey, newKey);

    // Different key → necessarily different output
    expect(rotated).not.toBe(ct);
  });
});

// ---------------------------------------------------------------------------
// decryptWithFallback  (dual-key support)
// ---------------------------------------------------------------------------

describe('decryptWithFallback()', () => {
  it('decrypts with newKey when record already rotated', () => {
    const oldKey = makeKeyHex();
    const newKey = makeKeyHex();
    const plaintext = 'already rotated';
    const ct = encrypt(plaintext, newKey);

    expect(decryptWithFallback(ct, newKey, oldKey)).toBe(plaintext);
  });

  it('falls back to oldKey when record not yet rotated', () => {
    const oldKey = makeKeyHex();
    const newKey = makeKeyHex();
    const plaintext = 'not yet rotated';
    const ct = encrypt(plaintext, oldKey);

    expect(decryptWithFallback(ct, newKey, oldKey)).toBe(plaintext);
  });

  it('throws when both keys fail', () => {
    const key1 = makeKeyHex();
    const key2 = makeKeyHex();
    const key3 = makeKeyHex();
    const ct = encrypt('locked', key3);

    expect(() => decryptWithFallback(ct, key1, key2)).toThrow(
      'encryption/decryption error',
    );
  });

  it('throws on invalid newKey', () => {
    const oldKey = makeKeyHex();
    const ct = encrypt('x', oldKey);
    expect(() => decryptWithFallback(ct, 'bad', oldKey)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// rotateAllRecords
// ---------------------------------------------------------------------------

describe('rotateAllRecords()', () => {
  function makeRecords(count: number, keyHex: string) {
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      ciphertext: encrypt(`plaintext-${i}`, keyHex),
    }));
  }

  it('rotates all records successfully', () => {
    const oldKey = makeKeyHex();
    const newKey = makeKeyHex();
    const records = makeRecords(5, oldKey);

    const { rotated, failed } = rotateAllRecords(records, oldKey, newKey);

    expect(failed.length).toBe(0);
    expect(rotated.length).toBe(5);
    // Each rotated record must decrypt with newKey to correct plaintext
    for (let i = 0; i < 5; i++) {
      expect(decrypt(rotated[i].ciphertext, newKey)).toBe(`plaintext-${i}`);
    }
  });

  it('returns empty arrays for empty input', () => {
    const oldKey = makeKeyHex();
    const newKey = makeKeyHex();
    const { rotated, failed } = rotateAllRecords([], oldKey, newKey);
    expect(rotated).toEqual([]);
    expect(failed).toEqual([]);
  });

  it('rolls back the entire batch when one record fails', () => {
    const oldKey = makeKeyHex();
    const newKey = makeKeyHex();
    const wrongKey = makeKeyHex();

    // 3 good records + 1 bad (encrypted with wrongKey)
    const records = [
      { id: 1, ciphertext: encrypt('a', oldKey) },
      { id: 2, ciphertext: encrypt('b', oldKey) },
      { id: 3, ciphertext: encrypt('bad', wrongKey) }, // will fail
      { id: 4, ciphertext: encrypt('d', oldKey) },
    ];

    // batchSize=4 so all 4 are in the same batch
    const { rotated, failed } = rotateAllRecords(records, oldKey, newKey, {
      batchSize: 4,
    });

    expect(rotated.length).toBe(0); // entire batch rolled back
    expect(failed.length).toBe(4); // all 4 reported as failed
    // The originally-bad record must be in failed
    expect(failed.some((f) => f.id === 3)).toBe(true);
  });

  it('keeps successful batches when a later batch fails', () => {
    const oldKey = makeKeyHex();
    const newKey = makeKeyHex();
    const wrongKey = makeKeyHex();

    // batch 1: 2 good records, batch 2: 1 good + 1 bad
    const records = [
      { id: 1, ciphertext: encrypt('a', oldKey) },
      { id: 2, ciphertext: encrypt('b', oldKey) },
      { id: 3, ciphertext: encrypt('c', oldKey) },
      { id: 4, ciphertext: encrypt('bad', wrongKey) }, // will fail
    ];

    const { rotated, failed } = rotateAllRecords(records, oldKey, newKey, {
      batchSize: 2,
    });

    // First batch (ids 1,2) rotated OK
    expect(rotated.length).toBe(2);
    expect(rotated.map((r) => r.id)).toEqual([1, 2]);

    // Second batch (ids 3,4) rolled back entirely
    expect(failed.length).toBe(2);
    expect(failed.some((f) => f.id === 4)).toBe(true);
    expect(failed.some((f) => f.id === 3)).toBe(true); // collateral rollback
  });

  it('respects custom batchSize', () => {
    const oldKey = makeKeyHex();
    const newKey = makeKeyHex();
    const records = makeRecords(10, oldKey);

    const { rotated, failed } = rotateAllRecords(records, oldKey, newKey, {
      batchSize: 3,
    });

    expect(failed.length).toBe(0);
    expect(rotated.length).toBe(10);
  });

  it('throws on invalid oldKey (fail fast)', () => {
    const newKey = makeKeyHex();
    expect(() =>
      rotateAllRecords([{ id: 1, ciphertext: 'a:b:c' }], 'bad', newKey),
    ).toThrow();
  });

  it('throws on invalid newKey (fail fast)', () => {
    const oldKey = makeKeyHex();
    const ct = encrypt('x', oldKey);
    expect(() =>
      rotateAllRecords([{ id: 1, ciphertext: ct }], oldKey, 'bad'),
    ).toThrow();
  });

  it('failed error messages do not contain plaintext', () => {
    const oldKey = makeKeyHex();
    const newKey = makeKeyHex();
    const wrongKey = makeKeyHex();
    const records = [{ id: 1, ciphertext: encrypt('supersecret', wrongKey) }];

    const { failed } = rotateAllRecords(records, oldKey, newKey);

    expect(failed.length).toBe(1);
    expect(failed[0].error).not.toContain('supersecret');
  });
});
