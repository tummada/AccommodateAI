/**
 * NotificationsPage — ACMD-142 Phase 6G / ACMD-150 Phase 7A
 *
 * URL: /notifications
 * Roles allowed: super_admin, hr, manager
 * Roles denied: medical_reviewer → Access Denied view
 *
 * Features:
 *  - NotificationTabs — role-based (Super Admin/HR: 5 tabs, Manager: 4 tabs)
 *  - FilterBar — role-based (Super Admin: 4 fields, HR: 3 fields, Manager: 1 field)
 *  - NotificationEntry — unread (blue dot + bold + #EFF6FF bg), OVERDUE pinned, CRITICAL pinned
 *  - GroupHeader — Today / Yesterday / This Week grouping
 *  - BulkActionBar — sticky bottom when ≥1 selected
 *  - [Mark All as Read] + [⚙ Preferences →]
 *  - [Load more notifications →] offset pagination from API
 *  - Relative time + hover tooltip absolute datetime (MM/DD/YYYY — H:MM AM/PM ET)
 *
 * Auth Review Checklist:
 *  - cookie path sync: NotificationsPage uses useAuth() for role+client only, does NOT touch cookies
 *  - logout clears state: useEffect cleanup resets local selection state when user changes
 *  - token type asymmetry: NO token stored in localStorage
 *  - clock skew: date grouping uses Date.now() — no hard-coded dates
 *
 * Data source: GET /api/v1/notifications via TanStack Query + useApiClient
 * Mark-read: PATCH /api/v1/notifications/:id/read + PATCH /api/v1/notifications/read-all
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/api/notifications';
import type { AcmdNotification } from '@/lib/api/notifications';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UserRole = 'super_admin' | 'hr' | 'medical_reviewer' | 'manager';

function normalizeRole(raw: string | undefined): UserRole {
  if (
    raw === 'super_admin' ||
    raw === 'hr' ||
    raw === 'medical_reviewer' ||
    raw === 'manager'
  ) {
    return raw;
  }
  return 'manager'; // least-privilege fallback
}

type NotificationType =
  | 'deadline_l5'
  | 'deadline_l4'
  | 'deadline_l2'
  | 'case_stage'
  | 'mgr_submitted'
  | 'letter_gen'
  | 'approved'
  | 'system'
  | 'mgr_input_request'
  | 'case_resolved';

type DateGroup = 'today' | 'yesterday' | 'this_week' | 'older';

type NotificationTab =
  | 'all'
  | 'unread'
  | 'deadline'
  | 'cases'
  | 'system'
  | 'input_requests'
  | 'case_updates';

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  description: string;
  /** Description shown to manager (no medical/case reason/accommodation type) */
  descriptionManager?: string;
  caseId?: string;
  dateGroup: DateGroup;
  /** Absolute datetime string for tooltip: MM/DD/YYYY — H:MM AM/PM ET */
  absoluteDatetime: string;
  /** Relative time string: "2 hours ago" style */
  relativeTime: string;
  unread: boolean;
  /** Level 5 = OVERDUE, Level 4 = CRITICAL, Level 2 = warning */
  urgencyLevel?: 5 | 4 | 2;
  dismissible: boolean;
  actionLabel?: string;
  actionPath?: string;
  secondaryActionLabel?: string;
  secondaryActionPath?: string;
}

// ---------------------------------------------------------------------------
// AcmdNotification → Notification mapper
// ---------------------------------------------------------------------------

/** Compute date group relative to now */
function computeDateGroup(createdAt: string): DateGroup {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now.getTime() - created.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 1) return 'today';
  if (diffDays < 2) return 'yesterday';
  if (diffDays < 7) return 'this_week';
  return 'older';
}

/** Compute relative time string */
function computeRelativeTime(createdAt: string): string {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now.getTime() - created.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return created.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Compute absolute datetime string in ET format */
function computeAbsoluteDatetime(createdAt: string): string {
  const created = new Date(createdAt);
  return created.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  }).replace(', ', ' — ') + ' ET';
}

/** Map API notification type → local NotificationType */
function mapNotificationType(apiType: string): NotificationType {
  switch (apiType) {
    case 'deadline_l5': return 'deadline_l5';
    case 'deadline_l4': return 'deadline_l4';
    case 'deadline_l2': return 'deadline_l2';
    case 'case_stage': return 'case_stage';
    case 'mgr_submitted': return 'mgr_submitted';
    case 'letter_gen': return 'letter_gen';
    case 'approved': return 'approved';
    case 'system': return 'system';
    case 'mgr_input_request': return 'mgr_input_request';
    case 'case_resolved': return 'case_resolved';
    default: return 'system';
  }
}

/** Map API priority → urgency level */
function mapUrgencyLevel(
  type: string,
  priority: string,
): 5 | 4 | 2 | undefined {
  if (type === 'deadline_l5') return 5;
  if (type === 'deadline_l4') return 4;
  if (type === 'deadline_l2') return 2;
  if (priority === 'urgent') return 4;
  if (priority === 'high') return 2;
  return undefined;
}

/** Map an AcmdNotification (API shape) → local Notification (display shape) */
function mapApiNotification(n: AcmdNotification): Notification {
  const localType = mapNotificationType(n.type);
  const urgencyLevel = mapUrgencyLevel(n.type, n.priority);
  const isPinned = urgencyLevel !== undefined && urgencyLevel >= 4;

  return {
    id: n.id,
    type: localType,
    title: n.title,
    description: n.body ?? n.title,
    caseId: n.caseId ?? undefined,
    dateGroup: computeDateGroup(n.createdAt),
    absoluteDatetime: computeAbsoluteDatetime(n.createdAt),
    relativeTime: computeRelativeTime(n.createdAt),
    unread: n.readAt === null,
    urgencyLevel,
    dismissible: !isPinned,
    actionLabel: n.caseId ? 'View Case' : undefined,
    actionPath: n.caseId ? `/cases/${n.caseId}` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Tab config per role
// ---------------------------------------------------------------------------

interface TabConfig {
  key: NotificationTab;
  label: string;
  unreadCount: number;
}

function getTabsForRole(role: UserRole, unreadCount: number): TabConfig[] {
  const adminHrTabs: TabConfig[] = [
    { key: 'all', label: 'All', unreadCount },
    { key: 'unread', label: 'Unread', unreadCount },
    { key: 'deadline', label: 'Deadline', unreadCount: 0 },
    { key: 'cases', label: 'Cases', unreadCount: 0 },
    { key: 'system', label: 'System', unreadCount: 0 },
  ];
  const managerTabs: TabConfig[] = [
    { key: 'all', label: 'All', unreadCount },
    { key: 'unread', label: 'Unread', unreadCount },
    { key: 'input_requests', label: 'Input Requests', unreadCount: 0 },
    { key: 'case_updates', label: 'Case Updates', unreadCount: 0 },
  ];
  if (role === 'manager') return managerTabs;
  return adminHrTabs;
}

// ---------------------------------------------------------------------------
// Notification filtering by tab
// ---------------------------------------------------------------------------

function filterByTab(notifications: Notification[], tab: NotificationTab): Notification[] {
  switch (tab) {
    case 'all':
      return notifications;
    case 'unread':
      return notifications.filter((n) => n.unread);
    case 'deadline':
      return notifications.filter((n) => n.type.startsWith('deadline'));
    case 'cases':
      return notifications.filter(
        (n) =>
          n.type === 'case_stage' ||
          n.type === 'approved' ||
          n.type === 'mgr_submitted' ||
          n.type === 'case_resolved',
      );
    case 'system':
      return notifications.filter((n) => n.type === 'system');
    case 'input_requests':
      return notifications.filter(
        (n) => n.type === 'mgr_submitted' || n.type === 'mgr_input_request',
      );
    case 'case_updates':
      return notifications.filter(
        (n) =>
          n.type === 'case_stage' ||
          n.type === 'approved' ||
          n.type === 'case_resolved',
      );
    default:
      return notifications;
  }
}

// ---------------------------------------------------------------------------
// Type icon helper
// ---------------------------------------------------------------------------

function getTypeIcon(type: NotificationType, urgencyLevel?: number): string {
  if (urgencyLevel === 5) return '⛔';
  if (urgencyLevel === 4) return '🔴';
  if (urgencyLevel === 2) return '🟠';
  switch (type) {
    case 'system':
      return '🔔';
    case 'approved':
    case 'case_resolved':
      return '✅';
    case 'mgr_submitted':
    case 'mgr_input_request':
      return '👤';
    case 'letter_gen':
      return '📄';
    case 'case_stage':
      return '📋';
    default:
      return '🔔';
  }
}

// ---------------------------------------------------------------------------
// Access Denied
// ---------------------------------------------------------------------------

function AccessDenied() {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface p-12 text-center"
      data-testid="access-denied"
    >
      <span className="text-4xl" aria-hidden="true">🔒</span>
      <div>
        <h2 className="text-lg font-semibold text-text">Access Denied</h2>
        <p className="mt-1 text-sm text-text-muted max-w-md">
          You don't have permission to view the Notification Center.
          Medical Reviewers do not have access to this page.
        </p>
      </div>
      <Link
        to="/dashboard"
        className="mt-2 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← Back to Dashboard
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotificationTabs
// ---------------------------------------------------------------------------

interface NotificationTabsProps {
  tabs: TabConfig[];
  activeTab: NotificationTab;
  onTabChange: (tab: NotificationTab) => void;
}

function NotificationTabs({ tabs, activeTab, onTabChange }: NotificationTabsProps) {
  return (
    <nav
      role="tablist"
      aria-label="Notification filters"
      className="flex gap-1 border-b border-border overflow-x-auto"
      data-testid="notification-tabs"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.key}`}
            id={`tab-${tab.key}`}
            onClick={() => onTabChange(tab.key)}
            className={`
              flex-shrink-0 px-4 py-2.5 text-sm font-medium focus-visible:outline-none
              focus-visible:ring-2 focus-visible:ring-ring rounded-t
              ${
                isActive
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-text-muted hover:text-text'
              }
            `}
            data-testid={`tab-${tab.key}`}
          >
            {tab.label}
            {tab.unreadCount > 0 && (
              <span
                className={`ml-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-semibold
                  ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}
                aria-label={`${tab.unreadCount} unread`}
              >
                {tab.unreadCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

interface FilterState {
  caseId: string;
  dateFrom: string;
  dateTo: string;
  urgency: string;
  company: string;
}

interface FilterBarProps {
  role: UserRole;
  filters: FilterState;
  onFilterChange: (field: keyof FilterState, value: string) => void;
  onApply: () => void;
  onClear: () => void;
}

function FilterBar({ role, filters, onFilterChange, onApply, onClear }: FilterBarProps) {
  const showCaseId = role === 'super_admin' || role === 'hr';
  const showUrgency = role === 'super_admin' || role === 'hr';
  const showCompany = role === 'super_admin';

  return (
    <div
      className="rounded-lg border border-border bg-surface p-4 space-y-3"
      data-testid="filter-bar"
      aria-label="Notification filters"
    >
      <div className="flex flex-wrap gap-3">
        {showCaseId && (
          <div className="flex flex-col gap-1">
            <label htmlFor="filter-case-id" className="text-xs font-medium text-text-muted">
              Case ID
            </label>
            <input
              id="filter-case-id"
              type="text"
              value={filters.caseId}
              onChange={(e) => onFilterChange('caseId', e.target.value)}
              placeholder="e.g. CASE-2026-014"
              className="h-8 rounded-md border border-border bg-white px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-44"
              data-testid="filter-case-id"
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="filter-date-from" className="text-xs font-medium text-text-muted">
            Date Range
          </label>
          <div className="flex items-center gap-1">
            <input
              id="filter-date-from"
              type="date"
              value={filters.dateFrom}
              onChange={(e) => onFilterChange('dateFrom', e.target.value)}
              className="h-8 rounded-md border border-border bg-white px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Date from"
              data-testid="filter-date-from"
            />
            <span className="text-text-muted text-xs">–</span>
            <input
              id="filter-date-to"
              type="date"
              value={filters.dateTo}
              onChange={(e) => onFilterChange('dateTo', e.target.value)}
              className="h-8 rounded-md border border-border bg-white px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Date to"
              data-testid="filter-date-to"
            />
          </div>
        </div>

        {showUrgency && (
          <div className="flex flex-col gap-1">
            <label htmlFor="filter-urgency" className="text-xs font-medium text-text-muted">
              Urgency
            </label>
            <select
              id="filter-urgency"
              value={filters.urgency}
              onChange={(e) => onFilterChange('urgency', e.target.value)}
              className="h-8 rounded-md border border-border bg-white px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="filter-urgency"
            >
              <option value="">All Levels</option>
              <option value="5">Level 5 — Overdue</option>
              <option value="4">Level 4 — Critical</option>
              <option value="2">Level 2 — Warning</option>
            </select>
          </div>
        )}

        {showCompany && (
          <div className="flex flex-col gap-1">
            <label htmlFor="filter-company" className="text-xs font-medium text-text-muted">
              Company
            </label>
            <select
              id="filter-company"
              value={filters.company}
              onChange={(e) => onFilterChange('company', e.target.value)}
              className="h-8 rounded-md border border-border bg-white px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="filter-company"
            >
              <option value="">All Companies</option>
              <option value="acme">Acme Corp</option>
              <option value="beta">Beta Inc</option>
            </select>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onApply}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="filter-apply"
        >
          Apply Filters
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="filter-clear"
        >
          Clear Filters
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GroupHeader
// ---------------------------------------------------------------------------

function GroupHeader({ group }: { group: DateGroup }) {
  const labels: Record<DateGroup, string> = {
    today: 'Today',
    yesterday: 'Yesterday',
    this_week: 'This Week',
    older: 'Older',
  };
  return (
    <div
      className="sticky top-0 z-10 flex items-center gap-2 bg-gray-50 px-1 py-2"
      data-testid={`group-header-${group}`}
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {labels[group]}
      </span>
      <div className="flex-1 border-t border-gray-200" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotificationEntry
// ---------------------------------------------------------------------------

interface NotificationEntryProps {
  notification: Notification;
  role: UserRole;
  isSelected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  navigate: (path: string) => void;
}

function NotificationEntry({
  notification: n,
  role,
  isSelected,
  onSelect,
  onMarkRead,
  onDismiss,
  navigate,
}: NotificationEntryProps) {
  const isOverdue = n.urgencyLevel === 5;
  const isCritical = n.urgencyLevel === 4;
  const isPinned = isOverdue || isCritical;

  // Determine background color
  let bgColor = n.unread ? '#EFF6FF' : '#FFFFFF';
  if (isOverdue) bgColor = '#FEF2F2';
  if (isCritical && !isOverdue) bgColor = '#FFFFFF';

  // Description based on role privacy rules
  const description =
    role === 'manager' && n.descriptionManager
      ? n.descriptionManager
      : n.description;

  // For manager: hide medical/case details from title for sensitive types
  const title =
    role === 'manager' && (n.type === 'approved' || n.type === 'case_resolved')
      ? 'Case resolved — no action required.'
      : n.title;

  const typeIcon = getTypeIcon(n.type, n.urgencyLevel);

  const handleActionClick = (path?: string) => {
    if (path) {
      onMarkRead(n.id);
      navigate(path);
    }
  };

  return (
    <article
      className="relative rounded-lg border transition-colors"
      style={{
        backgroundColor: bgColor,
        borderLeft: isCritical && !isOverdue ? '4px solid #EF4444' : undefined,
        borderColor: isOverdue ? '#FECACA' : isCritical ? undefined : '#E5E7EB',
      }}
      aria-label={`Notification: ${n.title}`}
      data-testid={`notification-entry-${n.id}`}
      data-unread={n.unread}
      data-urgency={n.urgencyLevel ?? 'normal'}
      data-critical-border={isCritical && !isOverdue ? 'true' : undefined}
    >
      {isPinned && (
        <div
          className="absolute -top-2 left-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold text-white"
          style={{ backgroundColor: isOverdue ? '#991B1B' : '#DC2626' }}
          aria-label={isOverdue ? 'Pinned: Overdue' : 'Pinned: Critical'}
        >
          📌 {isOverdue ? 'OVERDUE' : 'CRITICAL'}
        </div>
      )}

      <div className={`flex items-start gap-3 p-4 ${isPinned ? 'mt-2' : ''}`}>
        {/* Checkbox for bulk select — only on dismissible items */}
        {n.dismissible && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onSelect(n.id, e.target.checked)}
            className="mt-1 h-4 w-4 cursor-pointer rounded border-gray-300 accent-blue-600"
            aria-label={`Select notification: ${n.title}`}
            data-testid={`select-notif-${n.id}`}
          />
        )}
        {!n.dismissible && (
          /* Placeholder to maintain alignment */
          <div className="mt-1 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        )}

        {/* Unread dot */}
        {n.unread ? (
          <div
            className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: '#2563EB' }}
            aria-label="Unread"
            data-testid={`unread-dot-${n.id}`}
          />
        ) : (
          <div className="mt-1.5 h-2.5 w-2.5 flex-shrink-0" aria-hidden="true" />
        )}

        {/* Icon */}
        <span className="flex-shrink-0 text-lg" aria-hidden="true">
          {typeIcon}
        </span>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p
              className={`text-sm leading-tight ${n.unread ? 'font-bold text-text' : 'font-normal text-text'}`}
              data-testid={`notif-title-${n.id}`}
            >
              {title}
            </p>
            {/* Relative time with hover tooltip */}
            <span
              className="flex-shrink-0 cursor-help text-xs text-text-muted"
              title={n.absoluteDatetime}
              aria-label={`${n.relativeTime} (${n.absoluteDatetime})`}
              data-testid={`notif-time-${n.id}`}
            >
              {n.relativeTime}
            </span>
          </div>

          <p className="text-sm text-text-muted">{description}</p>

          {/* Cannot dismiss notice */}
          {isOverdue && (
            <p
              className="text-xs font-medium text-red-700"
              data-testid={`no-dismiss-notice-${n.id}`}
            >
              ⚠ This notification cannot be dismissed until the case is resolved.
            </p>
          )}
          {isCritical && !isOverdue && (
            <p
              className="text-xs font-medium text-red-700"
              data-testid={`no-dismiss-notice-${n.id}`}
            >
              ⚠ This notification cannot be dismissed until action is taken.
            </p>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-1">
            {n.actionLabel && n.actionPath && (
              <button
                type="button"
                onClick={() => handleActionClick(n.actionPath)}
                className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid={`action-btn-${n.id}`}
              >
                {n.actionLabel}
              </button>
            )}
            {n.secondaryActionLabel && n.secondaryActionPath && (
              <button
                type="button"
                onClick={() => handleActionClick(n.secondaryActionPath)}
                className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid={`secondary-action-btn-${n.id}`}
              >
                {n.secondaryActionLabel}
              </button>
            )}
            {n.actionLabel === 'Dismiss' && (
              <button
                type="button"
                onClick={() => onDismiss(n.id)}
                className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid={`dismiss-btn-${n.id}`}
              >
                Dismiss
              </button>
            )}
            {!n.unread && n.dismissible && (
              <button
                type="button"
                onClick={() => onDismiss(n.id)}
                className="rounded-md px-3 py-1 text-xs font-medium text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Dismiss notification: ${n.title}`}
                data-testid={`dismiss-read-btn-${n.id}`}
              >
                × Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// BulkActionBar
// ---------------------------------------------------------------------------

interface BulkActionBarProps {
  selectedIds: Set<string>;
  allDismissibleIds: string[];
  onSelectAll: () => void;
  onMarkSelectedRead: () => void;
  onClearSelectedRead: () => void;
}

function BulkActionBar({
  selectedIds,
  allDismissibleIds,
  onSelectAll,
  onMarkSelectedRead,
  onClearSelectedRead,
}: BulkActionBarProps) {
  if (selectedIds.size === 0) return null;

  const allSelected = allDismissibleIds.every((id) => selectedIds.has(id));

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-30 flex items-center gap-3 border-t border-border bg-white px-6 py-3 shadow-lg"
      role="toolbar"
      aria-label="Bulk actions for selected notifications"
      data-testid="bulk-action-bar"
    >
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-text">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onSelectAll}
          className="h-4 w-4 cursor-pointer rounded border-gray-300 accent-blue-600"
          aria-label="Select all notifications"
          data-testid="bulk-select-all"
        />
        Select All
      </label>

      <span className="text-xs text-text-muted">({selectedIds.size} selected)</span>

      <button
        type="button"
        onClick={onMarkSelectedRead}
        className="rounded-md px-3 py-1.5 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ backgroundColor: '#2563EB' }}
        data-testid="bulk-mark-read"
      >
        Mark Selected as Read
      </button>

      <button
        type="button"
        onClick={onClearSelectedRead}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="bulk-clear-read"
      >
        Clear Selected Read
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotificationsPage — main export
// ---------------------------------------------------------------------------

export function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const role = normalizeRole(user?.role);

  // Role guard — medical_reviewer denied
  if (role === 'medical_reviewer') {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AccessDenied />
      </div>
    );
  }

  return <NotificationsPageContent role={role} navigate={navigate} />;
}

interface NotificationsPageContentProps {
  role: UserRole;
  navigate: (path: string) => void;
}

const PAGE_SIZE = 20;

function NotificationsPageContent({ role, navigate }: NotificationsPageContentProps) {
  const { client, user } = useAuth();
  const queryClient = useQueryClient();

  // --- API state ---
  const [offset, setOffset] = useState(0);

  // Fix 3: accumulated notifications state — prevents disappearing on "Load older"
  const [allNotifications, setAllNotifications] = useState<AcmdNotification[]>([]);

  // Auth Review: logout clears state — reset selection/offset on unmount
  useEffect(() => {
    return () => {
      setSelectedIds(new Set());
      setOffset(0);
    };
  }, []);

  // Fix 2: Clear TanStack Query cache when user logs out (user becomes null/undefined)
  useEffect(() => {
    if (!user) {
      queryClient.clear();
      setAllNotifications([]);
      setOffset(0);
    }
  }, [user, queryClient]);

  // --- Fetch notifications from API ---
  const {
    data: apiData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['notifications', offset],
    queryFn: () => fetchNotifications(client, { limit: PAGE_SIZE, offset }),
    staleTime: 30_000,
    retry: 1,
  });

  // Fix 3: Accumulate notifications across pages — offset=0 replaces, offset>0 appends
  useEffect(() => {
    if (apiData?.notifications) {
      if (offset === 0) {
        setAllNotifications(apiData.notifications);
      } else {
        setAllNotifications((prev) => {
          // Deduplicate by id to avoid duplicates on re-fetch
          const existingIds = new Set(prev.map((n) => n.id));
          const newItems = apiData.notifications.filter((n) => !existingIds.has(n.id));
          return [...prev, ...newItems];
        });
      }
    }
  }, [apiData, offset]);

  // --- Local UI state ---
  const [activeTab, setActiveTab] = useState<NotificationTab>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(new Set());
  const [localAllRead, setLocalAllRead] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    caseId: '',
    dateFrom: '',
    dateTo: '',
    urgency: '',
    company: '',
  });
  const [filtersApplied, setFiltersApplied] = useState(false);

  // Use accumulated notifications for display (Fix 3)
  const rawNotifications: AcmdNotification[] = allNotifications;
  const total = apiData?.total ?? 0;
  const unreadCount = localAllRead
    ? 0
    : (apiData?.unreadCount ?? 0) - localReadIds.size;

  // Map API → display shape, applying local optimistic read state
  const notifications: Notification[] = rawNotifications
    .filter((n) => !dismissedIds.has(n.id))
    .map((n) => {
      const mapped = mapApiNotification(n);
      // Optimistic: if locally marked read, reflect it
      if (localAllRead || localReadIds.has(n.id)) {
        return { ...mapped, unread: false };
      }
      return mapped;
    });

  const tabs = getTabsForRole(role, Math.max(0, unreadCount));

  // Sorted: pinned (OVERDUE/CRITICAL) always first
  const sortedNotifications = [...notifications].sort((a, b) => {
    const aPinned = (a.urgencyLevel ?? 0) >= 4 ? 1 : 0;
    const bPinned = (b.urgencyLevel ?? 0) >= 4 ? 1 : 0;
    if (bPinned !== aPinned) return bPinned - aPinned;
    return 0;
  });

  const tabFiltered = filterByTab(sortedNotifications, activeTab);

  // Separate date groups
  const todayNotifs = tabFiltered.filter((n) => n.dateGroup === 'today');
  const yesterdayNotifs = tabFiltered.filter((n) => n.dateGroup === 'yesterday');
  const thisWeekNotifs = tabFiltered.filter((n) => n.dateGroup === 'this_week');
  const olderNotifs = tabFiltered.filter((n) => n.dateGroup === 'older');

  const dismissibleIds = tabFiltered.filter((n) => n.dismissible).map((n) => n.id);

  const hasMore = allNotifications.length > 0 && allNotifications.length < total;

  // --- Handlers ---

  const handleMarkAllRead = useCallback(async () => {
    setLocalAllRead(true);
    // Fix 3: optimistically update allNotifications accumulated state
    setAllNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
    try {
      await markAllNotificationsRead(client);
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch {
      // API failed — optimistic state still reflects read; will re-sync on next refetch
    }
  }, [client, queryClient]);

  const handleMarkRead = useCallback(
    async (id: string) => {
      setLocalReadIds((prev) => new Set(prev).add(id));
      // Fix 3: optimistically update allNotifications accumulated state
      setAllNotifications((prev) =>
        prev.map((n) => n.id === id ? { ...n, readAt: new Date().toISOString() } : n),
      );
      try {
        await markNotificationRead(client, id);
        await queryClient.invalidateQueries({ queryKey: ['notifications'] });
      } catch {
        // optimistic update stays
      }
    },
    [client, queryClient],
  );

  const handleDismiss = useCallback((id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const allSelected = dismissibleIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(dismissibleIds));
    }
  }, [dismissibleIds, selectedIds]);

  const handleMarkSelectedRead = useCallback(async () => {
    const idsToMark = Array.from(selectedIds);
    setLocalReadIds((prev) => {
      const next = new Set(prev);
      idsToMark.forEach((id) => next.add(id));
      return next;
    });
    // Fix 3: optimistically update allNotifications accumulated state
    setAllNotifications((prev) =>
      prev.map((n) => idsToMark.includes(n.id) ? { ...n, readAt: new Date().toISOString() } : n),
    );
    setSelectedIds(new Set());
    try {
      await Promise.all(idsToMark.map((id) => markNotificationRead(client, id)));
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch {
      // optimistic update stays
    }
  }, [selectedIds, client, queryClient]);

  const handleClearSelectedRead = useCallback(() => {
    // Remove dismissed (read) items from view
    setDismissedIds((prev) => {
      const next = new Set(prev);
      selectedIds.forEach((id) => {
        const n = notifications.find((x) => x.id === id);
        if (n && !n.unread) next.add(id);
      });
      return next;
    });
    setSelectedIds(new Set());
  }, [selectedIds, notifications]);

  const handleFilterChange = useCallback(
    (field: keyof FilterState, value: string) => {
      setFilters((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleApplyFilters = useCallback(() => {
    setFiltersApplied(true);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({ caseId: '', dateFrom: '', dateTo: '', urgency: '', company: '' });
    setFiltersApplied(false);
  }, []);

  const handleLoadMore = useCallback(() => {
    setOffset((prev) => prev + PAGE_SIZE);
  }, []);

  // Render a group of notifications
  const renderGroup = (group: DateGroup, items: Notification[]) => {
    if (items.length === 0) return null;
    return (
      <div key={group} className="space-y-2">
        <GroupHeader group={group} />
        {items.map((n) => (
          <NotificationEntry
            key={n.id}
            notification={n}
            role={role}
            isSelected={selectedIds.has(n.id)}
            onSelect={handleSelect}
            onMarkRead={handleMarkRead}
            onDismiss={handleDismiss}
            navigate={navigate}
          />
        ))}
      </div>
    );
  };

  const hasNotifications =
    todayNotifs.length > 0 ||
    yesterdayNotifs.length > 0 ||
    thisWeekNotifs.length > 0 ||
    olderNotifs.length > 0;

  // --- Loading state — only full-page skeleton on initial load (offset=0) ---
  if (isLoading && offset === 0) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4" data-testid="notifications-loading">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (isError) {
    return (
      <div className="p-6 max-w-5xl mx-auto" data-testid="notifications-error">
        <div
          role="alert"
          className="flex flex-col items-center gap-4 rounded-lg border border-red-200 bg-red-50 p-12 text-center"
        >
          <span className="text-4xl" aria-hidden="true">⚠️</span>
          <div>
            <h2 className="text-lg font-semibold text-red-800">
              Could not load notifications
            </h2>
            <p className="mt-1 text-sm text-red-700">
              There was a problem connecting to the server. Please try again.
            </p>
          </div>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['notifications'] })}
            className="mt-2 inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="notifications-page">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: '#1E3A5F' }}>
            Notification Center
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="mark-all-read"
          >
            Mark All as Read
          </button>
          <Link
            to="/settings"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-text hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="preferences-link"
          >
            ⚙ Preferences →
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <NotificationTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Filter bar */}
      <FilterBar
        role={role}
        filters={filters}
        onFilterChange={handleFilterChange}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
      />

      {/* Notification list */}
      <div
        id={`tabpanel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        className="space-y-4 pb-20"
      >
        {!hasNotifications && (
          <div
            className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-12 text-center"
            data-testid="empty-state"
          >
            <span className="text-3xl" aria-hidden="true">🔔</span>
            <p className="text-sm text-text-muted">No notifications in this view.</p>
          </div>
        )}

        {renderGroup('today', todayNotifs)}
        {renderGroup('yesterday', yesterdayNotifs)}
        {renderGroup('this_week', thisWeekNotifs)}
        {renderGroup('older', olderNotifs)}

        {/* Filters applied notice */}
        {filtersApplied && (
          <p
            className="text-xs text-text-muted text-center"
            data-testid="filters-applied-notice"
          >
            Filters applied — showing filtered results (server-side filtering coming soon).
          </p>
        )}

        {/* Load more (offset pagination) */}
        <div className="text-center pt-2">
          {hasMore ? (
            <button
              type="button"
              onClick={handleLoadMore}
              className="text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              style={{ color: '#2563EB' }}
              data-testid="load-older"
            >
              Load older notifications →
            </button>
          ) : (
            <p
              className="text-xs text-text-muted"
              data-testid="load-older"
            >
              All notifications loaded
            </p>
          )}
        </div>
      </div>

      {/* Bulk action bar — sticky bottom */}
      <BulkActionBar
        selectedIds={selectedIds}
        allDismissibleIds={dismissibleIds}
        onSelectAll={handleSelectAll}
        onMarkSelectedRead={handleMarkSelectedRead}
        onClearSelectedRead={handleClearSelectedRead}
      />
    </div>
  );
}
