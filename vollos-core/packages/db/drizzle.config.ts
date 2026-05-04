// @vollos/db — drizzle-kit configuration
import { defineConfig } from 'drizzle-kit';

if (!process.env['DATABASE_URL']) {
  throw new Error('DATABASE_URL environment variable is not set');
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'],
  },
  migrations: {
    schema: 'vollos',
    table: 'vollos_migrations',
  },
  verbose: true,
  strict: true,
});
