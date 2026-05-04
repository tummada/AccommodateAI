// @acmd/db — Drizzle client
// Uses DATABASE_URL (same DB as VOLLOS, tables separated by acmd_ prefix)

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Query pool — max 10 connections
const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

export type AcmdDB = typeof db;
