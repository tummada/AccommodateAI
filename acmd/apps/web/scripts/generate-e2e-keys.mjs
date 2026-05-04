#!/usr/bin/env node
// RS-013 — generate RSA-2048 key pair for local E2E runs.
// Writes PEMs to apps/web/.e2e/keys.json so playwright.config.ts can
// pass the same private key to vollos-core dev server AND to the
// test-JWT signer inside Playwright. Running again is a no-op when the
// file already exists.
//
// This file MUST NOT be imported by the app bundle — it is a CLI
// helper only. Keys are DEV-ONLY, gitignored via apps/web/.gitignore
// update.

import { generateKeyPair } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', '.e2e');
const outFile = join(outDir, 'keys.json');

if (existsSync(outFile)) {
  // Already generated — make repeat runs idempotent.
  console.log(`[generate-e2e-keys] reusing existing keys at ${outFile}`);
  process.exit(0);
}

const generate = promisify(generateKeyPair);

(async () => {
  const { privateKey, publicKey } = await generate('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify({ privateKey, publicKey }), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  console.log(`[generate-e2e-keys] wrote new RSA pair to ${outFile}`);
})().catch((err) => {
  console.error('[generate-e2e-keys] failed', err);
  process.exit(1);
});
