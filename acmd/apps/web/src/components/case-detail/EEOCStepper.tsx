/**
 * EEOCStepper — 6-stage EEOC accommodation process stepper (ACMD-137-B)
 *
 * Renders a horizontal stepper with role-based labels, visual states, and
 * full WCAG 2.2 AA accessibility attributes.
 *
 * Compliance:
 *   - Manager view: ZERO EEOC terminology — generic labels only
 *   - prefers-reduced-motion: pulse animation gated on media query
 *   - aria-current, aria-disabled, role=navigation per spec
 */

import type { CaseStatus, CaseType } from '@/lib/api/cases';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StepperRole = 'super_admin' | 'hr' | 'medical_reviewer' | 'manager';

export interface EEOCStepperProps {
  currentStatus: CaseStatus;
  caseType: CaseType;
  role: StepperRole;
  pwfaExempt?: boolean;
  onStageClick?: (stage: number) => void;
}

// ---------------------------------------------------------------------------
// Stage derivation
// ---------------------------------------------------------------------------

export function deriveCurrentStage(status: CaseStatus): number {
  switch (status) {
    case 'intake':
      return 1;
    case 'active':
      return 2;
    case 'interactive_process':
    case 'awaiting_input':
      return 3;
    case 'awaiting_medical':
      return 4;
    case 'review':
      return 5;
    case 'implementation':
      return 6;
    case 'approved':
    case 'denied':
      return 5; // stage 5 complete
    case 'closed':
      return 6; // all complete
    default:
      return 1;
  }
}

// ---------------------------------------------------------------------------
// Stage labels
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<number, { default: string; manager: string }> = {
  1: { default: 'Intake',                 manager: 'Request' },
  2: { default: 'Acknowledgment',         manager: 'Received' },
  3: { default: 'Interactive Discussion', manager: 'In Review' },
  4: { default: 'Medical Documentation', manager: 'In Review' },
  5: { default: 'Decision',              manager: 'Decision Pending' },
  6: { default: 'Follow-up',             manager: 'Monitoring' },
};

// ---------------------------------------------------------------------------
// Visual state types
// ---------------------------------------------------------------------------

type StageState = 'completed' | 'current' | 'upcoming' | 'pwfa_exempt';

const STATE_STYLES: Record<StageState, {
  border: string;
  bg: string;
  iconBg: string;
  iconBorder: string;
  iconColor: string;
  labelColor: string;
}> = {
  completed: {
    border: 'border-green-500',
    bg: 'bg-green-50',
    iconBg: 'bg-green-500',
    iconBorder: 'border-green-500',
    iconColor: 'text-white',
    labelColor: 'text-green-800',
  },
  current: {
    border: 'border-blue-600',
    bg: 'bg-blue-50',
    iconBg: 'bg-blue-600',
    iconBorder: 'border-blue-600',
    iconColor: 'text-white',
    labelColor: 'text-blue-900',
  },
  upcoming: {
    border: 'border-gray-300',
    bg: 'bg-gray-50',
    iconBg: 'bg-gray-100',
    iconBorder: 'border-gray-300',
    iconColor: 'text-gray-400',
    labelColor: 'text-gray-500',
  },
  pwfa_exempt: {
    border: 'border-purple-600',
    bg: 'bg-purple-50',
    iconBg: 'bg-purple-600',
    iconBorder: 'border-purple-600',
    iconColor: 'text-white',
    labelColor: 'text-purple-900',
  },
};

// ---------------------------------------------------------------------------
// Helper: determine stage state
// ---------------------------------------------------------------------------

function getStageState(
  stageNum: number,
  currentStage: number,
  status: CaseStatus,
  pwfaExempt: boolean,
): StageState {
  // PWFA exempt: stage 4 gets special styling if it's current or past
  if (stageNum === 4 && pwfaExempt && currentStage >= 4) {
    return 'pwfa_exempt';
  }

  if (stageNum < currentStage) return 'completed';

  // Terminal statuses make stage 5 "completed" (not current)
  if ((status === 'approved' || status === 'denied') && stageNum === 5) {
    return 'completed';
  }
  if (status === 'closed' && stageNum <= 6) {
    return stageNum === currentStage ? 'current' : 'completed';
  }

  if (stageNum === currentStage) return 'current';
  return 'upcoming';
}

// ---------------------------------------------------------------------------
// Single Step component
// ---------------------------------------------------------------------------

interface StepItemProps {
  stageNum: number;
  label: string;
  state: StageState;
  isClickable: boolean;
  isPwfaExempt: boolean;
  onClick: () => void;
}

function StepItem({
  stageNum,
  label,
  state,
  isClickable,
  isPwfaExempt,
  onClick,
}: StepItemProps) {
  const styles = STATE_STYLES[state];

  const stateText =
    state === 'completed'
      ? 'completed'
      : state === 'current'
        ? 'current'
        : state === 'pwfa_exempt'
          ? 'PWFA exempt'
          : 'upcoming';

  const ariaLabel = `Stage ${stageNum}: ${label}${isPwfaExempt ? ' (PWFA Exempt)' : ''} — ${stateText}`;

  const isUpcoming = state === 'upcoming';
  const isDisabled = !isClickable || isUpcoming;

  // Icon content
  let icon: React.ReactNode;
  if (state === 'completed' || state === 'pwfa_exempt') {
    icon = (
      <span aria-hidden="true" className="text-sm font-bold">
        ✓
      </span>
    );
  } else if (state === 'current') {
    icon = (
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 rounded-full bg-white motion-safe:animate-pulse"
      />
    );
  } else {
    icon = (
      <span aria-hidden="true" className="text-xs text-gray-400 font-medium">
        {stageNum}
      </span>
    );
  }

  const content = (
    <div className="flex flex-col items-center gap-2 min-w-0">
      {/* Circle icon */}
      <div
        className={`
          flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2
          ${styles.iconBorder} ${styles.iconBg} ${styles.iconColor}
          transition-colors
        `}
      >
        {icon}
      </div>

      {/* Label */}
      <span
        className={`text-center text-xs font-medium leading-tight ${styles.labelColor}`}
      >
        {label}
        {isPwfaExempt && state === 'pwfa_exempt' && (
          <span className="block text-purple-600 text-[10px] font-normal mt-0.5">
            (PWFA Exempt)
          </span>
        )}
      </span>
    </div>
  );

  return (
    <li
      role="listitem"
      aria-current={state === 'current' ? 'step' : undefined}
      aria-disabled={isDisabled ? 'true' : undefined}
      aria-label={ariaLabel}
      title={isUpcoming && isClickable ? 'Complete current stage first' : undefined}
    >
      {isDisabled ? (
        <div
          className={`
            flex flex-col items-center cursor-default rounded-lg p-2
            transition-colors
            ${isUpcoming ? 'opacity-60' : ''}
          `}
          aria-label={ariaLabel}
        >
          {content}
        </div>
      ) : (
        <button
          type="button"
          onClick={onClick}
          className={`
            flex flex-col items-center rounded-lg p-2
            hover:bg-opacity-80 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-blue-500 focus-visible:ring-offset-2
            transition-colors cursor-pointer
          `}
          aria-label={ariaLabel}
        >
          {content}
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Connector line between steps
// ---------------------------------------------------------------------------

function StepConnector({ completed }: { completed: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`hidden sm:block h-0.5 flex-1 mx-1 mt-4 rounded transition-colors ${
        completed ? 'bg-green-400' : 'bg-gray-200'
      }`}
    />
  );
}

// ---------------------------------------------------------------------------
// Main EEOCStepper
// ---------------------------------------------------------------------------

export function EEOCStepper({
  currentStatus,
  caseType: _caseType,
  role,
  pwfaExempt = false,
  onStageClick,
}: EEOCStepperProps) {
  const currentStage = deriveCurrentStage(currentStatus);
  const isManager = role === 'manager';
  const isClickableRole = role === 'super_admin' || role === 'hr';

  const navAriaLabel = role === 'manager'
    ? 'Request progress stages'
    : 'EEOC accommodation process stages';

  const stages = [1, 2, 3, 4, 5, 6] as const;

  // Keyboard navigation handler — arrow keys move focus between steps
  function handleKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('button, [tabindex="0"]'),
    );
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (idx === -1) return;
    if (e.key === 'ArrowRight' && idx < items.length - 1) {
      e.preventDefault();
      items[idx + 1].focus();
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault();
      items[idx - 1].focus();
    }
  }

  return (
    <nav
      role="navigation"
      aria-label={navAriaLabel}
      className="w-full"
    >
      <ul
        role="list"
        className="flex items-start justify-between gap-1 sm:gap-2"
        onKeyDown={handleKeyDown}
      >
        {stages.map((stageNum, idx) => {
          const label = isManager
            ? STAGE_LABELS[stageNum].manager
            : STAGE_LABELS[stageNum].default;

          const state = getStageState(stageNum, currentStage, currentStatus, pwfaExempt);
          const isPwfaExempt = stageNum === 4 && pwfaExempt;
          const isUpcoming = state === 'upcoming';
          const isClickable = isClickableRole && !isUpcoming;

          return (
            <div
              key={stageNum}
              className="flex flex-1 items-start min-w-0"
            >
              <StepItem
                stageNum={stageNum}
                label={label}
                state={state}
                isClickable={isClickable}
                isPwfaExempt={isPwfaExempt}
                onClick={() => {
                  if (isClickable && onStageClick) {
                    onStageClick(stageNum);
                  }
                }}
              />
              {/* Connector — show between steps except after the last */}
              {idx < stages.length - 1 && (
                <StepConnector
                  completed={stageNum < currentStage || currentStatus === 'closed'}
                />
              )}
            </div>
          );
        })}
      </ul>
    </nav>
  );
}
