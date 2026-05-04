/**
 * TypeSpecificFields — Phase 6C (ACMD-136-A)
 *
 * Conditional fieldset revealed (animated accordion) based on accommodation type.
 * 6 types:
 *   - physical_workspace: Workspace Requirements* + Location Preferences dropdown
 *   - schedule_modification: Requested Schedule* + Duration radio (Temp/Permanent)
 *   - equipment: Equipment Description* + Estimated Cost ($)
 *   - policy_exception: Policy Exception Details* + Affected Policies (multi-select)
 *   - leave: Leave Type* dropdown + Duration* (date range)
 *   - other: Detailed Description* (text)
 *
 * Fields marked * = required.
 * Respects prefers-reduced-motion for animation.
 */

import { cn } from '@/lib/utils';

export type AccommodationType =
  | 'physical_workspace'
  | 'schedule_modification'
  | 'equipment'
  | 'policy_exception'
  | 'leave'
  | 'other';

export const ACCOMMODATION_TYPE_LABELS: Record<AccommodationType, string> = {
  physical_workspace: 'Physical Workspace',
  schedule_modification: 'Schedule Modification',
  equipment: 'Equipment / Assistive Technology',
  policy_exception: 'Policy Exception',
  leave: 'Leave',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// Per-type data shapes
// ---------------------------------------------------------------------------

export interface PhysicalWorkspaceData {
  workspaceRequirements: string;
  locationPreference: string;
}

export interface ScheduleModificationData {
  requestedSchedule: string;
  duration: 'temporary' | 'permanent' | '';
}

export interface EquipmentData {
  equipmentDescription: string;
  estimatedCost: string;
}

export interface PolicyExceptionData {
  policyExceptionDetails: string;
  affectedPolicies: string[];
}

export interface LeaveData {
  leaveType: 'intermittent' | 'continuous' | 'reduced' | '';
  startDate: string;
  endDate: string;
}

export interface OtherData {
  detailedDescription: string;
}

export type TypeSpecificData =
  | PhysicalWorkspaceData
  | ScheduleModificationData
  | EquipmentData
  | PolicyExceptionData
  | LeaveData
  | OtherData;

// Default empty values for each type
export function defaultTypeSpecificData(type: AccommodationType): TypeSpecificData {
  switch (type) {
    case 'physical_workspace':
      return { workspaceRequirements: '', locationPreference: '' };
    case 'schedule_modification':
      return { requestedSchedule: '', duration: '' };
    case 'equipment':
      return { equipmentDescription: '', estimatedCost: '' };
    case 'policy_exception':
      return { policyExceptionDetails: '', affectedPolicies: [] };
    case 'leave':
      return { leaveType: '', startDate: '', endDate: '' };
    case 'other':
      return { detailedDescription: '' };
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateTypeSpecificData(
  type: AccommodationType,
  data: TypeSpecificData,
): string[] {
  const errors: string[] = [];
  switch (type) {
    case 'physical_workspace': {
      const d = data as PhysicalWorkspaceData;
      if (!d.workspaceRequirements.trim()) errors.push('Workspace Requirements is required.');
      break;
    }
    case 'schedule_modification': {
      const d = data as ScheduleModificationData;
      if (!d.requestedSchedule.trim()) errors.push('Requested Schedule is required.');
      break;
    }
    case 'equipment': {
      const d = data as EquipmentData;
      if (!d.equipmentDescription.trim()) errors.push('Equipment Description is required.');
      break;
    }
    case 'policy_exception': {
      const d = data as PolicyExceptionData;
      if (!d.policyExceptionDetails.trim()) errors.push('Policy Exception Details is required.');
      break;
    }
    case 'leave': {
      const d = data as LeaveData;
      if (!d.leaveType) errors.push('Leave Type is required.');
      if (!d.startDate) errors.push('Leave start date is required.');
      if (!d.endDate) errors.push('Leave end date is required.');
      if (d.startDate && d.endDate && new Date(d.endDate) < new Date(d.startDate)) {
        errors.push('End date must be on or after start date');
      }
      break;
    }
    case 'other': {
      const d = data as OtherData;
      if (!d.detailedDescription.trim()) errors.push('Detailed Description is required.');
      break;
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Shared field components
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  helpText?: string;
}

function Field({ label, htmlFor, required, error, children, helpText }: FieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
      </label>
      {children}
      {helpText && <p className="text-xs text-gray-500">{helpText}</p>}
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass = cn(
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm',
  'focus:outline-none focus:ring-2 focus:ring-[#2563EB]',
);

const selectClass = cn(
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm bg-white',
  'focus:outline-none focus:ring-2 focus:ring-[#2563EB]',
);

const errorInputClass = 'border-red-500 bg-red-50';

// ---------------------------------------------------------------------------
// Per-type field sets
// ---------------------------------------------------------------------------

interface PhysicalWorkspaceFieldsProps {
  data: PhysicalWorkspaceData;
  onChange: (data: PhysicalWorkspaceData) => void;
  errors: string[];
}

function PhysicalWorkspaceFields({ data, onChange, errors }: PhysicalWorkspaceFieldsProps) {
  const reqError = errors.find((e) => e.includes('Workspace'));
  return (
    <div className="space-y-4">
      <Field label="Workspace Requirements" htmlFor="physical-workspace-req" required error={reqError}>
        <input
          id="physical-workspace-req"
          type="text"
          aria-required="true"
          aria-invalid={!!reqError}
          value={data.workspaceRequirements}
          onChange={(e) => onChange({ ...data, workspaceRequirements: e.target.value })}
          placeholder="e.g. Standing desk, ergonomic chair..."
          className={cn(inputClass, reqError && errorInputClass)}
        />
      </Field>
      <Field label="Location Preferences" htmlFor="physical-location-pref">
        <select
          id="physical-location-pref"
          value={data.locationPreference}
          onChange={(e) => onChange({ ...data, locationPreference: e.target.value })}
          className={selectClass}
        >
          <option value="">-- Select preference --</option>
          <option value="current">Current location</option>
          <option value="different_floor">Different floor</option>
          <option value="private_office">Private office</option>
          <option value="open_area">Open area</option>
          <option value="remote">Remote / Work from home</option>
        </select>
      </Field>
    </div>
  );
}

interface ScheduleModificationFieldsProps {
  data: ScheduleModificationData;
  onChange: (data: ScheduleModificationData) => void;
  errors: string[];
}

function ScheduleModificationFields({ data, onChange, errors }: ScheduleModificationFieldsProps) {
  const schedError = errors.find((e) => e.includes('Schedule'));
  return (
    <div className="space-y-4">
      <Field label="Requested Schedule" htmlFor="schedule-start-time" required error={schedError}>
        <input
          id="schedule-start-time"
          type="text"
          aria-required="true"
          aria-invalid={!!schedError}
          value={data.requestedSchedule}
          onChange={(e) => onChange({ ...data, requestedSchedule: e.target.value })}
          placeholder="e.g. 7am–3pm, 4 days/week, remote Fridays..."
          className={cn(inputClass, schedError && errorInputClass)}
        />
      </Field>
      <Field label="Duration" htmlFor="schedule-duration">
        <div className="flex gap-6" role="radiogroup" aria-label="Schedule duration">
          {(['temporary', 'permanent'] as const).map((val) => (
            <label key={val} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                id={val === 'temporary' ? 'schedule-duration' : `schedule-duration-${val}`}
                type="radio"
                name="schedule-duration"
                value={val}
                checked={data.duration === val}
                onChange={() => onChange({ ...data, duration: val })}
                className="h-4 w-4 accent-[#2563EB]"
              />
              <span className="capitalize">{val}</span>
            </label>
          ))}
        </div>
      </Field>
    </div>
  );
}

interface EquipmentFieldsProps {
  data: EquipmentData;
  onChange: (data: EquipmentData) => void;
  errors: string[];
}

function EquipmentFields({ data, onChange, errors }: EquipmentFieldsProps) {
  const descError = errors.find((e) => e.includes('Equipment'));
  return (
    <div className="space-y-4">
      <Field label="Equipment Description" htmlFor="equipment-desc" required error={descError}>
        <input
          id="equipment-desc"
          type="text"
          aria-required="true"
          aria-invalid={!!descError}
          value={data.equipmentDescription}
          onChange={(e) => onChange({ ...data, equipmentDescription: e.target.value })}
          placeholder="e.g. Screen magnifier, ergonomic keyboard, wheelchair ramp..."
          className={cn(inputClass, descError && errorInputClass)}
        />
      </Field>
      <Field label="Estimated Cost" htmlFor="equipment-cost" helpText="Optional — provide if known">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
          <input
            id="equipment-cost"
            type="number"
            min="0"
            step="0.01"
            value={data.estimatedCost}
            onChange={(e) => onChange({ ...data, estimatedCost: e.target.value })}
            placeholder="0.00"
            className={cn(inputClass, 'pl-7')}
          />
        </div>
      </Field>
    </div>
  );
}

interface PolicyExceptionFieldsProps {
  data: PolicyExceptionData;
  onChange: (data: PolicyExceptionData) => void;
  errors: string[];
}

const POLICY_OPTIONS = [
  'Attendance Policy',
  'Dress Code',
  'Remote Work Policy',
  'Leave Policy',
  'Safety Policy',
  'Break Schedule',
  'Performance Standards',
];

function PolicyExceptionFields({ data, onChange, errors }: PolicyExceptionFieldsProps) {
  const detailError = errors.find((e) => e.includes('Policy Exception'));
  return (
    <div className="space-y-4">
      <Field label="Policy Exception Details" htmlFor="policy-exception-details" required error={detailError}>
        <input
          id="policy-exception-details"
          type="text"
          aria-required="true"
          aria-invalid={!!detailError}
          value={data.policyExceptionDetails}
          onChange={(e) => onChange({ ...data, policyExceptionDetails: e.target.value })}
          placeholder="Describe the policy exception needed..."
          className={cn(inputClass, detailError && errorInputClass)}
        />
      </Field>
      <Field label="Affected Policies" helpText="Select all that apply">
        <div className="space-y-1.5" role="group" aria-label="Affected policies">
          {POLICY_OPTIONS.map((policy) => (
            <label key={policy} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={data.affectedPolicies.includes(policy)}
                onChange={(e) => {
                  const updated = e.target.checked
                    ? [...data.affectedPolicies, policy]
                    : data.affectedPolicies.filter((p) => p !== policy);
                  onChange({ ...data, affectedPolicies: updated });
                }}
                className="h-4 w-4 accent-[#2563EB]"
              />
              <span>{policy}</span>
            </label>
          ))}
        </div>
      </Field>
    </div>
  );
}

interface LeaveFieldsProps {
  data: LeaveData;
  onChange: (data: LeaveData) => void;
  errors: string[];
}

function LeaveFields({ data, onChange, errors }: LeaveFieldsProps) {
  const typeError = errors.find((e) => e.includes('Leave Type'));
  const startError = errors.find((e) => e.includes('start'));
  const endError = errors.find((e) => e.includes('end') || e.includes('End date'));
  return (
    <div className="space-y-4">
      <Field label="Leave Type" htmlFor="leave-type" required error={typeError}>
        <select
          id="leave-type"
          aria-required="true"
          aria-invalid={!!typeError}
          value={data.leaveType}
          onChange={(e) =>
            onChange({ ...data, leaveType: e.target.value as LeaveData['leaveType'] })
          }
          className={cn(selectClass, typeError && errorInputClass)}
        >
          <option value="">-- Select leave type --</option>
          <option value="intermittent">Intermittent</option>
          <option value="continuous">Continuous</option>
          <option value="reduced">Reduced Schedule</option>
        </select>
      </Field>
      <Field label="Duration" required>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex-1">
            <label htmlFor="leave-start" className="mb-1 block text-xs text-gray-500">Start Date</label>
            <input
              id="leave-start"
              type="date"
              aria-required="true"
              aria-invalid={!!startError}
              value={data.startDate}
              onChange={(e) => onChange({ ...data, startDate: e.target.value })}
              className={cn(inputClass, startError && errorInputClass)}
            />
            {startError && (
              <p className="mt-0.5 text-xs text-red-600" role="alert">{startError}</p>
            )}
          </div>
          <span className="mt-4 hidden text-gray-400 sm:block">—</span>
          <div className="flex-1">
            <label htmlFor="leave-end" className="mb-1 block text-xs text-gray-500">End Date</label>
            <input
              id="leave-end"
              type="date"
              aria-required="true"
              aria-invalid={!!endError}
              value={data.endDate}
              onChange={(e) => onChange({ ...data, endDate: e.target.value })}
              className={cn(inputClass, endError && errorInputClass)}
            />
            {endError && (
              <p className="mt-0.5 text-xs text-red-600" role="alert">{endError}</p>
            )}
          </div>
        </div>
      </Field>
    </div>
  );
}

interface OtherFieldsProps {
  data: OtherData;
  onChange: (data: OtherData) => void;
  errors: string[];
}

function OtherFields({ data, onChange, errors }: OtherFieldsProps) {
  const descError = errors.find((e) => e.includes('Detailed'));
  return (
    <div className="space-y-4">
      <Field label="Detailed Description" htmlFor="other-desc" required error={descError}>
        <textarea
          id="other-desc"
          aria-required="true"
          aria-invalid={!!descError}
          value={data.detailedDescription}
          onChange={(e) => onChange({ ...data, detailedDescription: e.target.value })}
          rows={4}
          placeholder="Describe the specific accommodation needed..."
          className={cn(inputClass, 'resize-y', descError && errorInputClass)}
        />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main TypeSpecificFields
// ---------------------------------------------------------------------------

interface TypeSpecificFieldsProps {
  type: AccommodationType;
  data: TypeSpecificData;
  onChange: (data: TypeSpecificData) => void;
  errors: string[];
}

export function TypeSpecificFields({ type, data, onChange, errors }: TypeSpecificFieldsProps) {
  const label = ACCOMMODATION_TYPE_LABELS[type];

  return (
    <section
      data-testid={`type-specific-${type}`}
      aria-label={`${label} specific fields`}
      className={cn(
        'rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4',
        'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200',
      )}
    >
      <h3 className="text-sm font-semibold text-[#1E3A5F]">
        {label} — Additional Details
      </h3>

      {type === 'physical_workspace' && (
        <PhysicalWorkspaceFields
          data={data as PhysicalWorkspaceData}
          onChange={onChange}
          errors={errors}
        />
      )}
      {type === 'schedule_modification' && (
        <ScheduleModificationFields
          data={data as ScheduleModificationData}
          onChange={onChange}
          errors={errors}
        />
      )}
      {type === 'equipment' && (
        <EquipmentFields
          data={data as EquipmentData}
          onChange={onChange}
          errors={errors}
        />
      )}
      {type === 'policy_exception' && (
        <PolicyExceptionFields
          data={data as PolicyExceptionData}
          onChange={onChange}
          errors={errors}
        />
      )}
      {type === 'leave' && (
        <LeaveFields
          data={data as LeaveData}
          onChange={onChange}
          errors={errors}
        />
      )}
      {type === 'other' && (
        <OtherFields
          data={data as OtherData}
          onChange={onChange}
          errors={errors}
        />
      )}
    </section>
  );
}
