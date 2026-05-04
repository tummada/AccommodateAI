/**
 * StatsCard — reusable KPI card for the Dashboard.
 *
 * Renders a metric label + value with optional alert styling
 * (overdue state) and loading skeleton.
 *
 * ACMD-134: used in DashboardPage for Open, Overdue, Pending, Avg Resolution.
 */

import { cn } from '@/lib/utils';

export interface StatsCardProps {
  /** Card title label */
  label: string;
  /** Numeric value to display */
  value: number | string | null;
  /** Sub-label displayed below the value */
  sublabel?: string;
  /**
   * Alert state — turns card background red (overdue card).
   * Uses Tailwind color classes so PurgeCSS keeps them.
   */
  alert?: boolean;
  /** Show loading skeleton instead of value */
  loading?: boolean;
  /** aria-label override for screen readers */
  ariaLabel?: string;
}

export function StatsCard({
  label,
  value,
  sublabel,
  alert = false,
  loading = false,
  ariaLabel,
}: StatsCardProps) {
  if (loading) {
    return (
      <div
        className="rounded-lg border border-border bg-card p-5 shadow-card"
        role="status"
        aria-label="Loading statistic"
        aria-busy="true"
      >
        <div className="mb-2 h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="mb-2 h-8 w-16 animate-pulse rounded bg-muted" />
        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const displayValue = value !== null && value !== undefined ? String(value) : '—';

  return (
    <div
      className={cn(
        'rounded-lg border p-5 shadow-card transition-colors',
        alert
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-border bg-card text-card-foreground',
      )}
      role="region"
      aria-label={
        ariaLabel ?? `${label}: ${displayValue}${sublabel ? `, ${sublabel}` : ''}`
      }
    >
      {/* Label row */}
      <p
        className={cn(
          'text-xs font-semibold uppercase tracking-wide',
          alert ? 'text-red-600' : 'text-text-muted',
        )}
      >
        {alert && (
          <span aria-hidden="true" className="mr-1">
            🔴
          </span>
        )}
        {label}
      </p>

      {/* Value */}
      <p
        className={cn(
          'mt-1 text-3xl font-bold leading-none',
          alert ? 'text-red-800' : 'text-text',
        )}
      >
        {displayValue}
      </p>

      {/* Sub-label */}
      {sublabel && (
        <p
          className={cn(
            'mt-1 text-xs',
            alert ? 'text-red-600' : 'text-text-muted',
          )}
        >
          {sublabel}
        </p>
      )}

      {/* "All on track" indicator when overdue card shows 0 */}
      {alert && value === 0 && (
        <p className="mt-1 text-xs font-medium text-green-600">✓ All on track</p>
      )}
    </div>
  );
}
