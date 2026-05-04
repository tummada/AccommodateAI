/**
 * DeadlineSummaryBar — horizontal urgency summary bar for CasesPage.
 *
 * Shows counts per deadline level across visible cases.
 * Hidden when no cases have deadline pressure (all level 0).
 * Each counter is clickable — acts as a quick filter.
 *
 * ACMD-135
 */

import { getDeadlineLevel } from '@/lib/api/cases';
import type { AcmdCase } from '@/lib/api/cases';

interface DeadlineSummaryBarProps {
  cases: AcmdCase[];
  /** Called when user clicks a summary level — pass level to set deadline filter */
  onFilterByLevel?: (level: 5 | 4 | 3 | 2 | 1) => void;
}

interface LevelCount {
  level: 5 | 4 | 3 | 2 | 1;
  label: string;
  icon: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
  count: number;
}

export function DeadlineSummaryBar({ cases, onFilterByLevel }: DeadlineSummaryBarProps) {
  // Count cases by deadline level — only non-terminal statuses
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const c of cases) {
    const lvl = getDeadlineLevel(c.deadline);
    if (lvl >= 1 && lvl <= 5) {
      counts[lvl]++;
    }
  }

  const levels: LevelCount[] = [
    {
      level: 5,
      label: 'Overdue',
      icon: '⛔',
      bgColor: '#991B1B',
      textColor: '#FFFFFF',
      borderColor: '#7F1D1D',
      count: counts[5],
    },
    {
      level: 4,
      label: 'Critical (≤3 days)',
      icon: '🚨',
      bgColor: '#FEF2F2',
      textColor: '#991B1B',
      borderColor: '#DC2626',
      count: counts[4],
    },
    {
      level: 3,
      label: 'Urgent (4-7 days)',
      icon: '🔴',
      bgColor: '#FEF2F2',
      textColor: '#991B1B',
      borderColor: '#EF4444',
      count: counts[3],
    },
    {
      level: 2,
      label: 'Action needed (8-29 days)',
      icon: '🟠',
      bgColor: '#FFF7ED',
      textColor: '#9A3412',
      borderColor: '#F97316',
      count: counts[2],
    },
    {
      level: 1,
      label: 'Approaching (>29 days)',
      icon: '🟡',
      bgColor: '#FEF3C7',
      textColor: '#92400E',
      borderColor: '#F59E0B',
      count: counts[1],
    },
  ];

  // Only show levels with at least 1 case
  const visibleLevels = levels.filter((l) => l.count > 0);

  // Hide entirely when no urgency
  if (visibleLevels.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3"
      role="region"
      aria-label="Deadline urgency summary"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-text-muted mr-1">
        Deadline Status:
      </span>
      {visibleLevels.map((lvl) => (
        <button
          key={lvl.level}
          type="button"
          onClick={() => onFilterByLevel?.(lvl.level)}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          style={{
            backgroundColor: lvl.bgColor,
            color: lvl.textColor,
            border: `1.5px solid ${lvl.borderColor}`,
          }}
          aria-label={`${lvl.count} ${lvl.label} case${lvl.count !== 1 ? 's' : ''} — click to filter`}
        >
          <span aria-hidden="true">{lvl.icon}</span>
          <span className="font-bold">{lvl.count}</span>
          <span>{lvl.label}</span>
        </button>
      ))}
    </div>
  );
}
