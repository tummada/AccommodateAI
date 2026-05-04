#!/usr/bin/env node
// @vollos/acmd-db — Seed data runner (plain ESM)
// For development only — do NOT run in production
// Usage: DATABASE_URL=... node seed/run-seed.mjs

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const { default: postgres } = await import('postgres');
const sql = postgres(connectionString, { max: 1 });

const seedFile = join(__dirname, 'seed.sql');
const content = await readFile(seedFile, 'utf-8');

try {
  console.log('Running seed data...');
  await sql.unsafe(content);
  console.log('  ✓ Seed data inserted successfully');
} catch (err) {
  console.error('  ✗ Seed failed');
  console.error(err);
  await sql.end();
  process.exit(1);
}

await sql.end();
console.log('Seed completed.');
