// @acmd/db — acmd_notifications schema
// In-app notifications for users

import {
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { acmdSchema } from './schema-def.js';
import { acmdCompanies } from './companies.js';
import { acmdUsers } from './users.js';
import { acmdCases } from './cases.js';

export const acmdNotificationPriority = acmdSchema.enum('acmd_notification_priority', [
  'low',
  'normal',
  'high',
  'urgent',
]);

export const acmdNotifications = acmdSchema.table(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => acmdCompanies.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => acmdUsers.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 100 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),
    caseId: uuid('case_id').references(() => acmdCases.id, {
      onDelete: 'set null',
    }),
    readAt: timestamp('read_at', { withTimezone: true }),
    emailSent: boolean('email_sent').notNull().default(false),
    priority: acmdNotificationPriority('priority').notNull().default('normal'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('acmd_notifications_company_user_read_idx').on(
      table.companyId,
      table.userId,
      table.readAt,
    ),
    index('acmd_notifications_priority_idx').on(
      table.companyId,
      table.priority,
      table.readAt,
    ),
  ],
);

export type AcmdNotification = typeof acmdNotifications.$inferSelect;
export type NewAcmdNotification = typeof acmdNotifications.$inferInsert;
export type AcmdNotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
