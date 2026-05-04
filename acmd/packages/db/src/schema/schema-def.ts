// @acmd/db — PostgreSQL schema isolation
// All ACMD tables live in the 'acmd' schema (not public)
import { pgSchema } from 'drizzle-orm/pg-core';

export const acmdSchema = pgSchema('acmd');
