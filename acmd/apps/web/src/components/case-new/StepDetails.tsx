/**
 * StepDetails — Step 2 of Case New form (ACMD-136-A)
 *
 * Fields:
 *   - EmployeeCard + TypeBadge (read-only summary from Step 1)
 *   - FunctionalLimitations (textarea, required)
 *   - UrgencyRadio (Normal default / Urgent / Emergency)
 *   - PreferredAccommodation (textarea, optional)
 *   - TypeSpecificFields (conditional accordion reveal based on type)
 *
 * Validation: FunctionalLimitations required + required TypeSpecificFields filled.
 */

import { TypeSpecificFields } from './TypeSpecificFields';
import type {
  AccommodationType,
  TypeSpecificData,
} from './TypeSpecificFields';
import { validateTypeSpecificData } from './TypeSpecificFields';
import { ACCOMMODATION_TYPE_LABELS } from './TypeSpecificFields';
import type { Employee } from './EmployeeSearch';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UrgencyLevel = 'normal' | 'urgent' | 'emergency';

export interface Step2Data {
  functionalLimitations: string;
  urgency: UrgencyLevel;
  preferredAccommodation: string;
  typeSpecificData: TypeSpecificData;
}

export interface Step2Errors {
  functionalLimitations?: string;
  typeSpecific?: string[];
}

// ---------------------------------------------------------------------------
// Employee summary card (read-only)
// ---------------------------------------------------------------------------

interface EmployeeSummaryCardProps {
  employee: Employee;
  accommodationType: AccommodationType;
}

function EmployeeSummaryCard({ employee, accommodationType }: EmployeeSummaryCardProps) {
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#1E3A5F]">{employee.name}</p>
        <p className="text-xs text-gray-500">{employee.department} · #{employee.employeeNumber}</p>
      </div>
      <span
        className="inline-flex items-center rounded-full bg-[#1E3A5F]/10 px-3 py-1 text-xs font-medium text-[#1E3A5F]"
        aria-label={`Accommodation type: ${ACCOMMODATION_TYPE_LABELS[accommodationType]}`}
      >
        {ACCOMMODATION_TYPE_LABELS[accommodationType]}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UrgencyRadio
// ---------------------------------------------------------------------------

const URGENCY_OPTIONS: { value: UrgencyLevel; label: string; description: string }[] = [
  { value: 'normal', label: 'Normal', description: 'Standard processing timeline' },
  { value: 'urgent', label: 'Urgent', description: 'Expedited review needed' },
  { value: 'emergency', label: 'Emergency', description: 'Immediate safety/health concern' },
];

const urgencyColors: Record<UrgencyLevel, string> = {
  normal: 'text-gray-700',
  urgent: 'text-amber-700',
  emergency: 'text-red-700',
};

// ---------------------------------------------------------------------------
// StepDetails
// ---------------------------------------------------------------------------

interface StepDetailsProps {
  /** From Step 1 — read-only display */
  employee: Employee;
  accommodationType: AccommodationType;
  /** Step 2 editable data */
  data: Step2Data;
  errors: Step2Errors;
  onChange: (data: Step2Data) => void;
}

export function StepDetails({
  employee,
  accommodationType,
  data,
  errors,
  onChange,
}: StepDetailsProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[#1E3A5F]" id="step2-heading">
          Step 2 — Details
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Provide functional limitations and accommodation details.
        </p>
      </div>

      {/* Employee + type summary */}
      <EmployeeSummaryCard employee={employee} accommodationType={accommodationType} />

      {/* Error summary for screen readers */}
      {(errors.functionalLimitations || (errors.typeSpecific?.length ?? 0) > 0) && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          aria-label="Validation errors"
        >
          <p className="font-medium">Please fix the following errors:</p>
          <ul className="mt-1 list-disc pl-4">
            {errors.functionalLimitations && <li>{errors.functionalLimitations}</li>}
            {errors.typeSpecific?.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* Functional Limitations */}
      <div className="space-y-1">
        <label htmlFor="functional-limitations" className="block text-sm font-medium text-gray-700">
          Functional Limitations
          <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
          <span className="ml-1 text-xs font-normal text-gray-400">(shared with manager)</span>
        </label>
        <textarea
          id="functional-limitations"
          aria-required="true"
          aria-invalid={!!errors.functionalLimitations}
          aria-describedby={
            errors.functionalLimitations ? 'fl-error fl-hint' : 'fl-hint'
          }
          value={data.functionalLimitations}
          onChange={(e) => onChange({ ...data, functionalLimitations: e.target.value })}
          rows={4}
          placeholder="Describe the employee's functional limitations — what tasks are affected and how..."
          className={cn(
            'w-full resize-y rounded-md border px-3 py-2 text-sm shadow-sm transition',
            'focus:outline-none focus:ring-2 focus:ring-[#2563EB]',
            errors.functionalLimitations ? 'border-red-500 bg-red-50' : 'border-gray-300',
          )}
        />
        <p id="fl-hint" className="text-xs text-gray-500">
          Describe functional limitations, NOT the diagnosis. Example: "Cannot lift more than 20 lbs."
          This information may be shared with the manager.
        </p>
        {errors.functionalLimitations && (
          <p id="fl-error" className="text-xs text-red-600" role="alert">
            {errors.functionalLimitations}
          </p>
        )}
      </div>

      {/* Urgency Level */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">
          Urgency Level
          <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
        </p>
        <div
          role="radiogroup"
          aria-label="Urgency level"
          className="space-y-2"
        >
          {URGENCY_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition',
                data.urgency === opt.value
                  ? 'border-[#2563EB] bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300',
              )}
            >
              <input
                type="radio"
                name="urgency"
                value={opt.value}
                checked={data.urgency === opt.value}
                onChange={() => onChange({ ...data, urgency: opt.value })}
                className="mt-0.5 h-4 w-4 accent-[#2563EB]"
                aria-label={`${opt.label}: ${opt.description}`}
              />
              <div>
                <p className={cn('text-sm font-medium', urgencyColors[opt.value])}>
                  {opt.label}
                </p>
                <p className="text-xs text-gray-500">{opt.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Preferred Accommodation (optional) */}
      <div className="space-y-1">
        <label htmlFor="preferred-accommodation" className="block text-sm font-medium text-gray-700">
          Preferred Accommodation
          <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          id="preferred-accommodation"
          value={data.preferredAccommodation}
          onChange={(e) => onChange({ ...data, preferredAccommodation: e.target.value })}
          rows={3}
          placeholder="Employee's preferred solution, if any..."
          aria-describedby="pref-accom-hint"
          className={cn(
            'w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm transition',
            'focus:outline-none focus:ring-2 focus:ring-[#2563EB]',
          )}
        />
        <p id="pref-accom-hint" className="text-xs text-gray-500">
          If the employee has a specific accommodation in mind, note it here. The interactive
          process may identify additional or alternative options.
        </p>
      </div>

      {/* Type-Specific Fields (conditional) */}
      <TypeSpecificFields
        type={accommodationType}
        data={data.typeSpecificData}
        onChange={(updated) => onChange({ ...data, typeSpecificData: updated })}
        errors={errors.typeSpecific ?? []}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateStep2(data: Step2Data, accommodationType: AccommodationType): Step2Errors {
  const errors: Step2Errors = {};

  if (!data.functionalLimitations.trim()) {
    errors.functionalLimitations = 'Functional limitations are required.';
  }

  const typeErrors = validateTypeSpecificData(accommodationType, data.typeSpecificData);
  if (typeErrors.length > 0) {
    errors.typeSpecific = typeErrors;
  }

  return errors;
}
