#!/usr/bin/env node
// @acmd/db — Seed data runner
// For development only — do NOT run in production
// Usage: DATABASE_URL=... node --import tsx/esm seed/run-seed.ts

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const sql = postgres(connectionString, { max: 1 });

async function run(): Promise<void> {
  const seedFile = join(__dirname, 'seed.sql');
  const content = await readFile(seedFile, 'utf-8');

  try {
    console.log('Running seed data...');
    await sql.unsafe(content);
    console.log('  ✓ Seed data inserted successfully');
  } catch (err) {
    console.error('  ✗ Seed failed');
    console.error(err);
    process.exit(1);
  }

  await sql.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
