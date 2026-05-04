/**
 * CaseClosureGate — ACMD-137-C1
 *
 * 4-item closure checklist for ending an accommodation case.
 * Close Case button is gated until all 4 items are complete.
 *
 * Visibility:
 *   - super_admin: visible + actionable
 *   - hr: visible + actionable
 *   - medical_reviewer: NOT visible (returns null)
 *   - manager: NOT visible (returns null)
 *
 * Checklist items:
 *   1. All 6 EEOC stages completed (auto-checked via allStagesComplete)
 *   2. Employee notified of outcome (auto-checked via employeeNotified)
 *   3. Follow-up date set (always false — future field)
 *   4. All documents attached (manual — HR toggles via checkbox)
 *
 * Error handling:
 *   - 409: "This case is already closed"
 *   - 422: "Cannot close — ensure all stages are complete"
 *   - generic: "Failed to close case. Please try again."
 *
 * Accessibility:
 *   - role="list" on checklist, role="listitem" on items
 *   - aria-label="{label} — {complete|incomplete}" per item
 *   - aria-disabled="true" on Close button when inactive
 */

import { useState } from 'react';
import type { AuthenticatedClient, ApiError } from '@/lib/api-client';
import { apiCloseCase } from '@/lib/api/cases';
import type { CaseStatus } from '@/lib/api/cases';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CaseClosureGateProps {
  caseId: string;
  caseStatus: CaseStatus;
  role: 'super_admin' | 'hr' | 'medical_reviewer' | 'manager';
  // Closure readiness (auto-checked from case state)
  allStagesComplete: boolean;
  employeeNotified: boolean;
  followupDateSet: boolean;
  onClosed?: () => void;
  apiClient: AuthenticatedClient;
}

// ---------------------------------------------------------------------------
// Checklist item helper
// ---------------------------------------------------------------------------

interface GateItemProps {
  label: string;
  done: boolean;
  isManual?: boolean;
  onToggle?: (checked: boolean) => void;
}

function GateItem({ label, done, isManual = false, onToggle }: GateItemProps) {
  return (
    <li
      role="listitem"
      aria-label={`${label} — ${done ? 'complete' : 'incomplete'}`}
      className="flex items-center gap-3 text-sm"
    >
      {isManual ? (
        <input
          type="checkbox"
          id={`gate-item-${label.replace(/\s+/g, '-').toLowerCase()}`}
          checked={done}
          onChange={(e) => onToggle?.(e.target.checked)}
          aria-label={`${label} — ${done ? 'complete' : 'incomplete'}`}
          className="h-4 w-4 rounded border-gray-300 text-green-500 focus:ring-green-400 cursor-pointer"
        />
      ) : (
        <span
          aria-hidden="true"
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            done
              ? 'bg-[#22C55E] text-white'
              : 'border-2 border-[#9CA3AF] text-[#9CA3AF]'
          }`}
        >
          {done ? '✓' : ''}
        </span>
      )}
      <span className={done ? 'text-gray-700' : 'text-gray-500'}>{label}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// CaseClosureGate — main component
// ---------------------------------------------------------------------------

export function CaseClosureGate({
  caseId,
  caseStatus: _caseStatus,
  role,
  allStagesComplete,
  employeeNotified,
  followupDateSet,
  onClosed,
  apiClient,
}: CaseClosureGateProps) {
  // Guard: not visible for manager/medical_reviewer
  if (role === 'manager' || role === 'medical_reviewer') {
    return null;
  }

  // Manual checkbox state
  const [documentsAttached, setDocumentsAttached] = useState(false);

  // Dialog state
  const [showDialog, setShowDialog] = useState(false);

  // Async state
  const [isClosing, setIsClosing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Checklist items
  const items = [
    { label: 'All 6 EEOC stages completed', done: allStagesComplete },
    { label: 'Employee notified of outcome', done: employeeNotified },
    { label: 'Follow-up date set', done: followupDateSet },
    { label: 'All documents attached', done: documentsAttached, isManual: true },
  ];

  const completedCount = items.filter((i) => i.done).length;
  const allDone = completedCount === 4;
  const remaining = 4 - completedCount;

  async function handleConfirmClose() {
    setIsClosing(true);
    setErrorMessage(null);

    try {
      await apiCloseCase(apiClient, caseId);
      setShowDialog(false);
      setSuccessMessage('Case closed successfully.');
      onClosed?.();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 409) {
        setErrorMessage('This case is already closed.');
      } else if (apiErr?.status === 422) {
        setErrorMessage('Cannot close — ensure all stages are complete.');
      } else {
        setErrorMessage('Failed to close case. Please try again.');
      }
      setShowDialog(false);
    } finally {
      setIsClosing(false);
    }
  }

  return (
    <section
      className="rounded-lg border border-border bg-surface p-4 space-y-4"
      aria-label="Case closure checklist"
    >
      <h2 className="text-sm font-semibold text-[#1E3A5F]">Case Closure Checklist</h2>

      {/* Checklist */}
      <ul role="list" className="space-y-2">
        {items.map((item) => (
          <GateItem
            key={item.label}
            label={item.label}
            done={item.done}
            isManual={item.isManual}
            onToggle={item.isManual ? (checked) => setDocumentsAttached(checked) : undefined}
          />
        ))}
      </ul>

      {/* Progress */}
      <p className="text-xs text-gray-500">{completedCount}/4 complete</p>

      {/* Error / Success messages */}
      {errorMessage && (
        <div role="alert" className="rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-700">
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div role="status" className="rounded-md bg-green-50 border border-green-200 p-2 text-xs text-green-700">
          {successMessage}
        </div>
      )}

      {/* Close Case button */}
      {allDone ? (
        <button
          type="button"
          onClick={() => { setErrorMessage(null); setShowDialog(true); }}
          disabled={isClosing}
          className="w-full rounded-md bg-[#1E3A5F] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A5F] focus-visible:ring-offset-2 disabled:opacity-50"
          aria-label="Close case — all 4 checklist items complete"
        >
          Close Case
        </button>
      ) : (
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={`Complete all ${remaining} remaining item${remaining !== 1 ? 's' : ''} to close this case`}
          className="w-full rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-400 cursor-not-allowed"
          aria-label={`Close case — ${remaining} of 4 checklist items remaining`}
        >
          Close Case
        </button>
      )}

      {/* Confirmation dialog */}
      {showDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-dialog-title"
          aria-describedby="close-dialog-desc"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 id="close-dialog-title" className="text-base font-semibold text-[#1E3A5F]">
              Close Case
            </h3>
            <p id="close-dialog-desc" className="text-sm text-gray-600">
              Closing this case will archive it. The audit trail remains accessible. Continue?
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDialog(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void handleConfirmClose(); }}
                disabled={isClosing}
                className="rounded-md bg-[#1E3A5F] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A5F] disabled:opacity-50"
              >
                {isClosing ? 'Closing...' : 'Confirm Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
