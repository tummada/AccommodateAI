/**
 * StepBasicInfo — Step 1 of Case New form (ACMD-136-A)
 *
 * Fields:
 *   - EmployeeSearch (combobox, debounced 300ms)
 *   - AccommodationTypeDropdown (disabled until employee selected)
 *   - RequestDescription (textarea, min 20 chars, disabled until type selected)
 *
 * Role: Manager role is handled at the parent level (server filters employees)
 * Validation errors displayed inline with red borders.
 */

import { useRef } from 'react';
import { EmployeeSearch } from './EmployeeSearch';
import type { Employee } from './EmployeeSearch';
import type { AccommodationType } from './TypeSpecificFields';
import { ACCOMMODATION_TYPE_LABELS } from './TypeSpecificFields';
import { cn } from '@/lib/utils';
import type { AuthenticatedClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Step1Data {
  employee: Employee | null;
  accommodationType: AccommodationType | null;
  requestDescription: string;
}

export interface Step1Errors {
  employee?: string;
  accommodationType?: string;
  requestDescription?: string;
}

interface StepBasicInfoProps {
  client: AuthenticatedClient;
  data: Step1Data;
  errors: Step1Errors;
  onChange: (data: Step1Data) => void;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function InfoTooltip({ text }: { text: string }) {
  const tooltipRef = useRef<HTMLSpanElement>(null);
  return (
    <span className="group relative ml-1 inline-flex cursor-help">
      <span
        className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-xs text-gray-600 hover:bg-gray-300"
        aria-label={`Info: ${text}`}
        tabIndex={0}
        role="note"
      >
        i
      </span>
      <span
        ref={tooltipRef}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute bottom-full left-0 z-50 mb-1 w-64 rounded-md',
          'border border-gray-200 bg-white p-2 text-xs leading-relaxed text-gray-700 shadow-lg',
          'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
        )}
      >
        {text}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// StepBasicInfo
// ---------------------------------------------------------------------------

const ACCOMMODATION_TYPES = Object.entries(ACCOMMODATION_TYPE_LABELS) as [AccommodationType, string][];

const CHAR_MIN = 20;

export function StepBasicInfo({ client, data, errors, onChange }: StepBasicInfoProps) {
  const charCount = data.requestDescription.length;
  const typeEnabled = data.employee !== null;
  const descEnabled = typeEnabled && data.accommodationType !== null;

  const handleEmployeeSelect = (employee: Employee) => {
    onChange({ ...data, employee });
  };

  const handleEmployeeClear = () => {
    onChange({ ...data, employee: null, accommodationType: null, requestDescription: '' });
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as AccommodationType | '';
    onChange({
      ...data,
      accommodationType: val || null,
      // Reset description placeholder when type changes — keep existing text
    });
  };

  const handleDescChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ ...data, requestDescription: e.target.value });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[#1E3A5F]" id="step1-heading">
          Step 1 — Basic Information
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Select the employee and describe the accommodation request.
        </p>
      </div>

      {/* Error summary for screen readers */}
      {(errors.employee || errors.accommodationType || errors.requestDescription) && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          aria-label="Validation errors"
        >
          <p className="font-medium">Please fix the following errors:</p>
          <ul className="mt-1 list-disc pl-4">
            {errors.employee && <li>{errors.employee}</li>}
            {errors.accommodationType && <li>{errors.accommodationType}</li>}
            {errors.requestDescription && <li>{errors.requestDescription}</li>}
          </ul>
        </div>
      )}

      {/* Employee field */}
      <div className="space-y-1">
        <label
          htmlFor="employee-search-input"
          className="block text-sm font-medium text-gray-700"
        >
          Employee
          <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
        </label>
        <EmployeeSearch
          client={client}
          selectedEmployee={data.employee}
          onSelect={handleEmployeeSelect}
          onClear={handleEmployeeClear}
          error={errors.employee}
        />
      </div>

      {/* Accommodation Type */}
      <div className="space-y-1">
        <label
          htmlFor="accommodation-type"
          className="block text-sm font-medium text-gray-700"
        >
          Accommodation Type
          <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
        </label>
        <select
          id="accommodation-type"
          aria-required="true"
          aria-invalid={!!errors.accommodationType}
          aria-describedby={errors.accommodationType ? 'accom-type-error' : undefined}
          disabled={!typeEnabled}
          value={data.accommodationType ?? ''}
          onChange={handleTypeChange}
          className={cn(
            'w-full rounded-md border px-3 py-2 text-sm shadow-sm bg-white transition',
            'focus:outline-none focus:ring-2 focus:ring-[#2563EB]',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-gray-50',
            errors.accommodationType ? 'border-red-500 bg-red-50' : 'border-gray-300',
          )}
        >
          <option value="">Select type...</option>
          {ACCOMMODATION_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {errors.accommodationType && (
          <p id="accom-type-error" className="text-xs text-red-600" role="alert">
            {errors.accommodationType}
          </p>
        )}
        {!typeEnabled && (
          <p className="text-xs text-gray-400">Select an employee first</p>
        )}
      </div>

      {/* Request Description */}
      <div className="space-y-1">
        <label
          htmlFor="request-description"
          className="block text-sm font-medium text-gray-700"
        >
          Request Description
          <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
          <InfoTooltip text="Describe the workplace adjustment needed, not the medical condition. Example: 'Needs a standing desk' instead of a medical diagnosis." />
        </label>
        <textarea
          id="request-description"
          aria-required="true"
          aria-invalid={!!errors.requestDescription}
          aria-describedby={cn(
            errors.requestDescription ? 'desc-error' : '',
            'desc-counter',
          ).trim() || undefined}
          disabled={!descEnabled}
          value={data.requestDescription}
          onChange={handleDescChange}
          rows={4}
          placeholder={
            descEnabled
              ? `Describe the accommodation being requested for ${data.accommodationType ? ACCOMMODATION_TYPE_LABELS[data.accommodationType] : 'this type'}...`
              : 'Select employee and type first'
          }
          className={cn(
            'w-full resize-y rounded-md border px-3 py-2 text-sm shadow-sm transition',
            'focus:outline-none focus:ring-2 focus:ring-[#2563EB]',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-gray-50',
            errors.requestDescription ? 'border-red-500 bg-red-50' : 'border-gray-300',
          )}
        />
        {/* Character counter */}
        <div className="flex items-center justify-between">
          <span id="desc-counter" className="text-xs text-gray-500" aria-live="polite">
            {charCount}/{CHAR_MIN} minimum
          </span>
          {charCount > 0 && charCount < CHAR_MIN && (
            <span className="text-xs text-amber-600">
              {CHAR_MIN - charCount} more character{CHAR_MIN - charCount !== 1 ? 's' : ''} needed
            </span>
          )}
        </div>
        {errors.requestDescription && (
          <p id="desc-error" className="text-xs text-red-600" role="alert">
            {errors.requestDescription}
          </p>
        )}
        {!descEnabled && (
          <p className="text-xs text-gray-400">Select employee and accommodation type first</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateStep1(data: Step1Data): Step1Errors {
  const errors: Step1Errors = {};
  if (!data.employee) {
    errors.employee = 'Please select an employee.';
  }
  if (!data.accommodationType) {
    errors.accommodationType = 'Please select an accommodation type.';
  }
  if (data.requestDescription.trim().length < CHAR_MIN) {
    errors.requestDescription = `Description must be at least ${CHAR_MIN} characters.`;
  }
  return errors;
}
