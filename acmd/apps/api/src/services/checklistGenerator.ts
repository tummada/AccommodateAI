/**
 * Auto Checklist Generator for AccommodateAI.
 *
 * Generates compliance checklist items based on law_type classification.
 * - ADA: 11 steps
 * - PWFA: 10 steps
 * - Multiple: merged ADA + PWFA (no duplicates)
 * - State-specific: adds extra steps for certain states
 *
 * Saves items to acmd_checklist_items table.
 */

import { db } from '@acmd/db';
import { acmdChecklistItems } from '@acmd/db';

// ---------------------------------------------------------------------------
// Checklist Step Definitions
// ---------------------------------------------------------------------------

export interface ChecklistStep {
  stepName: string;
  stepOrder: number;
  required: boolean;
}

/** ADA Interactive Process — 11 steps */
export const ADA_STEPS: ChecklistStep[] = [
  { stepName: 'Acknowledge accommodation request', stepOrder: 1, required: true },
  { stepName: 'Gather information from employee', stepOrder: 2, required: true },
  { stepName: 'Begin interactive process dialogue', stepOrder: 3, required: true },
  { stepName: 'Review medical documentation', stepOrder: 4, required: true },
  { stepName: 'Identify possible accommodations', stepOrder: 5, required: true },
  { stepName: 'Consider alternative accommodations', stepOrder: 6, required: true },
  { stepName: 'Make accommodation decision', stepOrder: 7, required: true },
  { stepName: 'Implement approved accommodation', stepOrder: 8, required: true },
  { stepName: 'Document entire interactive process', stepOrder: 9, required: true },
  { stepName: 'Schedule follow-up with employee', stepOrder: 10, required: true },
  { stepName: 'Review accommodation effectiveness', stepOrder: 11, required: true },
];

/** PWFA Accommodation Process — 10 steps (differs from ADA) */
export const PWFA_STEPS: ChecklistStep[] = [
  { stepName: 'Acknowledge accommodation request', stepOrder: 1, required: true },
  { stepName: 'Gather information from employee', stepOrder: 2, required: true },
  { stepName: 'Begin interactive process dialogue', stepOrder: 3, required: true },
  { stepName: 'Assess known limitations (no forced leave)', stepOrder: 4, required: true },
  { stepName: 'Identify possible accommodations', stepOrder: 5, required: true },
  { stepName: 'Evaluate undue hardship (PWFA standard)', stepOrder: 6, required: true },
  { stepName: 'Make accommodation decision', stepOrder: 7, required: true },
  { stepName: 'Implement approved accommodation', stepOrder: 8, required: true },
  { stepName: 'Document entire interactive process', stepOrder: 9, required: true },
  { stepName: 'Review accommodation effectiveness', stepOrder: 10, required: true },
];

/** State-specific additional steps */
export const STATE_EXTRA_STEPS: Record<string, ChecklistStep[]> = {
  CA: [
    { stepName: 'CA-FEHA: Notify employee of rights under California FEHA', stepOrder: 90, required: true },
    { stepName: 'CA-FEHA: Document good faith interactive process per FEHA', stepOrder: 91, required: true },
  ],
  NY: [
    { stepName: 'NY: Conduct cooperative dialogue per NYC Human Rights Law', stepOrder: 90, required: true },
    { stepName: 'NY: Provide written final determination', stepOrder: 91, required: true },
  ],
  IL: [
    { stepName: 'IL: Comply with Illinois Human Rights Act requirements', stepOrder: 90, required: true },
  ],
  NJ: [
    { stepName: 'NJ: Follow NJ LAD interactive process requirements', stepOrder: 90, required: true },
  ],
};

// ---------------------------------------------------------------------------
// Merge Logic
// ---------------------------------------------------------------------------

/**
 * Merge ADA + PWFA steps, removing duplicates by stepName.
 * When both have a step with same name, prefer ADA's step.
 * Then add unique PWFA steps.
 */
function mergeSteps(adaSteps: ChecklistStep[], pwfaSteps: ChecklistStep[]): ChecklistStep[] {
  const seen = new Set<string>();
  const merged: ChecklistStep[] = [];

  // Add all ADA steps first
  for (const step of adaSteps) {
    seen.add(step.stepName);
    merged.push(step);
  }

  // Add unique PWFA steps
  let nextOrder = adaSteps.length + 1;
  for (const step of pwfaSteps) {
    if (!seen.has(step.stepName)) {
      seen.add(step.stepName);
      merged.push({ ...step, stepOrder: nextOrder });
      nextOrder++;
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate checklist steps for a given law type and optional state.
 * Returns the steps array (does NOT save to DB — use saveChecklist for that).
 */
export function generateChecklistSteps(
  lawType: 'ada' | 'pwfa' | 'state_law' | 'multiple' | null,
  state?: string | null,
): ChecklistStep[] {
  let steps: ChecklistStep[];

  switch (lawType) {
    case 'pwfa':
      steps = [...PWFA_STEPS];
      break;
    case 'multiple':
      steps = mergeSteps(ADA_STEPS, PWFA_STEPS);
      break;
    case 'ada':
    case 'state_law':
    case null:
    default:
      // Default to ADA steps (also used as fallback)
      steps = [...ADA_STEPS];
      break;
  }

  // Add state-specific steps if applicable
  if (state) {
    const stateUpper = state.toUpperCase();
    const extraSteps = STATE_EXTRA_STEPS[stateUpper];
    if (extraSteps) {
      let nextOrder = steps.length + 1;
      for (const extra of extraSteps) {
        steps.push({ ...extra, stepOrder: nextOrder });
        nextOrder++;
      }
    }
  }

  return steps;
}

/**
 * Save checklist items to the database for a given case.
 *
 * @param caseId - The case UUID
 * @param steps - Checklist steps to save
 * @returns The inserted checklist items
 */
export async function saveChecklist(
  caseId: string,
  steps: ChecklistStep[],
): Promise<void> {
  if (steps.length === 0) return;

  const items = steps.map((step) => ({
    caseId,
    stepName: step.stepName,
    stepOrder: step.stepOrder,
    required: step.required,
  }));

  await db.insert(acmdChecklistItems).values(items);
}

// ---------------------------------------------------------------------------
// Deadline Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate deadline based on law type and state.
 * Returns a Date that is N business days (Mon-Fri) from now.
 *
 * Rules:
 * - ADA: 14 business days
 * - PWFA: 7 business days
 * - State-specific: CA-FEHA 30 days, NY 5 days
 * - Multiple: shortest applicable deadline
 * - Default (fallback): 14 business days (ADA)
 */
export function calculateDeadline(
  lawType: 'ada' | 'pwfa' | 'state_law' | 'multiple' | null,
  state?: string | null,
  fromDate?: Date,
): Date {
  const start = fromDate ?? new Date();

  // Determine business days based on law type
  let businessDays: number;

  switch (lawType) {
    case 'pwfa':
      businessDays = 7;
      break;
    case 'state_law':
      businessDays = getStateDeadlineDays(state) ?? 14;
      break;
    case 'multiple': {
      // Use shortest applicable deadline
      const adaDays = 14;
      const pwfaDays = 7;
      const stateDays = getStateDeadlineDays(state);
      businessDays = Math.min(adaDays, pwfaDays, stateDays ?? Infinity);
      break;
    }
    case 'ada':
    case null:
    default:
      businessDays = 14;
      break;
  }

  return addBusinessDays(start, businessDays);
}

/**
 * Get state-specific deadline in business days.
 */
function getStateDeadlineDays(state?: string | null): number | null {
  if (!state) return null;
  const stateUpper = state.toUpperCase();

  const stateDeadlines: Record<string, number> = {
    CA: 30,
    NY: 5,
  };

  return stateDeadlines[stateUpper] ?? null;
}

/**
 * Add N business days (Mon-Fri) to a start date.
 * Skips Saturdays and Sundays.
 */
export function addBusinessDays(start: Date, days: number): Date {
  const result = new Date(start);
  let added = 0;

  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dayOfWeek = result.getDay();
    // Skip Saturday (6) and Sunday (0)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      added++;
    }
  }

  return result;
}
