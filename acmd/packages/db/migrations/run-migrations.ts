#!/usr/bin/env node
// @acmd/db — Migration runner
// Runs UP or DOWN migrations in order
// Tracks applied migrations in acmd_migrations table (matches drizzle.config.ts migrations.table)
// Usage: DATABASE_URL=... node --loader ts-node/esm run-migrations.ts [up|down]

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

const direction = process.argv[2] ?? 'up';
if (direction !== 'up' && direction !== 'down') {
  console.error('Usage: run-migrations.ts [up|down]');
  process.exit(1);
}

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Migration connection — max 1 to prevent deadlocks
const sql = postgres(connectionString, { max: 1 });

async function run(): Promise<void> {
  // Schema "acmd" is pre-created by vollos-core init-db.sql (superuser).
  // This runner must NOT attempt CREATE SCHEMA — acmd_user has USAGE+CREATE
  // on the schema but NO CREATE-on-database privilege, causing error 42501
  // before IF NOT EXISTS can short-circuit. See: T-086 AUDIT-003.

  // Ensure tracking table exists in acmd schema (matches drizzle.config.ts migrations.table = 'acmd_migrations')
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "acmd"."acmd_migrations" (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(__dirname))
    .filter((f) => {
      if (direction === 'up') {
        return /^\d{4}_.*\.sql$/.test(f) && !f.endsWith('.down.sql') && !f.endsWith('.mjs') && !f.endsWith('.ts');
      } else {
        return f.endsWith('.down.sql');
      }
    })
    .sort((a, b) => {
      // DOWN runs in reverse order
      if (direction === 'down') return b.localeCompare(a);
      return a.localeCompare(b);
    });

  if (files.length === 0) {
    console.log(`No migration files found for direction: ${direction}`);
    await sql.end();
    return;
  }

  // For UP: get already-applied migrations to prevent re-runs
  let appliedSet = new Set<string>();
  if (direction === 'up') {
    const rows = await sql<{ filename: string }[]>`SELECT filename FROM "acmd"."acmd_migrations"`;
    appliedSet = new Set(rows.map((r) => r.filename));
    console.log(`Already applied: ${appliedSet.size} migration(s)`);
  }

  let ranCount = 0;
  for (const file of files) {
    // Skip already-applied UP migrations
    if (direction === 'up' && appliedSet.has(file)) {
      console.log(`  ↷ Skipping (already applied): ${file}`);
      continue;
    }

    const filePath = join(__dirname, file);
    const content = await readFile(filePath, 'utf-8');

    // Extract only the SQL before the DOWN comment block (for UP files)
    const sqlContent =
      direction === 'up'
        ? content.split(/^-- ─+ DOWN/m)[0]
        : content;

    try {
      console.log(`Running ${direction.toUpperCase()}: ${file}`);
      await sql.unsafe(sqlContent);
      // Record migration as applied (UP only)
      if (direction === 'up') {
        await sql`INSERT INTO "acmd"."acmd_migrations" (filename) VALUES (${file}) ON CONFLICT DO NOTHING`;
      }
      console.log(`  ✓ ${file}`);
      ranCount++;
    } catch (err) {
      console.error(`  ✗ ${file}`);
      console.error(err);
      await sql.end();
      process.exit(1);
    }
  }

  if (ranCount === 0 && direction === 'up') {
    console.log(`\nAll UP migrations already applied — nothing to run.`);
  } else {
    console.log(`\nAll ${direction.toUpperCase()} migrations completed successfully. (${ranCount} ran)`);
  }
  await sql.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
