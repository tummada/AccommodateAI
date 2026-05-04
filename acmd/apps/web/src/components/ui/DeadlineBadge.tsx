/**
 * DeadlineBadge — color-coded urgency badge for case deadlines.
 *
 * Maps deadline levels (0-5) to visual styles per wireframe FLOW-DEADLINE.
 *
 * Level 0 — no deadline       → neutral gray
 * Level 1 — > 29 days         → yellow  #F59E0B
 * Level 2 — 8-29 days         → orange  #F97316
 * Level 3 — 4-7 days          → red     #EF4444
 * Level 4 — 1-3 days          → pulsing red #DC2626
 * Level 5 — overdue           → dark red #991B1B
 *
 * ACMD-134 — uses inline styles for exact spec colors (Tailwind
 * arbitrary values would require safelisting).
 *
 * Accessibility: each badge includes an icon + text label so color
 * is never the only indicator.
 */

import { cn } from '@/lib/utils';

export type DeadlineLevel = 0 | 1 | 2 | 3 | 4 | 5;

interface LevelConfig {
  bg: string;
  text: string;
  border?: string;
  pulse?: boolean;
  icon: string;
  label: (daysRemaining: number) => string;
}

const LEVEL_CONFIGS: Record<DeadlineLevel, LevelConfig> = {
  0: {
    bg: '#F8FAFC',
    text: '#64748B',
    icon: '—',
    label: () => 'No deadline',
  },
  1: {
    bg: '#FEF3C7',
    text: '#92400E',
    icon: '🟡',
    label: (d) => `Deadline approaching: ${Math.round(d)} days`,
  },
  2: {
    bg: '#FFF7ED',
    text: '#9A3412',
    border: '4px solid #F97316',
    icon: '🟠',
    label: (d) => `Action needed: ${Math.round(d)} days remaining`,
  },
  3: {
    bg: '#FEF2F2',
    text: '#991B1B',
    border: '4px solid #EF4444',
    icon: '🔴',
    label: (d) => `Urgent: ${Math.round(d)} days remaining`,
  },
  4: {
    bg: '#FEF2F2',
    text: '#991B1B',
    border: '4px solid #DC2626',
    pulse: true,
    icon: '🚨',
    label: (d) => (d <= 1 ? 'CRITICAL: Due tomorrow' : `CRITICAL: ${Math.round(d)} days`),
  },
  5: {
    bg: '#991B1B',
    text: '#FFFFFF',
    icon: '⛔',
    label: (d) => `OVERDUE by ${Math.round(Math.abs(d))} day(s) — Legal risk`,
  },
};

export interface DeadlineBadgeProps {
  /** ISO timestamp string or null */
  deadline: string | null;
  /** Pre-computed level — if omitted, computed from deadline */
  level?: DeadlineLevel;
  className?: string;
}

/**
 * Compute deadline level from ISO timestamp.
 * Exported so DashboardPage can use it without importing cases.ts.
 */
export function computeDeadlineLevel(deadline: string | null): DeadlineLevel {
  if (!deadline) return 0;
  const now = new Date();
  const dl = new Date(deadline);
  const diffDays = (dl.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

  if (diffDays < 0) return 5;
  if (diffDays <= 3) return 4;
  if (diffDays <= 7) return 3;
  if (diffDays <= 29) return 2;
  return 1;
}

export function DeadlineBadge({ deadline, level, className }: DeadlineBadgeProps) {
  const computedLevel = level ?? computeDeadlineLevel(deadline);
  const config = LEVEL_CONFIGS[computedLevel];

  const daysRemaining = deadline
    ? (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    : 0;

  const labelText = config.label(daysRemaining);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium',
        config.pulse && 'motion-safe:animate-pulse',
        className,
      )}
      style={{
        backgroundColor: config.bg,
        color: config.text,
        borderLeft: config.border,
      }}
      aria-label={labelText}
      role="img"
    >
      <span aria-hidden="true">{config.icon}</span>
      <span>{labelText}</span>
    </span>
  );
}
