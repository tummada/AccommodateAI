/**
 * DualTrackSplitView — ACMD-137-C1
 *
 * Tabbed panel showing ADA track, PWFA track, and combined timeline
 * for cases with type === 'multiple' (both ADA + PWFA applicable).
 *
 * Visibility:
 *   - super_admin: full access
 *   - hr: full access
 *   - medical_reviewer: NOT visible (returns null)
 *   - manager: NOT visible (returns null)
 *
 * Compliance (29 CFR 1630.14):
 *   - Manager and Medical Reviewer see ZERO content from this component.
 *   - Returns null immediately — no placeholder, no disabled state, no hint.
 *
 * Accessibility:
 *   - role="tablist" on tab container
 *   - role="tab" + aria-selected + aria-controls on each tab button
 *   - role="tabpanel" + aria-labelledby on each panel
 *   - Arrow keys switch tabs (Left/Right)
 */

import { useState, useRef, useCallback } from 'react';
import type { CaseType } from '@/lib/api/cases';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CombinedEvent {
  date: string;  // ISO string
  law: 'ada' | 'pwfa' | 'both';
  description: string;
}

export interface DualTrackSplitViewProps {
  caseType: CaseType;
  role: 'super_admin' | 'hr' | 'medical_reviewer' | 'manager';
  // ADA checklist
  adaChecklist: {
    disabilityDocumentation: boolean;
    functionalLimitationsAssessed: boolean;
    interactiveProcessComplete: boolean;
    unduHardshipAnalyzed: boolean;
  };
  // PWFA checklist
  pwfaChecklist: {
    pregnancyVerified: boolean;
    predictableAssessmentDone: boolean;
    fastTrackEligible: boolean;
  };
  pwfaFastTrackAvailable?: boolean;
  // Combined timeline (for tab 3 — optional, can be empty [])
  combinedEvents?: CombinedEvent[];
}

// ---------------------------------------------------------------------------
// Tab IDs
// ---------------------------------------------------------------------------

type TabId = 'ada' | 'pwfa' | 'combined';

const TABS: { id: TabId; label: string }[] = [
  { id: 'ada', label: 'ADA Track' },
  { id: 'pwfa', label: 'PWFA Track' },
  { id: 'combined', label: 'Combined Timeline' },
];

// ---------------------------------------------------------------------------
// Helper: checklist item renderer
// ---------------------------------------------------------------------------

interface ChecklistItemProps {
  label: string;
  done: boolean;
}

function ChecklistItem({ label, done }: ChecklistItemProps) {
  return (
    <li
      role="listitem"
      className="flex items-center gap-2 text-sm"
      aria-label={`${label} — ${done ? 'complete' : 'incomplete'}`}
    >
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done
            ? 'bg-green-500 text-white'
            : 'border-2 border-gray-300 text-gray-300'
        }`}
      >
        {done ? '✓' : ''}
      </span>
      <span className={done ? 'text-gray-700' : 'text-gray-500'}>{label}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// ADA Track Panel
// ---------------------------------------------------------------------------

interface AdaTrackPanelProps {
  adaChecklist: DualTrackSplitViewProps['adaChecklist'];
}

function AdaTrackPanel({ adaChecklist }: AdaTrackPanelProps) {
  const items = [
    { label: 'Disability documentation', done: adaChecklist.disabilityDocumentation },
    { label: 'Functional limitations assessed', done: adaChecklist.functionalLimitationsAssessed },
    { label: 'Interactive process complete', done: adaChecklist.interactiveProcessComplete },
    { label: 'Undue hardship analysis', done: adaChecklist.unduHardshipAnalyzed },
  ];

  const completedCount = items.filter((i) => i.done).length;
  const progressPct = Math.round((completedCount / items.length) * 100);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[#1E3A5F]">ADA Requirements</h3>

      <ul role="list" className="space-y-2">
        {items.map((item) => (
          <ChecklistItem key={item.label} label={item.label} done={item.done} />
        ))}
      </ul>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Progress</span>
          <span>{completedCount}/{items.length}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-200">
          <div
            className="h-2 rounded-full bg-[#2563EB] transition-all"
            style={{ width: `${progressPct}%` }}
            role="progressbar"
            aria-valuenow={completedCount}
            aria-valuemin={0}
            aria-valuemax={items.length}
            aria-label={`ADA track progress: ${completedCount} of ${items.length} complete`}
          />
        </div>
      </div>

      <p className="text-xs text-gray-400">
        ADA interactive process (best practice: 30 days)
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PWFA Track Panel
// ---------------------------------------------------------------------------

interface PwfaTrackPanelProps {
  pwfaChecklist: DualTrackSplitViewProps['pwfaChecklist'];
  pwfaFastTrackAvailable?: boolean;
}

function PwfaTrackPanel({ pwfaChecklist, pwfaFastTrackAvailable }: PwfaTrackPanelProps) {
  const items = [
    { label: 'Pregnancy/condition verified', done: pwfaChecklist.pregnancyVerified },
    { label: 'Predictable assessment done', done: pwfaChecklist.predictableAssessmentDone },
    { label: 'Fast-track eligibility checked', done: pwfaChecklist.fastTrackEligible },
  ];

  const completedCount = items.filter((i) => i.done).length;
  const progressPct = Math.round((completedCount / items.length) * 100);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[#7C3AED]">PWFA Requirements</h3>

      {/* PWFA Fast-track banner */}
      {pwfaFastTrackAvailable === true && (
        <div
          role="note"
          aria-label="PWFA fast-track available"
          className="rounded-md border border-purple-200 bg-purple-50 p-3 flex items-start justify-between gap-3"
        >
          <p className="text-xs text-purple-800">
            This request may qualify for PWFA fast-track approval
          </p>
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Coming soon: PWFA fast-track (SCR-PWFA-FAST)"
            className="shrink-0 rounded px-2 py-1 text-xs font-medium bg-purple-200 text-purple-600 cursor-not-allowed opacity-60"
          >
            Start Fast-Track
          </button>
        </div>
      )}

      <ul role="list" className="space-y-2">
        {items.map((item) => (
          <ChecklistItem key={item.label} label={item.label} done={item.done} />
        ))}
      </ul>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Progress</span>
          <span>{completedCount}/{items.length}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-200">
          <div
            className="h-2 rounded-full bg-[#7C3AED] transition-all"
            style={{ width: `${progressPct}%` }}
            role="progressbar"
            aria-valuenow={completedCount}
            aria-valuemin={0}
            aria-valuemax={items.length}
            aria-label={`PWFA track progress: ${completedCount} of ${items.length} complete`}
          />
        </div>
      </div>

      <p className="text-xs text-gray-400">
        PWFA — as soon as practicable
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Combined Timeline Panel
// ---------------------------------------------------------------------------

interface CombinedTimelinePanelProps {
  events: CombinedEvent[];
}

const LAW_COLORS: Record<CombinedEvent['law'], string> = {
  ada: '#2563EB',
  pwfa: '#7C3AED',
  both: '#6B7280',
};

const LAW_LABELS: Record<CombinedEvent['law'], string> = {
  ada: 'ADA',
  pwfa: 'PWFA',
  both: 'Both',
};

function formatEventDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

function CombinedTimelinePanel({ events }: CombinedTimelinePanelProps) {
  // Sort newest first
  const sorted = [...events].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-4 text-center">
        No combined timeline events yet
      </p>
    );
  }

  return (
    <ul role="list" className="space-y-3">
      {sorted.map((event, idx) => (
        <li
          key={`${event.date}-${idx}`}
          role="listitem"
          className="flex items-start gap-3 text-sm"
        >
          <span
            aria-hidden="true"
            className="mt-0.5 h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: LAW_COLORS[event.law] }}
          />
          <div className="min-w-0">
            <span className="text-gray-400 text-xs mr-2">{formatEventDate(event.date)}</span>
            <span
              className="text-xs font-medium rounded px-1 mr-2"
              style={{
                color: LAW_COLORS[event.law],
                backgroundColor: `${LAW_COLORS[event.law]}18`,
              }}
            >
              {LAW_LABELS[event.law]}
            </span>
            <span className="text-gray-700">{event.description}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// DualTrackSplitView — main component
// ---------------------------------------------------------------------------

export function DualTrackSplitView({
  caseType,
  role,
  adaChecklist,
  pwfaChecklist,
  pwfaFastTrackAvailable,
  combinedEvents = [],
}: DualTrackSplitViewProps) {
  // Guard: not visible for manager/medical_reviewer or non-multiple case types
  if (role === 'manager' || role === 'medical_reviewer' || caseType !== 'multiple') {
    return null;
  }

  const [activeTab, setActiveTab] = useState<TabId>('ada');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIdx = TABS.findIndex((t) => t.id === activeTab);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIdx = (currentIdx + 1) % TABS.length;
      setActiveTab(TABS[nextIdx].id);
      tabRefs.current[nextIdx]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIdx = (currentIdx - 1 + TABS.length) % TABS.length;
      setActiveTab(TABS[prevIdx].id);
      tabRefs.current[prevIdx]?.focus();
    }
  }, [activeTab]);

  return (
    <section
      className="rounded-lg border border-border bg-surface"
      aria-label="ADA and PWFA dual-law requirements"
    >
      {/* Tab list */}
      <div
        role="tablist"
        aria-label="Dual-law requirements: ADA and PWFA tracks"
        className="flex border-b border-gray-200"
        onKeyDown={handleKeyDown}
      >
        {TABS.map((tab, idx) => {
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current[idx] = el; }}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={isSelected}
              aria-controls={`tabpanel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1 ${
                isSelected
                  ? 'border-b-2 border-[#2563EB] text-[#2563EB]'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab panels */}
      <div className="p-4">
        <div
          role="tabpanel"
          id="tabpanel-ada"
          aria-labelledby="tab-ada"
          hidden={activeTab !== 'ada'}
        >
          {activeTab === 'ada' && (
            <AdaTrackPanel adaChecklist={adaChecklist} />
          )}
        </div>

        <div
          role="tabpanel"
          id="tabpanel-pwfa"
          aria-labelledby="tab-pwfa"
          hidden={activeTab !== 'pwfa'}
        >
          {activeTab === 'pwfa' && (
            <PwfaTrackPanel
              pwfaChecklist={pwfaChecklist}
              pwfaFastTrackAvailable={pwfaFastTrackAvailable}
            />
          )}
        </div>

        <div
          role="tabpanel"
          id="tabpanel-combined"
          aria-labelledby="tab-combined"
          hidden={activeTab !== 'combined'}
        >
          {activeTab === 'combined' && (
            <CombinedTimelinePanel events={combinedEvents} />
          )}
        </div>
      </div>
    </section>
  );
}
