/**
 * DenyTab — ACMD-138-B
 *
 * Deny Tab with full EEOC 4-Factor Stepper (Gate 1).
 * Gate 2 (Supervisor Review) and Gate 3 (Final Confirmation) deferred to ACMD-138-C.
 *
 * COMPLIANCE (29 CFR 1630.14): Never renders medicalInfo, diagnosis, or medical documents.
 * Only accommodation type and requestDescription (functional restrictions summary) are shown.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import type { AcmdCaseDetail } from '@/pages/CaseDetailPage';
import {
  postDenyDecision,
  postSupervisorApproveDenial,
  postSupervisorRejectDenial,
  postSupervisorRequestInfo,
} from '@/lib/api/decision';
import type { DenialData } from '@/lib/api/decision';

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

export interface DenyTabProps {
  caseData: AcmdCaseDetail;
  onDenySuccess: () => void;
  onSwitchToApprove: () => void;
}

// ---------------------------------------------------------------------------
// Internal state types
// ---------------------------------------------------------------------------

type DenialType = 'undue_hardship' | 'not_qualified' | 'direct_threat';
type EngagementAssessment =
  | 'fully_participated'
  | 'partially_participated'
  | 'did_not_participate'
  | '';

interface HardshipCategory {
  costImpact: boolean;
  safetyRisk: boolean;
  operationalDisruption: boolean;
}

interface CostImpactFields {
  dollarAmount: string;
  explanation: string;
}

interface Alternative {
  description: string;
  whyConsidered: string;
  reasonRejected: string;
  discussedWithEmployee: 'yes' | 'no' | '';
}

interface OutreachAttempt {
  date: string;
  method: string;
  outcome: string;
}

interface Factor1State {
  hardshipCategories: HardshipCategory;
  costImpact: CostImpactFields;
  safetyRiskDescription: string;
  operationalDisruptionText: string;
  hardshipNarrative: string;
}

interface Factor2State {
  alternatives: Alternative[];
  employeePreference: string;
  preferenceNotFeasible: string;
}

interface Factor3State {
  confirmInteractiveProcess: boolean;
  engagementAssessment: EngagementAssessment;
  outreachAttempts: OutreachAttempt[];
}

interface Factor4State {
  reviewerName: string;
  reviewDate: string;
  reviewerContact: string;
  opinionSummary: string;
  confirmation: 'supports' | 'supports_with_conditions' | 'advises_against' | '';
  conditions: string;
  packageReviewConfirmed: boolean;
}

interface DiscussionSummary {
  date?: string;
  method?: string;
  participants?: string;
  keyPoints?: string;
  employeeResponse?: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateFactor1(f1: Factor1State): string | null {
  const cats = f1.hardshipCategories;
  const anyChecked = cats.costImpact || cats.safetyRisk || cats.operationalDisruption;
  if (!anyChecked) return 'Select at least one hardship category.';
  if (cats.costImpact && f1.costImpact.explanation.trim().length < 100) {
    return 'Cost Impact explanation must be at least 100 characters.';
  }
  if (cats.safetyRisk && f1.safetyRiskDescription.trim().length < 100) {
    return 'Safety Risk description must be at least 100 characters.';
  }
  if (cats.operationalDisruption && f1.operationalDisruptionText.trim().length < 100) {
    return 'Operational Disruption description must be at least 100 characters.';
  }
  if (f1.hardshipNarrative.trim().length < 200) {
    return 'Hardship Narrative must be at least 200 characters.';
  }
  return null;
}

function validateFactor2(f2: Factor2State): string | null {
  if (f2.alternatives.length < 2) return 'At least 2 alternatives are required.';
  for (let i = 0; i < f2.alternatives.length; i++) {
    const alt = f2.alternatives[i];
    if (alt.description.trim().length < 20) {
      return `Alternative #${i + 1}: Description must be at least 20 characters.`;
    }
    if (alt.reasonRejected.trim().length < 50) {
      return `Alternative #${i + 1}: Why Rejected must be at least 50 characters.`;
    }
  }
  if (!f2.employeePreference.trim()) return 'Employee Preference is required.';
  if (f2.preferenceNotFeasible.trim().length < 100) {
    return 'Why Employee Preference Not Feasible must be at least 100 characters.';
  }
  return null;
}

function validateFactor3(f3: Factor3State): string | null {
  if (!f3.confirmInteractiveProcess) return 'Confirm that the interactive process was conducted.';
  if (!f3.engagementAssessment) return 'Select an Employee Engagement Assessment.';
  if (f3.engagementAssessment === 'did_not_participate') {
    if (f3.outreachAttempts.length < 2) return 'Document at least 2 outreach attempts.';
    for (let i = 0; i < f3.outreachAttempts.length; i++) {
      const a = f3.outreachAttempts[i];
      if (!a.date || !a.method || !a.outcome.trim()) {
        return `Outreach Attempt #${i + 1}: Date, Method, and Outcome are required.`;
      }
    }
  }
  return null;
}

function validateFactor4(f4: Factor4State): string | null {
  if (!f4.reviewerName.trim()) return 'Legal Reviewer Name is required.';
  if (!f4.reviewDate) return 'Legal Review Date is required.';
  // Date must be within 30 days before today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const reviewDate = new Date(f4.reviewDate);
  reviewDate.setHours(0, 0, 0, 0);
  const diffMs = today.getTime() - reviewDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'Legal Review Date cannot be in the future.';
  if (diffDays > 30) return 'Legal Review Date must be within the last 30 days.';
  if (f4.opinionSummary.trim().length < 100) {
    return 'Legal Opinion Summary must be at least 100 characters.';
  }
  if (!f4.confirmation) return 'Select Legal Reviewer Confirmation.';
  if (f4.confirmation === 'supports_with_conditions' && !f4.conditions.trim()) {
    return 'Conditions are required when counsel supports with conditions.';
  }
  if (!f4.packageReviewConfirmed) {
    return 'Confirm that legal counsel has reviewed the full denial package.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function CharCount({ current, min }: { current: number; min: number }) {
  const ok = current >= min;
  return (
    <p className={`mt-1 text-xs ${ok ? 'text-green-600' : 'text-gray-500'}`}>
      {current}/{min} minimum {ok && '✓'}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Stepper component
// ---------------------------------------------------------------------------

type StepState = 'locked' | 'active' | 'complete';

function Stepper({
  completedCount,
  currentFactor,
  onClickComplete,
}: {
  completedCount: number;
  currentFactor: number; // 1-5 (5 = all complete)
  onClickComplete: (factor: number) => void;
}) {
  const steps = [
    { label: 'Undue Hardship', short: '1' },
    { label: 'Alternatives', short: '2' },
    { label: 'Interactive Process', short: '3' },
    { label: 'Legal Review', short: '4' },
  ];

  function getState(idx: number): StepState {
    const factorNum = idx + 1;
    if (currentFactor >= 5) return 'complete';
    if (factorNum < currentFactor) return 'complete';
    if (factorNum === currentFactor) return 'active';
    return 'locked';
  }

  return (
    <div
      role="progressbar"
      aria-label="EEOC 4-Factor completion progress"
      aria-valuenow={completedCount}
      aria-valuemax={4}
      className="rounded-md border border-border bg-gray-50 p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">
          EEOC 4-Factor Progress: {completedCount}/4 complete
        </span>
        {completedCount < 4 && (
          <span className="text-xs text-gray-500">Complete all 4 to enable denial submission</span>
        )}
        {completedCount === 4 && (
          <span className="text-xs font-semibold text-green-700">✓ All complete — Submit Denial enabled</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {steps.map((step, idx) => {
          const state = getState(idx);
          const factorNum = idx + 1;
          const isClickable = state === 'complete';

          return (
            <div key={step.short} className="flex items-center">
              {idx > 0 && (
                <div
                  className={`h-px w-6 ${state === 'locked' ? 'bg-gray-200' : 'bg-green-400'}`}
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                onClick={() => isClickable && onClickComplete(factorNum)}
                disabled={!isClickable && state === 'locked'}
                title={
                  state === 'complete'
                    ? `Go back to Factor ${factorNum}: ${step.label}`
                    : state === 'active'
                      ? `Factor ${factorNum}: ${step.label} — In Progress`
                      : `Factor ${factorNum}: ${step.label} — Locked`
                }
                aria-current={state === 'active' ? 'step' : undefined}
                className={`flex flex-col items-center gap-1 rounded-md px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors ${
                  state === 'complete'
                    ? 'bg-green-100 text-green-800 cursor-pointer hover:bg-green-200'
                    : state === 'active'
                      ? 'bg-blue-100 text-blue-800 border border-[#2563EB] cursor-default'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                <span className="text-base font-bold">
                  {state === 'complete' ? '✓' : step.short}
                </span>
                <span className="text-center leading-tight max-w-[72px]">{step.label}</span>
                <span className="font-semibold uppercase tracking-wide">
                  {state === 'complete' ? 'Done' : state === 'active' ? 'Active' : 'Locked'}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Factor 1 Panel
// ---------------------------------------------------------------------------

function Factor1Panel({
  state,
  onChange,
  onNext,
  denialType,
}: {
  state: Factor1State;
  onChange: (s: Factor1State) => void;
  onNext: () => void;
  denialType: DenialType | '';
}) {
  const [error, setError] = useState<string | null>(null);

  function handleNext() {
    const err = validateFactor1(state);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onNext();
  }

  return (
    <div className="space-y-5">
      <h3 className="text-base font-semibold text-gray-900">
        Factor 1: Undue Hardship Justification
      </h3>
      <p className="text-xs text-gray-500 italic">
        Under the ADA, undue hardship means significant difficulty or expense. Courts consider:
        (1) cost, (2) financial resources, (3) size and structure, (4) nature and impact on operations.
      </p>

      {/* Hardship Categories */}
      <fieldset>
        <legend className="text-sm font-medium text-gray-700">
          Hardship Category <span className="text-red-600">*</span>{' '}
          <span className="font-normal text-gray-500">(at least 1 required)</span>
        </legend>

        <div className="mt-3 space-y-4">
          {/* Cost Impact */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={state.hardshipCategories.costImpact}
                onChange={(e) =>
                  onChange({
                    ...state,
                    hardshipCategories: {
                      ...state.hardshipCategories,
                      costImpact: e.target.checked,
                    },
                  })
                }
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Cost Impact
            </label>
            {state.hardshipCategories.costImpact && (
              <div className="mt-2 ml-6 space-y-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Dollar amount (optional)
                  </label>
                  <input
                    type="text"
                    value={state.costImpact.dollarAmount}
                    onChange={(e) =>
                      onChange({
                        ...state,
                        costImpact: { ...state.costImpact, dollarAmount: e.target.value },
                      })
                    }
                    placeholder="e.g., $45,000"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600">
                    Explanation of financial burden{' '}
                    <span className="text-red-600">* (min 100 chars)</span>
                  </label>
                  <textarea
                    value={state.costImpact.explanation}
                    onChange={(e) =>
                      onChange({
                        ...state,
                        costImpact: { ...state.costImpact, explanation: e.target.value },
                      })
                    }
                    rows={3}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <CharCount current={state.costImpact.explanation.length} min={100} />
                  <p className="text-xs text-gray-400 mt-1">
                    Consider the net cost, not just gross. Factor in tax credits, outside funding,
                    and cost relative to organization's budget.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Safety Risk */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={state.hardshipCategories.safetyRisk}
                onChange={(e) =>
                  onChange({
                    ...state,
                    hardshipCategories: {
                      ...state.hardshipCategories,
                      safetyRisk: e.target.checked,
                    },
                  })
                }
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Safety Risk
            </label>
            {state.hardshipCategories.safetyRisk && (
              <div className="mt-2 ml-6 space-y-2">
                <label className="block text-xs font-medium text-gray-600">
                  Description of safety concerns{' '}
                  <span className="text-red-600">* (min 100 chars)</span>
                </label>
                <textarea
                  value={state.safetyRiskDescription}
                  onChange={(e) =>
                    onChange({ ...state, safetyRiskDescription: e.target.value })
                  }
                  rows={3}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <CharCount current={state.safetyRiskDescription.length} min={100} />
                <p className="text-xs text-gray-400">
                  Must be based on objective evidence, not speculation.
                </p>
              </div>
            )}
          </div>

          {/* Operational Disruption */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={state.hardshipCategories.operationalDisruption}
                onChange={(e) =>
                  onChange({
                    ...state,
                    hardshipCategories: {
                      ...state.hardshipCategories,
                      operationalDisruption: e.target.checked,
                    },
                  })
                }
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Operational Disruption
            </label>
            {state.hardshipCategories.operationalDisruption && (
              <div className="mt-2 ml-6 space-y-2">
                <label className="block text-xs font-medium text-gray-600">
                  Description of operational impact{' '}
                  <span className="text-red-600">* (min 100 chars)</span>
                </label>
                <textarea
                  value={state.operationalDisruptionText}
                  onChange={(e) =>
                    onChange({ ...state, operationalDisruptionText: e.target.value })
                  }
                  rows={3}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <CharCount current={state.operationalDisruptionText.length} min={100} />
                <p className="text-xs text-gray-400">
                  Explain how accommodation would fundamentally alter business operations.
                  Minor inconveniences do not constitute hardship.
                </p>
              </div>
            )}
          </div>
        </div>
      </fieldset>

      {/* Hardship Narrative */}
      <div>
        <label htmlFor="hardship-narrative" className="block text-sm font-medium text-gray-700">
          Hardship Narrative <span className="text-red-600">* (min 200 chars)</span>
        </label>
        <p className="mt-0.5 text-xs text-gray-500">
          Explain how the specific hardship connects to the requested accommodation for this
          employee's case.
        </p>
        <textarea
          id="hardship-narrative"
          value={state.hardshipNarrative}
          onChange={(e) => onChange({ ...state, hardshipNarrative: e.target.value })}
          rows={5}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <CharCount current={state.hardshipNarrative.length} min={200} />
      </div>

      {/* Supporting Evidence (Phase B placeholder) */}
      <div>
        <p className="text-sm font-medium text-gray-700">Supporting Evidence (optional)</p>
        <p className="text-xs text-gray-500">
          Upload financial reports, safety assessments, etc.
        </p>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            disabled
            title="File upload coming in a future phase"
            className="rounded-md border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-400 cursor-not-allowed"
          >
            Browse… (coming soon)
          </button>
          <span className="text-xs text-gray-400">No files selected</span>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleNext}
          disabled={!denialType}
          className="rounded-md bg-[#2563EB] px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save &amp; Continue to Factor 2 →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Factor 2 Panel
// ---------------------------------------------------------------------------

function Factor2Panel({
  state,
  onChange,
  onNext,
  onBack,
}: {
  state: Factor2State;
  onChange: (s: Factor2State) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  function handleNext() {
    const err = validateFactor2(state);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onNext();
  }

  function addAlternative() {
    if (state.alternatives.length >= 10) return;
    onChange({
      ...state,
      alternatives: [
        ...state.alternatives,
        { description: '', whyConsidered: '', reasonRejected: '', discussedWithEmployee: '' },
      ],
    });
  }

  function removeAlternative(idx: number) {
    const alts = state.alternatives.filter((_, i) => i !== idx);
    onChange({ ...state, alternatives: alts });
  }

  function updateAlt(idx: number, field: keyof Alternative, value: string) {
    const alts = state.alternatives.map((a, i) =>
      i === idx ? { ...a, [field]: value } : a,
    );
    onChange({ ...state, alternatives: alts });
  }

  return (
    <div className="space-y-5">
      <h3 className="text-base font-semibold text-gray-900">
        Factor 2: Alternative Accommodations
      </h3>
      <p className="text-xs text-gray-500 italic">
        The EEOC requires employers to consider all possible accommodations before denying.
        Document each alternative and why it was not feasible.
      </p>

      {/* Alternatives array */}
      <div className="space-y-4">
        {state.alternatives.map((alt, idx) => (
          <div key={idx} className="rounded-md border border-gray-200 bg-gray-50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">
                Alternative #{idx + 1}
              </span>
              {state.alternatives.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeAlternative(idx)}
                  className="text-xs text-red-600 hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  Remove
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600">
                Description <span className="text-red-600">* (min 20 chars)</span>
              </label>
              <input
                type="text"
                value={alt.description}
                onChange={(e) => updateAlt(idx, 'description', e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <CharCount current={alt.description.length} min={20} />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600">
                Why Considered <span className="text-gray-400">(display only)</span>
              </label>
              <input
                type="text"
                value={alt.whyConsidered}
                onChange={(e) => updateAlt(idx, 'whyConsidered', e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600">
                Why Rejected <span className="text-red-600">* (min 50 chars)</span>
              </label>
              <textarea
                value={alt.reasonRejected}
                onChange={(e) => updateAlt(idx, 'reasonRejected', e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <CharCount current={alt.reasonRejected.length} min={50} />
            </div>

            <fieldset>
              <legend className="text-xs font-medium text-gray-600">
                Discussed with employee?
              </legend>
              <div className="mt-1 flex gap-4">
                {(['yes', 'no'] as const).map((v) => (
                  <label
                    key={v}
                    className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name={`discussed-${idx}`}
                      value={v}
                      checked={alt.discussedWithEmployee === v}
                      onChange={() => updateAlt(idx, 'discussedWithEmployee', v)}
                      className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    {v === 'yes' ? 'Yes' : 'No'}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        ))}
      </div>

      {state.alternatives.length < 10 && (
        <button
          type="button"
          onClick={addAlternative}
          className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          + Add Another Alternative
        </button>
      )}
      <p className="text-xs text-gray-400">
        Consider documenting additional alternatives to strengthen your compliance record.
      </p>

      {/* Employee Preference */}
      <div>
        <label htmlFor="emp-preference" className="block text-sm font-medium text-gray-700">
          Employee Preference <span className="text-red-600">*</span>
        </label>
        <input
          id="emp-preference"
          type="text"
          value={state.employeePreference}
          onChange={(e) => onChange({ ...state, employeePreference: e.target.value })}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Preference not feasible */}
      <div>
        <label htmlFor="pref-not-feasible" className="block text-sm font-medium text-gray-700">
          Why Employee's Preference Not Feasible{' '}
          <span className="text-red-600">* (min 100 chars)</span>
        </label>
        <textarea
          id="pref-not-feasible"
          value={state.preferenceNotFeasible}
          onChange={(e) => onChange({ ...state, preferenceNotFeasible: e.target.value })}
          rows={3}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <CharCount current={state.preferenceNotFeasible.length} min={100} />
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← Back to Factor 1
        </button>
        <button
          type="button"
          onClick={handleNext}
          className="rounded-md bg-[#2563EB] px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Save &amp; Continue to Factor 3 →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Factor 3 Panel
// ---------------------------------------------------------------------------

const OUTREACH_METHODS = ['Email', 'Phone', 'In Person', 'Letter', 'Video Call'];

function Factor3Panel({
  state,
  caseData,
  onChange,
  onNext,
  onBack,
}: {
  state: Factor3State;
  caseData: AcmdCaseDetail;
  onChange: (s: Factor3State) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const discussions = (caseData as unknown as { discussions?: DiscussionSummary[] }).discussions;
  const firstDiscussion: DiscussionSummary | null =
    Array.isArray(discussions) && discussions.length > 0 ? discussions[0] : null;

  function handleNext() {
    const err = validateFactor3(state);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onNext();
  }

  function addAttempt() {
    onChange({
      ...state,
      outreachAttempts: [...state.outreachAttempts, { date: '', method: '', outcome: '' }],
    });
  }

  function updateAttempt(idx: number, field: keyof OutreachAttempt, value: string) {
    const attempts = state.outreachAttempts.map((a, i) =>
      i === idx ? { ...a, [field]: value } : a,
    );
    onChange({ ...state, outreachAttempts: attempts });
  }

  function removeAttempt(idx: number) {
    const attempts = state.outreachAttempts.filter((_, i) => i !== idx);
    onChange({ ...state, outreachAttempts: attempts });
  }

  return (
    <div className="space-y-5">
      <h3 className="text-base font-semibold text-gray-900">
        Factor 3: Interactive Process Documentation
      </h3>
      <p className="text-xs text-gray-500 italic">
        The interactive process is the cornerstone of ADA compliance. Failure to engage in the
        interactive process is itself a violation, even if the denial would otherwise be justified.
      </p>

      {/* Confirm checkbox */}
      <div>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={state.confirmInteractiveProcess}
            onChange={(e) =>
              onChange({ ...state, confirmInteractiveProcess: e.target.checked })
            }
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700">
            I confirm that the interactive process (EEOC Stage 3) was conducted with the
            employee <span className="text-red-600">*</span>
          </span>
        </label>
      </div>

      {/* Discussion summary */}
      <div>
        <p className="text-sm font-medium text-gray-700">
          Discussion Summary (auto-populated from Stage 3)
        </p>
        <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          {firstDiscussion ? (
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
              <dt className="font-medium text-gray-500">Date</dt>
              <dd>{firstDiscussion.date ?? 'Not recorded'}</dd>
              <dt className="font-medium text-gray-500">Method</dt>
              <dd>{firstDiscussion.method ?? 'Not recorded'}</dd>
              <dt className="font-medium text-gray-500">Participants</dt>
              <dd>{firstDiscussion.participants ?? 'Not recorded'}</dd>
              <dt className="font-medium text-gray-500">Key Points</dt>
              <dd>{firstDiscussion.keyPoints ?? 'Not recorded'}</dd>
              <dt className="font-medium text-gray-500">Employee Response</dt>
              <dd>{firstDiscussion.employeeResponse ?? 'Not recorded'}</dd>
            </dl>
          ) : (
            'No discussion recorded in Stage 3. Ensure the interactive process was documented.'
          )}
        </div>
      </div>

      {/* Engagement Assessment */}
      <div>
        <label htmlFor="engagement-assessment" className="block text-sm font-medium text-gray-700">
          Employee Engagement Assessment <span className="text-red-600">*</span>
        </label>
        <select
          id="engagement-assessment"
          value={state.engagementAssessment}
          onChange={(e) =>
            onChange({
              ...state,
              engagementAssessment: e.target.value as EngagementAssessment,
              outreachAttempts:
                e.target.value === 'did_not_participate' && state.outreachAttempts.length < 2
                  ? [
                      { date: '', method: '', outcome: '' },
                      { date: '', method: '', outcome: '' },
                    ]
                  : state.outreachAttempts,
            })
          }
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Select assessment…</option>
          <option value="fully_participated">
            Employee fully participated in interactive process
          </option>
          <option value="partially_participated">Employee partially participated</option>
          <option value="did_not_participate">
            Employee did not participate despite reasonable attempts
          </option>
        </select>
      </div>

      {/* Outreach Attempts (conditional) */}
      {state.engagementAssessment === 'did_not_participate' && (
        <div className="space-y-4">
          <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            If the employee did not participate, you must document that you made reasonable
            attempts to engage them.
          </div>

          <p className="text-sm font-medium text-gray-700">
            Documentation of Outreach Attempts{' '}
            <span className="text-red-600">* (minimum 2)</span>
          </p>

          {state.outreachAttempts.map((attempt, idx) => (
            <div key={idx} className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-600">Attempt #{idx + 1}</span>
                {state.outreachAttempts.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeAttempt(idx)}
                    className="text-xs text-red-600 hover:text-red-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500 rounded"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500">
                    Date <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="date"
                    value={attempt.date}
                    onChange={(e) => updateAttempt(idx, 'date', e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500">
                    Method <span className="text-red-600">*</span>
                  </label>
                  <select
                    value={attempt.method}
                    onChange={(e) => updateAttempt(idx, 'method', e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Select…</option>
                    {OUTREACH_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500">
                    Outcome <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={attempt.outcome}
                    onChange={(e) => updateAttempt(idx, 'outcome', e.target.value)}
                    placeholder="e.g., No response"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addAttempt}
            className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            + Add Another Attempt
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← Back to Factor 2
        </button>
        <button
          type="button"
          onClick={handleNext}
          className="rounded-md bg-[#2563EB] px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Save &amp; Continue to Factor 4 →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Factor 4 Panel
// ---------------------------------------------------------------------------

function Factor4Panel({
  state,
  onChange,
  onComplete,
  onBack,
  onSwitchToApprove,
}: {
  state: Factor4State;
  onChange: (s: Factor4State) => void;
  onComplete: () => void;
  onBack: () => void;
  onSwitchToApprove: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [showAdvisesAgainstDialog, setShowAdvisesAgainstDialog] = useState(false);
  const advisesAgainstDialogRef = useRef<HTMLDivElement>(null);
  const advisesAgainstFirstBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showAdvisesAgainstDialog) return;
    advisesAgainstFirstBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAdvisesAgainstDialog(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = advisesAgainstDialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showAdvisesAgainstDialog]);

  function handleComplete() {
    const err = validateFactor4(state);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    if (state.confirmation === 'advises_against') {
      setShowAdvisesAgainstDialog(true);
      return;
    }
    onComplete();
  }

  return (
    <div className="space-y-5">
      <h3 className="text-base font-semibold text-gray-900">
        Factor 4: Legal Review Confirmation
      </h3>
      <p className="text-xs text-gray-500 italic">
        Legal review before denial is a best practice that significantly reduces litigation risk.
        Ensure your counsel has reviewed the complete denial package, not just the decision.
      </p>

      {/* Reviewer Name */}
      <div>
        <label htmlFor="legal-reviewer-name" className="block text-sm font-medium text-gray-700">
          Legal Reviewer Name <span className="text-red-600">*</span>
        </label>
        <input
          id="legal-reviewer-name"
          type="text"
          value={state.reviewerName}
          onChange={(e) => onChange({ ...state, reviewerName: e.target.value })}
          placeholder="Attorney Name"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Review Date */}
      <div>
        <label htmlFor="legal-review-date" className="block text-sm font-medium text-gray-700">
          Legal Review Date <span className="text-red-600">*</span>
          <span className="ml-1 font-normal text-gray-500 text-xs">(must be within last 30 days)</span>
        </label>
        <input
          id="legal-review-date"
          type="date"
          value={state.reviewDate}
          onChange={(e) => onChange({ ...state, reviewDate: e.target.value })}
          className="mt-1 block w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Contact */}
      <div>
        <label htmlFor="legal-reviewer-contact" className="block text-sm font-medium text-gray-700">
          Legal Reviewer Contact <span className="text-gray-400">(optional)</span>
        </label>
        <input
          id="legal-reviewer-contact"
          type="email"
          value={state.reviewerContact}
          onChange={(e) => onChange({ ...state, reviewerContact: e.target.value })}
          placeholder="attorney@lawfirm.com"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Opinion Summary */}
      <div>
        <label htmlFor="opinion-summary" className="block text-sm font-medium text-gray-700">
          Legal Opinion Summary <span className="text-red-600">* (min 100 chars)</span>
        </label>
        <textarea
          id="opinion-summary"
          value={state.opinionSummary}
          onChange={(e) => onChange({ ...state, opinionSummary: e.target.value })}
          rows={4}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <CharCount current={state.opinionSummary.length} min={100} />
      </div>

      {/* Confirmation Select */}
      <div>
        <label htmlFor="legal-confirmation" className="block text-sm font-medium text-gray-700">
          Legal Reviewer Confirmation <span className="text-red-600">*</span>
        </label>
        <select
          id="legal-confirmation"
          value={state.confirmation}
          onChange={(e) =>
            onChange({
              ...state,
              confirmation: e.target.value as Factor4State['confirmation'],
              conditions: e.target.value !== 'supports_with_conditions' ? '' : state.conditions,
            })
          }
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Select…</option>
          <option value="supports">Legal counsel supports the denial</option>
          <option value="supports_with_conditions">
            Legal counsel supports with conditions
          </option>
          <option value="advises_against">Legal counsel advises against denial</option>
        </select>
      </div>

      {/* Conditions (conditional) */}
      {state.confirmation === 'supports_with_conditions' && (
        <div>
          <label htmlFor="legal-conditions" className="block text-sm font-medium text-gray-700">
            Conditions <span className="text-red-600">*</span>
          </label>
          <textarea
            id="legal-conditions"
            value={state.conditions}
            onChange={(e) => onChange({ ...state, conditions: e.target.value })}
            rows={3}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Advises Against Warning Banner */}
      {state.confirmation === 'advises_against' && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <p className="font-semibold">
            Legal counsel has advised against this denial.
          </p>
          <p className="mt-1">
            Proceeding carries elevated risk. Consider alternative accommodations or approval.
            All actions from this point receive elevated audit scrutiny.
          </p>
        </div>
      )}

      {/* Package Review Confirmation Checkbox */}
      <div>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={state.packageReviewConfirmed}
            onChange={(e) =>
              onChange({ ...state, packageReviewConfirmed: e.target.checked })
            }
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700">
            I confirm that legal counsel has reviewed the full denial package including undue
            hardship analysis, alternatives considered, and interactive process documentation{' '}
            <span className="text-red-600">*</span>
          </span>
        </label>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← Back to Factor 3
        </button>
        <button
          type="button"
          onClick={handleComplete}
          className="rounded-md bg-[#2563EB] px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Complete Factor 4 →
        </button>
      </div>

      {/* Advises Against Confirmation Dialog */}
      {showAdvisesAgainstDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          aria-modal="true"
        >
          <div
            ref={advisesAgainstDialogRef}
            role="alertdialog"
            aria-labelledby="advises-against-title"
            aria-describedby="advises-against-desc"
            className="relative mx-4 w-full max-w-md rounded-lg border border-red-300 bg-white p-6 shadow-xl"
          >
            <h2 id="advises-against-title" className="text-lg font-semibold text-red-800">
              Legal Counsel Advises Against Denial
            </h2>
            <p id="advises-against-desc" className="mt-3 text-sm text-gray-700">
              Legal counsel has advised against this denial. Are you sure you want to proceed?
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                ref={advisesAgainstFirstBtnRef}
                type="button"
                onClick={() => {
                  setShowAdvisesAgainstDialog(false);
                  onSwitchToApprove();
                }}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Reconsider — Switch to Approve
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAdvisesAgainstDialog(false);
                  onComplete();
                }}
                className="rounded-md bg-[#DC2626] px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Yes, Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Submit Denial Dialog
// ---------------------------------------------------------------------------

interface SubmitDenialDialogProps {
  caseData: AcmdCaseDetail;
  denialType: DenialType;
  factor3: Factor3State;
  factor4: Factor4State;
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
  submitError: string | string[] | null;
}

function SubmitDenialDialog({
  caseData,
  denialType,
  factor3,
  factor4,
  onConfirm,
  onCancel,
  isSubmitting,
  submitError,
}: SubmitDenialDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstFocusableRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const denialTypeLabels: Record<DenialType, string> = {
    undue_hardship: 'Undue Hardship',
    not_qualified: 'Not Qualified Individual',
    direct_threat: 'Direct Threat',
  };

  const engagementLabels: Record<string, string> = {
    fully_participated: 'Employee fully participated',
    partially_participated: 'Employee partially participated',
    did_not_participate: 'Employee did not participate',
  };

  const confirmationLabels: Record<string, string> = {
    supports: 'Legal counsel supports the denial',
    supports_with_conditions: 'Legal counsel supports with conditions',
    advises_against: 'Legal counsel advises against denial',
  };

  const getLawsLabel = () => {
    if (caseData.type === 'ada') return 'ADA';
    if (caseData.type === 'pwfa') return 'PWFA';
    if (caseData.type === 'multiple') return 'ADA + PWFA';
    return caseData.type;
  };

  const errors = Array.isArray(submitError)
    ? submitError
    : submitError
      ? [submitError]
      : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      aria-modal="true"
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-labelledby="deny-dialog-title"
        aria-describedby="deny-dialog-desc"
        className="relative mx-4 w-full max-w-lg rounded-lg border border-border bg-white p-6 shadow-xl"
      >
        <h2 id="deny-dialog-title" className="text-lg font-semibold text-gray-900">
          Submit for Supervisor Review
        </h2>

        <div id="deny-dialog-desc" className="mt-4 space-y-3 text-sm text-gray-700">
          <p>This denial will be sent to a supervisor for review before it becomes final.</p>

          <div className="rounded-md bg-gray-50 border border-gray-200 p-3">
            <p className="font-semibold text-gray-800 mb-2">Denial Package Summary:</p>
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="font-medium text-gray-500">Case</dt>
              <dd className="text-gray-800">{caseData.id}</dd>

              <dt className="font-medium text-gray-500">Employee</dt>
              <dd className="text-gray-800">
                {(caseData as { employeeName?: string }).employeeName ?? caseData.employeeId}
              </dd>

              <dt className="font-medium text-gray-500">Denial Type</dt>
              <dd className="text-gray-800">{denialTypeLabels[denialType]}</dd>

              <dt className="font-medium text-gray-500">EEOC Factors</dt>
              <dd className="font-semibold text-green-700">4/4 Complete</dd>

              <dt className="font-medium text-gray-500">Laws</dt>
              <dd className="text-gray-800">{getLawsLabel()}</dd>

              <dt className="font-medium text-gray-500">Engagement</dt>
              <dd className="text-gray-800">
                {engagementLabels[factor3.engagementAssessment] ?? factor3.engagementAssessment}
              </dd>

              <dt className="font-medium text-gray-500">Legal Reviewer</dt>
              <dd className="text-gray-800">{factor4.reviewerName}</dd>

              <dt className="font-medium text-gray-500">Review Date</dt>
              <dd className="text-gray-800">{factor4.reviewDate}</dd>

              <dt className="font-medium text-gray-500">Counsel Opinion</dt>
              <dd className="text-gray-800">
                {confirmationLabels[factor4.confirmation] ?? factor4.confirmation}
              </dd>
            </dl>
          </div>

          <p className="text-xs text-gray-500">
            Supervisor has <strong>5 business days</strong> to review.
          </p>
        </div>

        {errors.length > 0 && (
          <div role="alert" className="mt-4 space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errors.map((err, i) => (
              <p key={i}>{err}</p>
            ))}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            ref={firstFocusableRef}
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="rounded-md bg-[#DC2626] px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Submitting…' : 'Submit for Review'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Denial Summary Panel (read-only, collapsible)
// ---------------------------------------------------------------------------

function DenialSummary({
  denialType,
  factor1,
  factor2,
  factor3,
  factor4,
}: {
  denialType: DenialType;
  factor1: Factor1State;
  factor2: Factor2State;
  factor3: Factor3State;
  factor4: Factor4State;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const denialTypeLabels: Record<DenialType, string> = {
    undue_hardship: 'Undue Hardship',
    not_qualified: 'Not Qualified Individual',
    direct_threat: 'Direct Threat',
  };

  const engagementLabels: Record<string, string> = {
    fully_participated: 'Employee fully participated',
    partially_participated: 'Employee partially participated',
    did_not_participate: 'Employee did not participate',
  };

  const confirmationLabels: Record<string, string> = {
    supports: 'Supports denial',
    supports_with_conditions: 'Supports with conditions',
    advises_against: 'Advises against denial',
  };

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-700">Denial Summary</h3>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls="denial-summary-body"
          className="text-xs text-blue-600 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {!collapsed && (
        <div id="denial-summary-body" className="px-4 pb-4 space-y-2 text-sm text-gray-700">
          <div className="flex gap-2">
            <span className="font-medium text-gray-500 w-24 shrink-0">Factor 1:</span>
            <span>
              {denialTypeLabels[denialType]} —{' '}
              {factor1.hardshipNarrative.slice(0, 100)}
              {factor1.hardshipNarrative.length > 100 && '…'}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="font-medium text-gray-500 w-24 shrink-0">Factor 2:</span>
            <span>{factor2.alternatives.length} alternatives considered</span>
          </div>
          <div className="flex gap-2">
            <span className="font-medium text-gray-500 w-24 shrink-0">Factor 3:</span>
            <span>
              {engagementLabels[factor3.engagementAssessment] ?? factor3.engagementAssessment}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="font-medium text-gray-500 w-24 shrink-0">Factor 4:</span>
            <span>
              {factor4.reviewerName} on {factor4.reviewDate} —{' '}
              {confirmationLabels[factor4.confirmation] ?? factor4.confirmation}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main DenyTab component
// ---------------------------------------------------------------------------

export function DenyTab({ caseData, onDenySuccess, onSwitchToApprove }: DenyTabProps) {
  const { id } = useParams<{ id: string }>();
  const { client } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Denial type selection
  const [denialType, setDenialType] = useState<DenialType | ''>('');

  // Current active factor (1-4); 5 = all complete
  const [currentFactor, setCurrentFactor] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Factor states
  const [factor1, setFactor1] = useState<Factor1State>({
    hardshipCategories: { costImpact: false, safetyRisk: false, operationalDisruption: false },
    costImpact: { dollarAmount: '', explanation: '' },
    safetyRiskDescription: '',
    operationalDisruptionText: '',
    hardshipNarrative: '',
  });

  const [factor2, setFactor2] = useState<Factor2State>({
    alternatives: [
      { description: '', whyConsidered: '', reasonRejected: '', discussedWithEmployee: '' },
      { description: '', whyConsidered: '', reasonRejected: '', discussedWithEmployee: '' },
    ],
    employeePreference: '',
    preferenceNotFeasible: '',
  });

  const [factor3, setFactor3] = useState<Factor3State>({
    confirmInteractiveProcess: false,
    engagementAssessment: '',
    outreachAttempts: [],
  });

  const [factor4, setFactor4] = useState<Factor4State>({
    reviewerName: '',
    reviewDate: '',
    reviewerContact: '',
    opinionSummary: '',
    confirmation: '',
    conditions: '',
    packageReviewConfirmed: false,
  });

  // Submit dialog state
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | string[] | null>(null);

  // Toast (passed up via onDenySuccess, but we also set local toast for errors)
  const [localToast, setLocalToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Abort controller ref for cleanup
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // aria-live announcement ref (assertive — fires when 4/4 complete)
  const [allCompleteAnnounced, setAllCompleteAnnounced] = useState(false);
  const allComplete = currentFactor === 5;

  useEffect(() => {
    if (allComplete && !allCompleteAnnounced) {
      setAllCompleteAnnounced(true);
    }
  }, [allComplete, allCompleteAnnounced]);

  const completedCount = currentFactor === 5 ? 4 : currentFactor - 1;

  // Build denialData for POST
  const buildDenialData = useCallback((): DenialData => {
    const dt = denialType as DenialType;
    return {
      costAnalysis: factor1.hardshipNarrative,
      financialResources: factor1.hardshipCategories.costImpact
        ? factor1.costImpact.explanation
        : `N/A — ${dt} basis`,
      sizeAndType: `${dt}: see hardship narrative`,
      operationalImpact: factor1.hardshipCategories.operationalDisruption
        ? factor1.operationalDisruptionText
        : `N/A — ${dt} basis`,
      alternativesConsidered: factor2.alternatives.map((a) => ({
        description: a.description,
        reasonRejected: a.reasonRejected,
      })),
    };
  }, [denialType, factor1, factor2]);

  const handleSubmit = useCallback(async () => {
    if (!id || !denialType) return;
    setIsSubmitting(true);
    setSubmitError(null);
    abortRef.current = new AbortController();

    try {
      const denialData = buildDenialData();
      await postDenyDecision(client, id, denialData);
      void queryClient.invalidateQueries({ queryKey: ['case', id] });
      setShowSubmitDialog(false);
      onDenySuccess();
      void navigate(`/cases/${id}`);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.name === 'AbortError'
      ) {
        return;
      }
      // Check for 400 with denialErrors array
      const apiErr = err as { status?: number; body?: { denialErrors?: string[] } };
      if (apiErr.status === 400 && apiErr.body?.denialErrors) {
        setSubmitError(apiErr.body.denialErrors);
      } else if (err instanceof Error) {
        setSubmitError(err.message || 'An unexpected error occurred. Please try again.');
      } else {
        setSubmitError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [id, denialType, client, queryClient, navigate, onDenySuccess, buildDenialData]);

  const DENIAL_OPTIONS: Array<{
    value: DenialType;
    title: string;
    description: string;
    legalBasis: string;
  }> = [
    {
      value: 'undue_hardship',
      title: 'Undue Hardship',
      description:
        'The accommodation would impose significant difficulty or expense',
      legalBasis: '42 USC 12112(b)(5)(A)',
    },
    {
      value: 'not_qualified',
      title: 'Not Qualified Individual',
      description:
        'Employee cannot perform essential functions with or without reasonable accommodation',
      legalBasis: '42 USC 12111(8)',
    },
    {
      value: 'direct_threat',
      title: 'Direct Threat',
      description:
        'Employee poses a significant risk of substantial harm that cannot be eliminated by accommodation',
      legalBasis: '42 USC 12113(b)',
    },
  ];

  return (
    <div className="space-y-6">
      {/* aria-live assertive announcement for screen readers */}
      <div aria-live="assertive" className="sr-only">
        {allCompleteAnnounced
          ? 'All denial requirements are now complete. The Submit Denial button is now available.'
          : ''}
      </div>

      {/* Local toast */}
      {localToast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            localToast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          <span>{localToast.type === 'success' ? '✓' : '✕'}</span>
          <span>{localToast.message}</span>
          <button
            type="button"
            onClick={() => setLocalToast(null)}
            aria-label="Dismiss notification"
            className="ml-2 opacity-75 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {/* Warning Banner */}
      <div
        role="alert"
        className="flex items-start gap-3 rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3"
      >
        <span className="text-yellow-600 font-bold text-lg" aria-hidden="true">!</span>
        <p className="text-sm text-yellow-800">
          <strong>Denying an accommodation request carries significant legal risk.</strong>{' '}
          The system will guide you through the required documentation to ensure compliance with
          ADA/EEOC guidelines.
        </p>
      </div>

      {/* Denial Type Selector */}
      <fieldset>
        <legend className="text-sm font-semibold text-gray-700">
          Select the legal basis for this denial:{' '}
          <span className="text-red-600">*</span>
        </legend>

        <div className="mt-3 space-y-3">
          {DENIAL_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                denialType === opt.value
                  ? 'border-[#2563EB] bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="denial-type"
                value={opt.value}
                checked={denialType === opt.value}
                onChange={() => setDenialType(opt.value)}
                className="mt-1 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <p className="text-sm font-semibold text-gray-800">{opt.title}</p>
                <p className="text-xs text-gray-600">{opt.description}</p>
                <p className="text-xs text-blue-700 font-medium mt-0.5">
                  Legal basis: {opt.legalBasis}
                </p>
              </div>
            </label>
          ))}
        </div>

        {!denialType && (
          <p className="mt-2 text-xs text-orange-600">
            Select a denial type to unlock Factor 1.
          </p>
        )}
      </fieldset>

      {/* Stepper */}
      <Stepper
        completedCount={completedCount}
        currentFactor={currentFactor}
        onClickComplete={(factor) => setCurrentFactor(factor as 1 | 2 | 3 | 4)}
      />

      {/* Factor Panels */}
      {!denialType ? (
        <div
          className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-400"
          title="Select denial type first"
        >
          Select denial type above to begin Factor 1: Undue Hardship Justification
        </div>
      ) : (
        <>
          {currentFactor === 1 && (
            <Factor1Panel
              state={factor1}
              onChange={setFactor1}
              onNext={() => setCurrentFactor(2)}
              denialType={denialType}
            />
          )}
          {currentFactor === 2 && (
            <Factor2Panel
              state={factor2}
              onChange={setFactor2}
              onNext={() => setCurrentFactor(3)}
              onBack={() => setCurrentFactor(1)}
            />
          )}
          {currentFactor === 3 && (
            <Factor3Panel
              state={factor3}
              caseData={caseData}
              onChange={setFactor3}
              onNext={() => setCurrentFactor(4)}
              onBack={() => setCurrentFactor(2)}
            />
          )}
          {currentFactor === 4 && (
            <Factor4Panel
              state={factor4}
              onChange={setFactor4}
              onComplete={() => setCurrentFactor(5)}
              onBack={() => setCurrentFactor(3)}
              onSwitchToApprove={onSwitchToApprove}
            />
          )}
        </>
      )}

      {/* All 4 Complete — Denial Summary + Submit button */}
      {allComplete && denialType && (
        <div className="space-y-4">
          <DenialSummary
            denialType={denialType as DenialType}
            factor1={factor1}
            factor2={factor2}
            factor3={factor3}
            factor4={factor4}
          />

          <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-700">
              All 4 EEOC factors complete. Ready to submit for supervisor review.
            </p>
            <button
              type="button"
              onClick={() => {
                setSubmitError(null);
                setShowSubmitDialog(true);
              }}
              className="rounded-md bg-[#DC2626] px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Submit Denial for Review
            </button>
          </div>
        </div>
      )}

      {/* Disabled Submit button when not complete */}
      {!allComplete && (
        <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm text-gray-500">
            {completedCount}/4 requirements complete — complete all EEOC factors first
          </p>
          <button
            type="button"
            disabled
            className="rounded-md bg-gray-300 px-5 py-2 text-sm font-semibold text-gray-500 cursor-not-allowed"
          >
            Submit Denial for Review
          </button>
        </div>
      )}

      {/* Submit Denial Dialog */}
      {showSubmitDialog && denialType && (
        <SubmitDenialDialog
          caseData={caseData}
          denialType={denialType as DenialType}
          factor3={factor3}
          factor4={factor4}
          onConfirm={() => { void handleSubmit(); }}
          onCancel={() => {
            setShowSubmitDialog(false);
            setSubmitError(null);
          }}
          isSubmitting={isSubmitting}
          submitError={submitError}
        />
      )}
    </div>
  );
}

// ===========================================================================
// ACMD-138-C — Gate 2: Supervisor Review Panel
// ===========================================================================

// ---------------------------------------------------------------------------
// Gate 3 — Final Confirmation (two-step: Step A summary, Step B type-to-confirm)
// ---------------------------------------------------------------------------

interface Gate3Props {
  caseData: AcmdCaseDetail;
  onCancel: () => void;
  onFinalized: () => void;
}

function Gate3FinalConfirmation({ caseData, onCancel, onFinalized }: Gate3Props) {
  const { client } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [step, setStep] = useState<'a' | 'b'>('a');
  const [confirmInput, setConfirmInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleConfirmDenial = async () => {
    if (confirmInput !== 'DENY' || !id) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await postSupervisorApproveDenial(client, id);
      onFinalized();
      void navigate(`/cases/${id}`, { state: { toast: 'Denial finalized' } });
    } catch (err: unknown) {
      if (err instanceof Error) {
        setSubmitError(err.message || 'An unexpected error occurred. Please try again.');
      } else {
        setSubmitError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const today = new Date().toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });

  const lawsLabel =
    caseData.type === 'ada'
      ? 'ADA'
      : caseData.type === 'pwfa'
      ? 'PWFA'
      : caseData.type === 'multiple'
      ? 'ADA + PWFA'
      : caseData.type.toUpperCase();

  const denialTypeLabel =
    caseData.denialType === 'undue_hardship'
      ? 'Undue Hardship'
      : caseData.denialType === 'not_qualified'
      ? 'Not Qualified Individual'
      : caseData.denialType === 'direct_threat'
      ? 'Direct Threat'
      : caseData.denialType ?? 'Not recorded';

  return (
    <div
      role="region"
      aria-label="Gate 3: Final Denial Confirmation"
      className="space-y-5"
    >
      {step === 'a' ? (
        /* ---- Step A: Summary ---- */
        <div className="rounded-lg border border-red-300 bg-white p-6 space-y-5">
          <h2 className="text-base font-semibold text-gray-900">
            Final Denial Confirmation — Step 1 of 2
          </h2>

          {/* Irreversibility warning */}
          <div
            role="alert"
            className="flex items-start gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-3"
          >
            <span className="text-red-600 font-bold text-lg" aria-hidden="true">!!</span>
            <p className="text-sm font-semibold text-red-800">
              This action is irreversible.
            </p>
          </div>

          <p className="text-sm text-gray-700">
            You are about to officially deny this accommodation request:
          </p>

          {/* 6-field summary table */}
          <dl className="grid grid-cols-1 gap-2 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm">
            <div className="grid grid-cols-[auto_1fr] gap-x-4">
              <dt className="font-medium text-gray-600 whitespace-nowrap">Employee:</dt>
              <dd className="text-gray-900">{caseData.employeeId}</dd>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4">
              <dt className="font-medium text-gray-600 whitespace-nowrap">Accommodation:</dt>
              <dd className="text-gray-900">{caseData.requestDescription ?? 'Not recorded'}</dd>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4">
              <dt className="font-medium text-gray-600 whitespace-nowrap">Denial Type:</dt>
              <dd className="text-gray-900">{denialTypeLabel}</dd>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4">
              <dt className="font-medium text-gray-600 whitespace-nowrap">Denial Reason:</dt>
              <dd className="text-gray-900">{caseData.denialReason ?? caseData.denialHardshipNarrative ?? 'Not recorded'}</dd>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4">
              <dt className="font-medium text-gray-600 whitespace-nowrap">Laws Applicable:</dt>
              <dd className="text-gray-900">{lawsLabel}</dd>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4">
              <dt className="font-medium text-gray-600 whitespace-nowrap">Supervisor:</dt>
              <dd className="text-gray-900">You approved this denial on {today}</dd>
            </div>
          </dl>

          {/* Action consequences */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">This action will:</p>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
              <li>Generate an official denial letter</li>
              <li>Notify the employee via email</li>
              <li>Notify the manager: &quot;Case resolved&quot; (NO denial details)</li>
              <li>Start 30-day appeal window</li>
              <li>All documentation becomes part of the permanent audit trail</li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="order-2 text-sm text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded sm:order-1"
            >
              Cancel — Return to Case
            </button>
            <button
              type="button"
              onClick={() => setStep('b')}
              className="order-1 rounded-md bg-[#DC2626] px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:order-2"
            >
              Continue to Final Step →
            </button>
          </div>
        </div>
      ) : (
        /* ---- Step B: Type-to-Confirm ---- */
        <div className="rounded-lg border border-red-400 bg-white p-6 space-y-5">
          <h2 className="text-base font-semibold text-gray-900">
            Final Denial Confirmation — Step 2 of 2
          </h2>

          {/* Red warning banner */}
          <div
            role="alert"
            className="rounded-md border border-red-400 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <p className="font-semibold">WARNING — Irreversible Action</p>
            <p className="mt-1">
              Once confirmed, a denial letter will be generated and sent to the employee. The denial
              and all supporting documentation become part of the permanent audit trail.
            </p>
          </div>

          {/* Type-to-confirm input */}
          <div className="space-y-2">
            <label
              htmlFor="gate3-confirm-input"
              className="block text-sm font-medium text-gray-700"
            >
              Type <strong>DENY</strong> to confirm this denial:
            </label>
            <input
              id="gate3-confirm-input"
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              aria-label="Type DENY in capital letters to confirm this denial"
              autoComplete="off"
              spellCheck={false}
              className="block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="Type DENY here"
            />
          </div>

          {/* Submit error */}
          {submitError && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {submitError}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="order-2 text-sm text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded sm:order-1"
            >
              ← Back to Supervisor Review
            </button>
            <button
              type="button"
              onClick={() => { void handleConfirmDenial(); }}
              disabled={confirmInput !== 'DENY' || isSubmitting}
              className="order-1 rounded-md bg-[#DC2626] px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:order-2"
            >
              {isSubmitting ? 'Finalizing…' : 'Confirm Denial'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SupervisorReviewPanel — Gate 2
// ---------------------------------------------------------------------------

export interface SupervisorReviewPanelProps {
  caseData: AcmdCaseDetail;
  userId: string;
  onDenialFinalized: () => void;
}

export function SupervisorReviewPanel({
  caseData,
  userId,
  onDenialFinalized,
}: SupervisorReviewPanelProps) {
  const { client } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Conflict of interest check
  const hasConflict =
    Boolean(userId) && caseData.managerId != null && userId === caseData.managerId;

  // Gate 3 state
  const [showGate3, setShowGate3] = useState(false);

  // Reject action state
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Request more info state
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestQuestions, setRequestQuestions] = useState('');
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  // Local toast
  const [localToast, setLocalToast] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  // Expandable sections state (Section 2-6 start collapsed; 1 and 7 start open)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    s1: true,
    s2: false,
    s3: false,
    s4: false,
    s5: false,
    s6: false,
    s7: true,
  });
  const toggleSection = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Navigate back to case with toast
  const navigateToCaseWithToast = (message: string) => {
    if (!id) return;
    setLocalToast({ message, type: 'success' });
    setTimeout(() => {
      void navigate(`/cases/${id}`);
    }, 800);
  };

  const handleRejectSubmit = async () => {
    if (!id || rejectReason.trim().length < 50) return;
    setRejectSubmitting(true);
    setRejectError(null);
    try {
      await postSupervisorRejectDenial(client, id, rejectReason.trim());
      navigateToCaseWithToast('Denial returned to HR');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setRejectError(err.message || 'An unexpected error occurred.');
      } else {
        setRejectError('An unexpected error occurred.');
      }
    } finally {
      setRejectSubmitting(false);
    }
  };

  const handleRequestSubmit = async () => {
    if (hasConflict) return;
    if (!id || !requestQuestions.trim()) return;
    setRequestSubmitting(true);
    setRequestError(null);
    try {
      await postSupervisorRequestInfo(client, id, requestQuestions.trim());
      navigateToCaseWithToast('Request sent to HR');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setRequestError(err.message || 'An unexpected error occurred.');
      } else {
        setRequestError('An unexpected error occurred.');
      }
    } finally {
      setRequestSubmitting(false);
    }
  };

  const lawsLabel =
    caseData.type === 'ada'
      ? 'ADA'
      : caseData.type === 'pwfa'
      ? 'PWFA'
      : caseData.type === 'multiple'
      ? 'ADA + PWFA'
      : caseData.type.toUpperCase();

  const denialTypeLabel =
    caseData.denialType === 'undue_hardship'
      ? 'Undue Hardship'
      : caseData.denialType === 'not_qualified'
      ? 'Not Qualified Individual'
      : caseData.denialType === 'direct_threat'
      ? 'Direct Threat'
      : caseData.denialType ?? 'Not recorded';

  // If Gate 3 is open, render it instead
  if (showGate3) {
    return (
      <div className="space-y-6">
        {localToast && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg bg-green-600 text-white"
          >
            <span>✓</span>
            <span>{localToast.message}</span>
          </div>
        )}
        <Gate3FinalConfirmation
          caseData={caseData}
          onCancel={() => setShowGate3(false)}
          onFinalized={onDenialFinalized}
        />
      </div>
    );
  }

  return (
    <section className="space-y-5" aria-label="Supervisor Review">
      {/* Local toast */}
      {localToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg bg-green-600 text-white"
        >
          <span>✓</span>
          <span>{localToast.message}</span>
          <button
            type="button"
            onClick={() => setLocalToast(null)}
            aria-label="Dismiss notification"
            className="ml-2 opacity-75 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {/* Supervisor Review Banner */}
      <div
        role="region"
        aria-label="Supervisor Review Required"
        className="flex items-start gap-3 rounded-md border border-blue-300 bg-blue-50 px-4 py-4"
      >
        <span className="text-blue-600 font-bold text-xl" aria-hidden="true">🛡</span>
        <div>
          <p className="text-sm font-bold text-blue-900 uppercase tracking-wide">
            Denial Review Required
          </p>
          <p className="mt-1 text-sm text-blue-800">
            {caseData.denialSubmittedByName ?? 'HR'} has submitted a denial for your review.
          </p>
          <p className="mt-0.5 text-sm text-blue-700">
            Review deadline: 5 business days
            {caseData.supervisorReviewDeadline
              ? ` (by ${new Date(caseData.supervisorReviewDeadline).toLocaleDateString('en-US')})`
              : ''}
          </p>
        </div>
      </div>

      {/* Case Header — read-only */}
      <div
        className="rounded-md border border-gray-200 bg-white p-4 space-y-2"
        aria-label="Case summary (read-only)"
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-mono text-gray-500">{caseData.id}</p>
          <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-800">
            Status: Denial Pending Review
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm text-gray-700">
          <p><span className="font-medium">Employee:</span> {caseData.employeeId}</p>
          <p><span className="font-medium">Accommodation:</span> {caseData.requestDescription ?? 'Not recorded'}</p>
          <p><span className="font-medium">Submitted by:</span> {caseData.denialSubmittedByName ?? 'HR'}</p>
          <p><span className="font-medium">Denial Type:</span> {denialTypeLabel}</p>
        </div>
        <div className="flex gap-2 mt-1">
          {(caseData.type === 'ada' || caseData.type === 'multiple') && (
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">ADA</span>
          )}
          {(caseData.type === 'pwfa' || caseData.type === 'multiple') && (
            <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800">PWFA</span>
          )}
        </div>
      </div>

      {/* Denial Package — 7 read-only sections */}
      <div
        role="region"
        aria-label="Denial Package — Read-Only"
        className="rounded-md border border-gray-200 bg-white divide-y divide-gray-100"
      >
        <p className="px-4 py-3 text-sm font-semibold text-gray-700 bg-gray-50">
          Denial Package — Read-Only
        </p>

        {/* Section 1: Case Summary */}
        <section
          role="region"
          aria-labelledby="pkg-s1-heading"
          className="px-4 py-3 space-y-2"
        >
          <h3 id="pkg-s1-heading" className="text-sm font-semibold text-gray-700">
            Section 1: Case Summary
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div>
              <dt className="font-medium text-gray-500 text-xs">Employee</dt>
              <dd className="text-gray-800">{caseData.employeeId}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-500 text-xs">Accommodation</dt>
              <dd className="text-gray-800">{caseData.requestDescription ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-500 text-xs">Laws</dt>
              <dd className="text-gray-800">{lawsLabel}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-500 text-xs">Created</dt>
              <dd className="text-gray-800">
                {new Date(caseData.createdAt).toLocaleDateString('en-US')}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-gray-500 text-xs">Stage</dt>
              <dd className="text-gray-800">Stage 5: Decision</dd>
            </div>
          </dl>
        </section>

        {/* Section 2: Undue Hardship Analysis (Factor 1) */}
        <section
          role="region"
          aria-labelledby="pkg-s2-heading"
          className="px-4 py-3"
        >
          <button
            type="button"
            id="pkg-s2-heading"
            aria-expanded={expanded.s2}
            aria-controls="pkg-s2-body"
            onClick={() => toggleSection('s2')}
            className="flex w-full items-center justify-between text-sm font-semibold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            Section 2: Undue Hardship Analysis (Factor 1)
            <span aria-hidden="true">{expanded.s2 ? '▲' : '▼'}</span>
          </button>
          {expanded.s2 && (
            <div id="pkg-s2-body" className="mt-3 space-y-2 text-sm text-gray-700">
              <p>
                <span className="font-medium">Categories:</span>{' '}
                {caseData.denialHardshipCategories ?? 'Not recorded'}
              </p>
              <p>
                <span className="font-medium">Narrative:</span>{' '}
                <span className="italic">&ldquo;{caseData.denialHardshipNarrative ?? 'Not recorded'}&rdquo;</span>
              </p>
              <p>
                <span className="font-medium">Evidence:</span>{' '}
                {caseData.denialEvidenceCount != null
                  ? `${caseData.denialEvidenceCount} file${caseData.denialEvidenceCount !== 1 ? 's' : ''} attached`
                  : 'Not recorded'}
              </p>
            </div>
          )}
        </section>

        {/* Section 3: Alternatives Considered (Factor 2) */}
        <section
          role="region"
          aria-labelledby="pkg-s3-heading"
          className="px-4 py-3"
        >
          <button
            type="button"
            id="pkg-s3-heading"
            aria-expanded={expanded.s3}
            aria-controls="pkg-s3-body"
            onClick={() => toggleSection('s3')}
            className="flex w-full items-center justify-between text-sm font-semibold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            Section 3: Alternatives Considered (Factor 2)
            <span aria-hidden="true">{expanded.s3 ? '▲' : '▼'}</span>
          </button>
          {expanded.s3 && (
            <div id="pkg-s3-body" className="mt-3 space-y-2 text-sm text-gray-700">
              {caseData.denialAlternatives && caseData.denialAlternatives.length > 0 ? (
                <>
                  <p>
                    <span className="font-medium">{caseData.denialAlternatives.length}</span>{' '}
                    alternative{caseData.denialAlternatives.length !== 1 ? 's' : ''} documented
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    {caseData.denialAlternatives.map((alt, idx) => (
                      <li key={idx}>
                        <span className="font-medium">Alt #{idx + 1}:</span> {alt.description} —{' '}
                        <span className="text-gray-500">rejected ({alt.reasonRejected})</span>
                      </li>
                    ))}
                  </ul>
                  {caseData.denialEmployeePreference && (
                    <p>
                      <span className="font-medium">Employee preference:</span>{' '}
                      {caseData.denialEmployeePreference}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-gray-400 italic">Not recorded</p>
              )}
            </div>
          )}
        </section>

        {/* Section 4: Interactive Process (Factor 3) */}
        <section
          role="region"
          aria-labelledby="pkg-s4-heading"
          className="px-4 py-3"
        >
          <button
            type="button"
            id="pkg-s4-heading"
            aria-expanded={expanded.s4}
            aria-controls="pkg-s4-body"
            onClick={() => toggleSection('s4')}
            className="flex w-full items-center justify-between text-sm font-semibold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            Section 4: Interactive Process (Factor 3)
            <span aria-hidden="true">{expanded.s4 ? '▲' : '▼'}</span>
          </button>
          {expanded.s4 && (
            <div id="pkg-s4-body" className="mt-3 space-y-1 text-sm text-gray-700">
              <p>
                <span className="font-medium">Confirmed:</span>{' '}
                {caseData.denialInteractiveProcessConfirmed
                  ? 'Interactive process conducted'
                  : 'Not confirmed'}
              </p>
              <p>
                <span className="font-medium">Engagement:</span>{' '}
                {caseData.denialEngagementAssessment ?? 'Not recorded'}
              </p>
              <p>
                <span className="font-medium">Discussion:</span>{' '}
                {caseData.denialDiscussionDate
                  ? `${new Date(caseData.denialDiscussionDate).toLocaleDateString('en-US')} via ${caseData.denialDiscussionMethod ?? 'unknown method'}`
                  : 'Not recorded'}
              </p>
            </div>
          )}
        </section>

        {/* Section 5: Legal Review (Factor 4) */}
        <section
          role="region"
          aria-labelledby="pkg-s5-heading"
          className="px-4 py-3"
        >
          <button
            type="button"
            id="pkg-s5-heading"
            aria-expanded={expanded.s5}
            aria-controls="pkg-s5-body"
            onClick={() => toggleSection('s5')}
            className="flex w-full items-center justify-between text-sm font-semibold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            Section 5: Legal Review (Factor 4)
            <span aria-hidden="true">{expanded.s5 ? '▲' : '▼'}</span>
          </button>
          {expanded.s5 && (
            <div id="pkg-s5-body" className="mt-3 space-y-1 text-sm text-gray-700">
              <p>
                <span className="font-medium">Reviewer:</span>{' '}
                {caseData.denialLegalReviewer ?? 'Not recorded'}{' '}
                {caseData.denialLegalReviewDate
                  ? `| Date: ${new Date(caseData.denialLegalReviewDate).toLocaleDateString('en-US')}`
                  : ''}
              </p>
              <p>
                <span className="font-medium">Opinion:</span>{' '}
                {caseData.denialLegalOpinion ?? 'Not recorded'}
              </p>
            </div>
          )}
        </section>

        {/* Section 6: Case Timeline */}
        <section
          role="region"
          aria-labelledby="pkg-s6-heading"
          className="px-4 py-3"
        >
          <button
            type="button"
            id="pkg-s6-heading"
            aria-expanded={expanded.s6}
            aria-controls="pkg-s6-body"
            onClick={() => toggleSection('s6')}
            className="flex w-full items-center justify-between text-sm font-semibold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            Section 6: Case Timeline
            <span aria-hidden="true">{expanded.s6 ? '▲' : '▼'}</span>
          </button>
          {expanded.s6 && (
            <div id="pkg-s6-body" className="mt-3 text-sm text-gray-700">
              {caseData.timeline && caseData.timeline.length > 0 ? (
                <ol className="list-decimal pl-5 space-y-1">
                  {caseData.timeline.map((event, idx) => (
                    <li key={idx}>
                      <span className="font-medium">
                        {new Date(event.date).toLocaleDateString('en-US')}
                      </span>{' '}
                      — {event.event}{' '}
                      <span className="text-gray-400">({event.actor})</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-gray-400 italic">Timeline not available</p>
              )}
            </div>
          )}
        </section>

        {/* Section 7: Deadline Status */}
        <section
          role="region"
          aria-labelledby="pkg-s7-heading"
          className="px-4 py-3"
        >
          <h3 id="pkg-s7-heading" className="text-sm font-semibold text-gray-700 mb-2">
            Section 7: Deadline Status
          </h3>
          <div className="text-sm text-gray-700 space-y-1">
            {caseData.deadline ? (
              <>
                <p>
                  <span className="font-medium">Deadline:</span>{' '}
                  {new Date(caseData.deadline).toLocaleDateString('en-US')}
                </p>
                <p>
                  <span className="font-medium">Days remaining:</span>{' '}
                  {Math.max(
                    0,
                    Math.ceil(
                      (new Date(caseData.deadline).getTime() - Date.now()) /
                        (1000 * 60 * 60 * 24),
                    ),
                  )}{' '}
                  days
                </p>
              </>
            ) : (
              <p className="text-gray-400 italic">No deadline set</p>
            )}
            {caseData.supervisorReviewDeadline && (
              <p>
                <span className="font-medium">Supervisor review deadline:</span>{' '}
                {new Date(caseData.supervisorReviewDeadline).toLocaleDateString('en-US')}
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Conflict of Interest Block */}
      {hasConflict && (
        <div
          role="alert"
          className="rounded-md border border-red-400 bg-red-50 px-4 py-4 space-y-2"
        >
          <p className="text-sm font-bold text-red-800">
            !! BLOCKED: Supervisor cannot review denial for an employee they directly manage.
          </p>
          <p className="text-sm text-red-700">
            You are listed as the direct manager for this employee. This creates a conflict of
            interest for the denial review.
          </p>
          <p className="text-sm text-red-700">
            Please assign a different reviewer in Settings &gt; Approval Configuration.
          </p>
          <a
            href="/settings/approval-configuration"
            className="inline-flex items-center text-sm font-medium text-red-700 underline hover:text-red-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            Go to Approval Configuration →
          </a>
        </div>
      )}

      {/* Supervisor Decision Panel */}
      <div
        role="region"
        aria-label="Supervisor Decision Panel"
        className="rounded-md border border-gray-200 bg-white p-5 space-y-5"
      >
        {/* Advisory note */}
        <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 px-3 py-3">
          <span className="text-blue-500 font-bold" aria-hidden="true">ℹ</span>
          <p className="text-sm text-blue-800">
            As supervisor, you are the final check before this denial becomes official. Review all
            documentation carefully. An insufficiently documented denial is the primary ADA
            litigation risk.
          </p>
        </div>

        {/* [Approve Denial] button */}
        <div>
          <button
            type="button"
            onClick={() => {
              if (!hasConflict) setShowGate3(true);
            }}
            disabled={hasConflict}
            aria-disabled={hasConflict}
            className="rounded-md bg-[#DC2626] px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            Approve Denial →
          </button>
          {hasConflict && (
            <p className="mt-1 text-xs text-red-600">Blocked due to conflict of interest.</p>
          )}
        </div>

        {/* [Reject Denial + Return to HR] */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              setRejectOpen((o) => !o);
              setRequestOpen(false);
            }}
            disabled={hasConflict}
            aria-disabled={hasConflict}
            aria-expanded={rejectOpen}
            className="rounded-md border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reject Denial + Return to HR
          </button>

          {rejectOpen && (
            <div className="space-y-2 pl-1">
              <label
                htmlFor="reject-reason"
                className="block text-sm font-medium text-gray-700"
              >
                Reason for rejection: <span className="text-red-600">*</span>
              </label>
              <textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={4}
                required
                aria-required="true"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Provide a reason for returning the denial to HR (min 50 characters)…"
              />
              <CharCount current={rejectReason.trim().length} min={50} />
              {rejectError && (
                <p role="alert" className="text-xs text-red-600">{rejectError}</p>
              )}
              <button
                type="button"
                onClick={() => { void handleRejectSubmit(); }}
                disabled={rejectReason.trim().length < 50 || rejectSubmitting}
                className="rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rejectSubmitting ? 'Submitting…' : 'Confirm Rejection'}
              </button>
            </div>
          )}
        </div>

        {/* [Request More Information] */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              setRequestOpen((o) => !o);
              setRejectOpen(false);
            }}
            aria-expanded={requestOpen}
            disabled={hasConflict}
            aria-disabled={hasConflict}
            className="text-sm font-medium text-blue-700 underline hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded disabled:cursor-not-allowed disabled:opacity-50"
          >
            Request More Information
          </button>

          {requestOpen && (
            <div className="space-y-2 pl-1">
              <label
                htmlFor="request-questions"
                className="block text-sm font-medium text-gray-700"
              >
                Questions for HR: <span className="text-red-600">*</span>
              </label>
              <textarea
                id="request-questions"
                value={requestQuestions}
                onChange={(e) => setRequestQuestions(e.target.value)}
                rows={4}
                required
                aria-required="true"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Enter your questions for HR…"
              />
              {requestError && (
                <p role="alert" className="text-xs text-red-600">{requestError}</p>
              )}
              <button
                type="button"
                onClick={() => { void handleRequestSubmit(); }}
                disabled={!requestQuestions.trim() || requestSubmitting}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {requestSubmitting ? 'Sending…' : 'Send Request'}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
