/**
 * CaseStepper — Phase 6C (ACMD-136-A)
 *
 * Horizontal stepper on desktop, vertical on mobile (<768px).
 * - Active step: Navy fill (#1E3A5F), aria-current="step"
 * - Completed step: checkmark + muted
 * - Clicking a completed step navigates back (calls onStepClick)
 * - Forward navigation only via "Next" button (disabled click on future steps)
 *
 * Accessibility: role="group", aria-label="Case creation progress"
 */

import { cn } from '@/lib/utils';

export interface StepperStep {
  label: string;
  index: number; // 1-based
}

export const CASE_STEPS: StepperStep[] = [
  { label: 'Basic Info', index: 1 },
  { label: 'Details', index: 2 },
  { label: 'Documents', index: 3 },
];

interface CaseStepperProps {
  currentStep: 1 | 2 | 3;
  /** Called when user clicks a previously completed step */
  onStepClick: (step: 1 | 2 | 3) => void;
}

export function CaseStepper({ currentStep, onStepClick }: CaseStepperProps) {
  return (
    <nav
      role="group"
      aria-label="Case creation progress"
      className="w-full"
    >
      {/* Desktop: horizontal */}
      <ol className="hidden sm:flex items-center w-full">
        {CASE_STEPS.map((step, idx) => {
          const isActive = step.index === currentStep;
          const isCompleted = step.index < currentStep;
          const isFuture = step.index > currentStep;
          const isLast = idx === CASE_STEPS.length - 1;

          return (
            <li key={step.index} className={cn('flex items-center', !isLast && 'flex-1')}>
              <button
                type="button"
                aria-current={isActive ? 'step' : undefined}
                aria-label={`Step ${step.index}: ${step.label}${isCompleted ? ', completed' : isActive ? ', current' : ''}`}
                disabled={isFuture}
                onClick={() => {
                  if (isCompleted) {
                    onStepClick(step.index as 1 | 2 | 3);
                  }
                }}
                className={cn(
                  'flex items-center gap-2 text-sm font-medium transition-colors',
                  isCompleted && 'cursor-pointer hover:opacity-80',
                  isFuture && 'cursor-not-allowed opacity-50',
                  isActive && 'cursor-default',
                )}
              >
                {/* Circle indicator */}
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    isActive && 'bg-[#1E3A5F] text-white',
                    isCompleted && 'bg-green-600 text-white',
                    isFuture && 'border-2 border-gray-300 text-gray-400 bg-white',
                  )}
                  aria-hidden="true"
                >
                  {isCompleted ? '✓' : step.index}
                </span>
                {/* Label */}
                <span
                  className={cn(
                    isActive && 'text-[#1E3A5F] font-semibold',
                    isCompleted && 'text-green-700',
                    isFuture && 'text-gray-400',
                  )}
                >
                  {step.index}. {step.label}
                </span>
              </button>

              {/* Connector line */}
              {!isLast && (
                <div
                  className={cn(
                    'mx-3 h-0.5 flex-1',
                    step.index < currentStep ? 'bg-green-600' : 'bg-gray-200',
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Mobile: vertical */}
      <ol className="flex sm:hidden flex-col gap-2">
        {CASE_STEPS.map((step) => {
          const isActive = step.index === currentStep;
          const isCompleted = step.index < currentStep;
          const isFuture = step.index > currentStep;

          return (
            <li key={step.index}>
              <button
                type="button"
                aria-current={isActive ? 'step' : undefined}
                aria-label={`Step ${step.index}: ${step.label}${isCompleted ? ', completed' : isActive ? ', current' : ''}`}
                disabled={isFuture}
                onClick={() => {
                  if (isCompleted) {
                    onStepClick(step.index as 1 | 2 | 3);
                  }
                }}
                className={cn(
                  'flex items-center gap-3 text-sm font-medium w-full text-left',
                  isCompleted && 'cursor-pointer hover:opacity-80',
                  isFuture && 'cursor-not-allowed opacity-50',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    isActive && 'bg-[#1E3A5F] text-white',
                    isCompleted && 'bg-green-600 text-white',
                    isFuture && 'border-2 border-gray-300 text-gray-400 bg-white',
                  )}
                  aria-hidden="true"
                >
                  {isCompleted ? '✓' : step.index}
                </span>
                <span
                  className={cn(
                    isActive && 'text-[#1E3A5F] font-semibold',
                    isCompleted && 'text-green-700',
                    isFuture && 'text-gray-400',
                  )}
                >
                  {step.index}. {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
