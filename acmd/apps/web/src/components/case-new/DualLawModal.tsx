/**
 * DualLawModal — ACMD-136-B
 *
 * Mandatory confirmation gate before saving a case.
 * Presents ADA / PWFA / FMLA checkboxes with auto-detection from request text.
 *
 * Auto-detection logic (keyword scan, case-insensitive):
 *   ADA:  disability, disabled, medical, condition, chronic, physical, mental,
 *         vision, hearing, mobility, wheelchair, ergonomic, pain, injury,
 *         impairment, accommodation
 *   PWFA: pregnant, pregnancy, prenatal, postpartum, childbirth, nursing,
 *         breastfeeding, lactation, maternity, trimester, morning sickness, gestational
 *   FMLA: always pre-checked (HR can uncheck)
 *
 * Validation: At least 1 of ADA or PWFA must be checked.
 * Dual-law banner: shown when >= 2 laws checked.
 *
 * Accessibility:
 *   - Focus trap inside modal
 *   - Escape key → onClose
 *   - aria-modal, role="dialog"
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LawSelection {
  ada: boolean;
  pwfa: boolean;
  fmla: boolean;
}

export interface DualLawModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (laws: LawSelection) => void;
  requestDescription: string;
  functionalLimitations: string;
  isSubmitting?: boolean;
}

// ---------------------------------------------------------------------------
// Auto-detection
// ---------------------------------------------------------------------------

const ADA_KEYWORDS = [
  'disability', 'disabled', 'medical', 'condition', 'chronic', 'physical',
  'mental', 'vision', 'hearing', 'mobility', 'wheelchair', 'ergonomic',
  'pain', 'injury', 'impairment', 'accommodation',
];

const PWFA_KEYWORDS = [
  'pregnant', 'pregnancy', 'prenatal', 'postpartum', 'childbirth', 'nursing',
  'breastfeeding', 'lactation', 'maternity', 'trimester', 'morning sickness',
  'gestational',
];

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

export function detectLaws(
  requestDescription: string,
  functionalLimitations: string,
): LawSelection {
  const combined = `${requestDescription} ${functionalLimitations}`;
  return {
    ada: containsAny(combined, ADA_KEYWORDS),
    pwfa: containsAny(combined, PWFA_KEYWORDS),
    fmla: true, // always pre-checked
  };
}

// ---------------------------------------------------------------------------
// LawCheckbox
// ---------------------------------------------------------------------------

interface LawCheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  law: 'ADA' | 'PWFA' | 'FMLA';
  title: string;
  description: string;
  detectedLabel: string | null;  // null = no detection
  warningMessage?: string;       // shown when user un-checks a pre-checked law
}

function LawCheckbox({
  id,
  checked,
  onChange,
  title,
  description,
  detectedLabel,
  warningMessage,
}: LawCheckboxProps) {
  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition',
        checked ? 'border-[#2563EB] bg-blue-50' : 'border-gray-200 bg-white',
      )}
      data-testid={`law-row-${id}`}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          id={id}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded accent-[#2563EB]"
          aria-describedby={`${id}-desc`}
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-semibold text-[#1E3A5F]">{title}</p>
          <p id={`${id}-desc`} className="text-xs text-gray-600">{description}</p>
          {detectedLabel !== null && (
            <span
              className="inline-flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800"
              data-testid={`detected-label-${id}`}
            >
              <svg
                className="h-3 w-3"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 0z" />
              </svg>
              {detectedLabel}
            </span>
          )}
          {warningMessage && (
            <p className="mt-1 text-xs text-amber-700" data-testid={`warn-${id}`} role="alert">
              {warningMessage}
            </p>
          )}
        </div>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DualLawModal
// ---------------------------------------------------------------------------

export function DualLawModal({
  isOpen,
  onClose,
  onConfirm,
  requestDescription,
  functionalLimitations,
  isSubmitting = false,
}: DualLawModalProps) {
  // Initialise from auto-detection when opened
  const [laws, setLaws] = useState<LawSelection>(() =>
    detectLaws(requestDescription, functionalLimitations),
  );

  // Track which laws were originally auto-detected so we can warn if un-checked
  // useMemo so it recomputes whenever props change (fixes stale state on modal re-open)
  const autoDetected = useMemo(
    () => detectLaws(requestDescription, functionalLimitations),
    [requestDescription, functionalLimitations],
  );

  // Re-run detection when input props change (e.g. opened with different data)
  useEffect(() => {
    if (isOpen) {
      setLaws(autoDetected);
    }
  }, [isOpen, autoDetected]);

  // Focus trap
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Move focus inside on open
    const timer = setTimeout(() => {
      firstFocusableRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }

      // Basic focus trap
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (!focusable.length) return;

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleLawChange = useCallback((law: keyof LawSelection, checked: boolean) => {
    setLaws((prev) => ({ ...prev, [law]: checked }));
  }, []);

  const handleConfirm = () => {
    // At least ADA or PWFA must be checked (button is also disabled when both are false)
    if (!laws.ada && !laws.pwfa) return;
    onConfirm(laws);
  };

  const checkedCount = [laws.ada, laws.pwfa, laws.fmla].filter(Boolean).length;
  const isDualLaw = checkedCount >= 2;

  if (!isOpen) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      data-testid="dual-law-modal-backdrop"
    >
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dual-law-modal-title"
        aria-describedby="dual-law-modal-desc"
        className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl"
        data-testid="dual-law-modal"
      >
        {/* Header */}
        <div className="border-b border-gray-200 px-6 py-4">
          <h2
            id="dual-law-modal-title"
            className="text-lg font-bold tracking-wide text-[#1E3A5F]"
          >
            DUAL-LAW EVALUATION
          </h2>
          <p id="dual-law-modal-desc" className="mt-1 text-sm text-gray-600">
            Before saving, confirm which federal laws apply. System pre-checks based on request
            description. Review and confirm.
          </p>
        </div>

        {/* Body */}
        <div className="space-y-3 px-6 py-5">
          {/* ADA */}
          <LawCheckbox
            id="ada"
            checked={laws.ada}
            onChange={(v) => handleLawChange('ada', v)}
            law="ADA"
            title="ADA — Americans with Disabilities Act"
            description="Requires reasonable accommodations for qualified individuals with disabilities."
            detectedLabel={autoDetected.ada ? 'auto-detected: keywords found' : 'no keywords detected'}
            warningMessage={
              autoDetected.ada && !laws.ada
                ? 'The system detected ADA may apply. Are you sure?'
                : undefined
            }
          />

          {/* PWFA */}
          <LawCheckbox
            id="pwfa"
            checked={laws.pwfa}
            onChange={(v) => handleLawChange('pwfa', v)}
            law="PWFA"
            title="PWFA — Pregnant Workers Fairness Act"
            description="Requires accommodations for pregnancy, childbirth, and related conditions."
            detectedLabel={autoDetected.pwfa ? 'auto-detected: keywords found' : 'no keywords detected'}
            warningMessage={
              autoDetected.pwfa && !laws.pwfa
                ? 'The system detected PWFA may apply. Are you sure?'
                : undefined
            }
          />

          {/* FMLA */}
          <LawCheckbox
            id="fmla"
            checked={laws.fmla}
            onChange={(v) => handleLawChange('fmla', v)}
            law="FMLA"
            title="FMLA — Family and Medical Leave Act"
            description="Provides up to 12 weeks of unpaid, job-protected leave for qualifying conditions."
            detectedLabel="auto-check: employee eligible"
            warningMessage={
              autoDetected.fmla && !laws.fmla
                ? 'The system detected FMLA may apply. Are you sure?'
                : undefined
            }
          />

          {/* Dual-law badge — shown when >= 2 laws checked */}
          {isDualLaw && (
            <div
              className="flex items-center gap-2 rounded-lg border border-[#2563EB] bg-blue-50 px-4 py-3"
              data-testid="dual-law-banner"
              role="status"
              aria-live="polite"
            >
              <svg
                className="h-5 w-5 shrink-0 text-[#2563EB]"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
              <p className="text-sm font-semibold text-[#2563EB]">DUAL-LAW CASE</p>
            </div>
          )}

          {/* Validation error — static: shown whenever both ADA and PWFA are unchecked */}
          {!laws.ada && !laws.pwfa && (
            <p
              className="mt-2 text-sm text-red-600"
              role="alert"
              data-testid="validation-error"
            >
              At least one law (ADA or PWFA) must apply.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 border-t border-gray-200 px-6 py-4 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className={cn(
              'rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition',
              'hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
            data-testid="btn-cancel"
          >
            Cancel — Return to Form
          </button>

          <button
            ref={firstFocusableRef}
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || (!laws.ada && !laws.pwfa)}
            aria-disabled={isSubmitting || (!laws.ada && !laws.pwfa)}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold text-white transition',
              'focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:ring-offset-1',
              !laws.ada && !laws.pwfa
                ? 'cursor-not-allowed bg-gray-300'
                : 'bg-[#1E3A5F] hover:opacity-90',
              isSubmitting && 'cursor-wait opacity-70',
            )}
            data-testid="btn-confirm"
          >
            {isSubmitting && (
              <svg
                className="h-4 w-4 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            Confirm & Save
          </button>
        </div>
      </div>
    </div>
  );
}
