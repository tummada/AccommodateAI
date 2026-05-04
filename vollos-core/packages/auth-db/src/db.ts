// @vollos/auth-db — Drizzle client via postgres driver
// AUTH_DATABASE_URL or DATABASE_URL must be set in environment

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env['AUTH_DATABASE_URL'] ?? process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('AUTH_DATABASE_URL or DATABASE_URL environment variable is not set');
}

// Create postgres connection pool
const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Export typed Drizzle ORM instance
export const db = drizzle(client, { schema });

export type DB = typeof db;
