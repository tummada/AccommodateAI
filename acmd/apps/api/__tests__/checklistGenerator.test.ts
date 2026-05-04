/**
 * Unit tests for Checklist Generator + Deadline Calculator.
 *
 * Covers:
 *   - ADA checklist: 11 steps
 *   - PWFA checklist: 10 steps
 *   - Multiple: merged (no duplicates)
 *   - State-specific extras (CA, NY)
 *   - Deadline calculation: business days (Mon-Fri)
 *   - addBusinessDays: skips weekends
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('dotenv/config', () => ({}));

// Mock DB for saveChecklist
const mockInsertValues = vi.fn().mockReturnValue(Promise.resolve());
vi.mock('@acmd/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: mockInsertValues,
    })),
  },
  acmdChecklistItems: { id: 'id', caseId: 'case_id' },
}));

import {
  generateChecklistSteps,
  calculateDeadline,
  addBusinessDays,
  saveChecklist,
  ADA_STEPS,
  PWFA_STEPS,
  STATE_EXTRA_STEPS,
} from '../src/services/checklistGenerator.js';

// ---------------------------------------------------------------------------
// generateChecklistSteps
// ---------------------------------------------------------------------------

describe('generateChecklistSteps', () => {
  it('should generate 11 steps for ADA', () => {
    const steps = generateChecklistSteps('ada');
    expect(steps).toHaveLength(11);
    expect(steps[0]!.stepName).toBe('Acknowledge accommodation request');
    expect(steps[10]!.stepName).toBe('Review accommodation effectiveness');
  });

  it('should generate 10 steps for PWFA', () => {
    const steps = generateChecklistSteps('pwfa');
    expect(steps).toHaveLength(10);
    expect(steps[3]!.stepName).toContain('no forced leave');
    expect(steps[5]!.stepName).toContain('undue hardship');
  });

  it('should merge ADA + PWFA for "multiple" without duplicates', () => {
    const steps = generateChecklistSteps('multiple');
    // ADA has 11, PWFA has 10, shared steps: Acknowledge, Gather info, Begin interactive,
    // Identify possible, Make decision, Implement, Document, Review effectiveness = 8 shared
    // So merged = 11 + (10-8) = 13
    const stepNames = steps.map((s) => s.stepName);
    const uniqueNames = new Set(stepNames);
    expect(uniqueNames.size).toBe(stepNames.length); // No duplicates
    expect(steps.length).toBeGreaterThan(11); // More than just ADA
  });

  it('should default to ADA steps for null law_type', () => {
    const steps = generateChecklistSteps(null);
    expect(steps).toHaveLength(11);
  });

  it('should default to ADA steps for state_law type', () => {
    const steps = generateChecklistSteps('state_law');
    expect(steps).toHaveLength(11);
  });

  it('should add CA state-specific steps', () => {
    const steps = generateChecklistSteps('ada', 'CA');
    expect(steps.length).toBe(11 + STATE_EXTRA_STEPS['CA']!.length);
    const caStep = steps.find((s) => s.stepName.includes('CA-FEHA'));
    expect(caStep).toBeDefined();
  });

  it('should add NY state-specific steps', () => {
    const steps = generateChecklistSteps('ada', 'NY');
    expect(steps.length).toBe(11 + STATE_EXTRA_STEPS['NY']!.length);
    const nyStep = steps.find((s) => s.stepName.includes('cooperative dialogue'));
    expect(nyStep).toBeDefined();
  });

  it('should handle case-insensitive state codes', () => {
    const steps = generateChecklistSteps('ada', 'ca');
    const caStep = steps.find((s) => s.stepName.includes('CA-FEHA'));
    expect(caStep).toBeDefined();
  });

  it('should not add extra steps for states without specific rules', () => {
    const steps = generateChecklistSteps('ada', 'TX');
    expect(steps).toHaveLength(11);
  });

  it('should handle PWFA + CA state combo', () => {
    const steps = generateChecklistSteps('pwfa', 'CA');
    expect(steps.length).toBe(10 + STATE_EXTRA_STEPS['CA']!.length);
  });

  it('should handle multiple + NY state combo', () => {
    const baseSteps = generateChecklistSteps('multiple');
    const stepsWithNY = generateChecklistSteps('multiple', 'NY');
    expect(stepsWithNY.length).toBe(baseSteps.length + STATE_EXTRA_STEPS['NY']!.length);
  });

  it('should have sequential step orders', () => {
    const steps = generateChecklistSteps('ada');
    for (let i = 0; i < steps.length; i++) {
      expect(steps[i]!.stepOrder).toBe(i + 1);
    }
  });

  it('should mark all steps as required by default', () => {
    const steps = generateChecklistSteps('ada');
    for (const step of steps) {
      expect(step.required).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// saveChecklist
// ---------------------------------------------------------------------------

describe('saveChecklist', () => {
  it('should save steps to database', async () => {
    const steps = generateChecklistSteps('ada');
    await saveChecklist('case-uuid', steps);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          caseId: 'case-uuid',
          stepName: 'Acknowledge accommodation request',
          stepOrder: 1,
          required: true,
        }),
      ]),
    );
  });

  it('should not call DB if steps array is empty', async () => {
    mockInsertValues.mockClear();
    await saveChecklist('case-uuid', []);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addBusinessDays
// ---------------------------------------------------------------------------

describe('addBusinessDays', () => {
  it('should add 1 business day (Mon → Tue)', () => {
    const monday = new Date(2026, 3, 6); // Mon Apr 6 2026
    const result = addBusinessDays(monday, 1);
    expect(result.getDay()).toBe(2); // Tuesday
    expect(result.getDate()).toBe(7);
  });

  it('should skip weekends (Fri + 1 → Mon)', () => {
    const friday = new Date(2026, 3, 10); // Fri Apr 10 2026
    const result = addBusinessDays(friday, 1);
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(13);
  });

  it('should add 5 business days (Mon → Mon)', () => {
    const monday = new Date(2026, 3, 6); // Mon Apr 6
    const result = addBusinessDays(monday, 5);
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(13);
  });

  it('should add 14 business days correctly', () => {
    const monday = new Date(2026, 3, 6); // Mon Apr 6
    const result = addBusinessDays(monday, 14);
    // 14 business days = 2 weeks + 4 weekend days = 18 calendar days
    // Apr 6 + 18 = Apr 24 (Friday)
    expect(result.getDay()).toBe(5); // Friday
    expect(result.getDate()).toBe(24);
  });

  it('should handle starting on Saturday', () => {
    const saturday = new Date(2026, 3, 11); // Sat Apr 11
    const result = addBusinessDays(saturday, 1);
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(13);
  });

  it('should handle starting on Sunday', () => {
    const sunday = new Date(2026, 3, 12); // Sun Apr 12
    const result = addBusinessDays(sunday, 1);
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(13);
  });

  it('should handle 0 business days (return same weekday)', () => {
    const monday = new Date(2026, 3, 6);
    const result = addBusinessDays(monday, 0);
    expect(result.getDate()).toBe(6); // Same day
  });
});

// ---------------------------------------------------------------------------
// calculateDeadline
// ---------------------------------------------------------------------------

describe('calculateDeadline', () => {
  const baseDate = new Date(2026, 3, 6); // Mon Apr 6 2026

  it('should return 14 business days for ADA', () => {
    const deadline = calculateDeadline('ada', null, baseDate);
    const expected = addBusinessDays(baseDate, 14);
    expect(deadline.getTime()).toBe(expected.getTime());
  });

  it('should return 7 business days for PWFA', () => {
    const deadline = calculateDeadline('pwfa', null, baseDate);
    const expected = addBusinessDays(baseDate, 7);
    expect(deadline.getTime()).toBe(expected.getTime());
  });

  it('should return 30 business days for CA state_law', () => {
    const deadline = calculateDeadline('state_law', 'CA', baseDate);
    const expected = addBusinessDays(baseDate, 30);
    expect(deadline.getTime()).toBe(expected.getTime());
  });

  it('should return 5 business days for NY state_law', () => {
    const deadline = calculateDeadline('state_law', 'NY', baseDate);
    const expected = addBusinessDays(baseDate, 5);
    expect(deadline.getTime()).toBe(expected.getTime());
  });

  it('should return 14 business days for state_law without specific state', () => {
    const deadline = calculateDeadline('state_law', 'TX', baseDate);
    const expected = addBusinessDays(baseDate, 14);
    expect(deadline.getTime()).toBe(expected.getTime());
  });

  it('should use shortest deadline for "multiple" (NY = 5 days)', () => {
    const deadline = calculateDeadline('multiple', 'NY', baseDate);
    const expected = addBusinessDays(baseDate, 5);
    expect(deadline.getTime()).toBe(expected.getTime());
  });

  it('should use shortest deadline for "multiple" without state (PWFA 7)', () => {
    const deadline = calculateDeadline('multiple', null, baseDate);
    const expected = addBusinessDays(baseDate, 7);
    expect(deadline.getTime()).toBe(expected.getTime());
  });

  it('should default to 14 business days for null law_type', () => {
    const deadline = calculateDeadline(null, null, baseDate);
    const expected = addBusinessDays(baseDate, 14);
    expect(deadline.getTime()).toBe(expected.getTime());
  });

  it('should use current date when fromDate not provided', () => {
    const deadline = calculateDeadline('ada');
    expect(deadline.getTime()).toBeGreaterThan(Date.now());
  });
});
