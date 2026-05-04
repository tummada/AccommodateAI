/**
 * CaseNewPage — Phase 6C (ACMD-136-B2)
 *
 * Multi-step intake form for creating a new accommodation case.
 * This page owns all form state and orchestrates the 3-step flow.
 *
 * Steps:
 *   1. Basic Info (EmployeeSearch + AccommodationType + RequestDescription)
 *   2. Details (FunctionalLimitations + Urgency + PreferredAccommodation + TypeSpecificFields)
 *   3. Documents (StepDocuments + DualLawModal + createCase API call)
 *
 * Route: /cases/new (wired in App.tsx — ACMD-136-B2)
 *
 * Role-based behavior:
 *   - Manager: bypass DualLawModal, submit directly with ada=true
 *   - Super Admin / HR: DualLawModal gate before save
 *
 * State architecture: CaseNewFormState holds all step data.
 * Data persists across step navigation (Back/Forward).
 *
 * Navigation:
 *   - Cancel: shows confirm dialog, then navigate(-1)
 *   - Back (Step 2+): go to previous step, preserve all data
 *   - Next: validate current step, advance if valid
 *   - Step 3 Save Case: open DualLawModal (HR/Admin) or submit directly (Manager)
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { CaseStepper } from '@/components/case-new/CaseStepper';
import { StepBasicInfo, validateStep1 } from '@/components/case-new/StepBasicInfo';
import type { Step1Data, Step1Errors } from '@/components/case-new/StepBasicInfo';
import { StepDetails, validateStep2 } from '@/components/case-new/StepDetails';
import type { Step2Data, Step2Errors } from '@/components/case-new/StepDetails';
import type { AccommodationType, TypeSpecificData } from '@/components/case-new/TypeSpecificFields';
import { defaultTypeSpecificData } from '@/components/case-new/TypeSpecificFields';
import { StepDocuments } from '@/components/case-new/StepDocuments';
import type { Step3Data } from '@/components/case-new/StepDocuments';
import { DualLawModal } from '@/components/case-new/DualLawModal';
import type { LawSelection } from '@/components/case-new/DualLawModal';
import { createCase } from '@/lib/api/cases';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Full form state
// ---------------------------------------------------------------------------

export interface CaseNewFormState {
  step: 1 | 2 | 3;
  // Step 1 data
  employee: Step1Data['employee'];
  accommodationType: AccommodationType | null;
  requestDescription: string;
  // Step 2 data
  functionalLimitations: string;
  urgency: Step2Data['urgency'];
  preferredAccommodation: string;
  typeSpecificData: TypeSpecificData | null;
}

const INITIAL_STATE: CaseNewFormState = {
  step: 1,
  employee: null,
  accommodationType: null,
  requestDescription: '',
  functionalLimitations: '',
  urgency: 'normal',
  preferredAccommodation: '',
  typeSpecificData: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the CaseType from law selection checkboxes.
 * ada+pwfa → 'multiple', ada only → 'ada', pwfa only → 'pwfa',
 * fmla only → 'state_law' (validation prevents all-false)
 */
export function computeCaseType(laws: LawSelection): 'ada' | 'pwfa' | 'state_law' | 'multiple' {
  if (laws.ada && laws.pwfa) return 'multiple';
  if (laws.ada) return 'ada';
  if (laws.pwfa) return 'pwfa';
  return 'state_law'; // fmla-only edge case
}

/**
 * Build medicalInfo JSON string from functional limitations + type-specific data.
 * Returns null if both are empty/null.
 */
export function buildMedicalInfo(state: CaseNewFormState): string | null {
  if (!state.functionalLimitations && !state.typeSpecificData) return null;
  return JSON.stringify({
    functionalLimitations: state.functionalLimitations || null,
    typeSpecificData: state.typeSpecificData,
  });
}

// ---------------------------------------------------------------------------
// CaseNewPage
// ---------------------------------------------------------------------------

export function CaseNewPage() {
  const navigate = useNavigate();
  const { user, client } = useAuth();
  const isManager = user?.role === 'manager';

  const [formState, setFormState] = useState<CaseNewFormState>(INITIAL_STATE);
  const [step1Errors, setStep1Errors] = useState<Step1Errors>({});
  const [step2Errors, setStep2Errors] = useState<Step2Errors>({});
  const [step3Data, setStep3Data] = useState<Step3Data>({
    medicalFiles: [],
    supportingFiles: [],
    aiConsent: 'pending',
  });
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Step 1 data binding
  // ---------------------------------------------------------------------------

  const step1Data: Step1Data = {
    employee: formState.employee,
    accommodationType: formState.accommodationType,
    requestDescription: formState.requestDescription,
  };

  const handleStep1Change = useCallback((data: Step1Data) => {
    setFormState((prev) => {
      // If accommodation type changed, reset typeSpecificData
      const typeChanged = data.accommodationType !== prev.accommodationType;
      return {
        ...prev,
        employee: data.employee,
        accommodationType: data.accommodationType,
        requestDescription: data.requestDescription,
        typeSpecificData: typeChanged && data.accommodationType
          ? defaultTypeSpecificData(data.accommodationType)
          : prev.typeSpecificData,
      };
    });
    // Clear errors for the field that changed
    setStep1Errors({});
  }, []);

  // ---------------------------------------------------------------------------
  // Step 2 data binding
  // ---------------------------------------------------------------------------

  const step2Data: Step2Data = {
    functionalLimitations: formState.functionalLimitations,
    urgency: formState.urgency,
    preferredAccommodation: formState.preferredAccommodation,
    typeSpecificData: formState.typeSpecificData ??
      (formState.accommodationType ? defaultTypeSpecificData(formState.accommodationType) : { detailedDescription: '' }),
  };

  const handleStep2Change = useCallback((data: Step2Data) => {
    setFormState((prev) => ({
      ...prev,
      functionalLimitations: data.functionalLimitations,
      urgency: data.urgency,
      preferredAccommodation: data.preferredAccommodation,
      typeSpecificData: data.typeSpecificData,
    }));
    setStep2Errors({});
  }, []);

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const handleStepperClick = useCallback((step: 1 | 2 | 3) => {
    // Only allow clicking on completed (previous) steps
    if (step < formState.step) {
      setFormState((prev) => ({ ...prev, step }));
    }
  }, [formState.step]);

  const handleBack = useCallback(() => {
    if (formState.step > 1) {
      setFormState((prev) => ({ ...prev, step: (prev.step - 1) as 1 | 2 | 3 }));
    }
  }, [formState.step]);

  // ---------------------------------------------------------------------------
  // API save
  // ---------------------------------------------------------------------------

  const handleSaveCase = useCallback(async (laws: LawSelection) => {
    if (!formState.employee) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const type = computeCaseType(laws);
      await createCase(client, {
        employeeId: formState.employee.id,
        requestDescription: formState.requestDescription,
        type,
        medicalInfo: buildMedicalInfo(formState),
      });
      setShowModal(false);
      navigate('/cases');
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Failed to create case. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [client, formState, navigate]);

  const handleNext = useCallback(async () => {
    if (formState.step === 1) {
      const errors = validateStep1(step1Data);
      if (Object.keys(errors).length > 0) {
        setStep1Errors(errors);
        return;
      }
      // Ensure typeSpecificData is initialized for the selected type
      const type = formState.accommodationType!;
      setFormState((prev) => ({
        ...prev,
        step: 2,
        typeSpecificData: prev.typeSpecificData ?? defaultTypeSpecificData(type),
      }));
      return;
    }

    if (formState.step === 2) {
      const type = formState.accommodationType!;
      const errors = validateStep2(step2Data, type);
      if (Object.keys(errors).length > 0) {
        setStep2Errors(errors);
        return;
      }
      setFormState((prev) => ({ ...prev, step: 3 }));
      return;
    }

    // Step 3 — Manager submits directly; HR/Admin opens DualLawModal
    if (isManager) {
      await handleSaveCase({ ada: true, pwfa: false, fmla: false });
      return;
    }
    setShowModal(true);
  }, [formState.step, formState.accommodationType, step1Data, step2Data, isManager, handleSaveCase]);

  const handleCancel = useCallback(() => {
    const hasData =
      formState.employee !== null ||
      formState.requestDescription.length > 0 ||
      formState.functionalLimitations.length > 0;

    if (hasData) {
      const confirmed = window.confirm('Discard changes? Your progress will be lost.');
      if (!confirmed) return;
    }
    navigate(-1);
  }, [navigate, formState]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const stepLabel = `Step ${formState.step} of 3: ${
    formState.step === 1 ? 'Basic Info' : formState.step === 2 ? 'Details' : 'Documents'
  }`;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F]">New Accommodation Case</h1>
          <p className="mt-0.5 text-sm text-gray-500" aria-live="polite">
            {stepLabel}
          </p>
        </div>
        {/* Manager note — no Add New Employee in this task */}
        {isManager && (
          <span className="rounded-full bg-[#1E3A5F]/10 px-3 py-1 text-xs text-[#1E3A5F]">
            Manager View
          </span>
        )}
      </div>

      {/* Stepper */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <CaseStepper
          currentStep={formState.step}
          onStepClick={handleStepperClick}
        />
      </div>

      {/* Form area */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {formState.step === 1 && (
          <StepBasicInfo
            client={client}
            data={step1Data}
            errors={step1Errors}
            onChange={handleStep1Change}
          />
        )}

        {formState.step === 2 && formState.employee && formState.accommodationType && (
          <StepDetails
            employee={formState.employee}
            accommodationType={formState.accommodationType}
            data={step2Data}
            errors={step2Errors}
            onChange={handleStep2Change}
          />
        )}

        {formState.step === 3 && (
          <StepDocuments
            data={step3Data}
            employee={
              formState.employee
                ? {
                    id: formState.employee.id,
                    name: formState.employee.name,
                    department: formState.employee.department,
                    employeeId: formState.employee.employeeNumber,
                  }
                : null
            }
            accommodationType={formState.accommodationType}
            isManager={isManager}
            onChange={setStep3Data}
            onSendConsentForm={() => {
              // TODO: ACMD-136-C — actual consent form email
              setStep3Data((prev) => ({ ...prev, aiConsent: 'pending' }));
            }}
            onSkipAI={() => {
              setStep3Data((prev) => ({ ...prev, aiConsent: 'declined' }));
            }}
          />
        )}
      </div>

      {/* Submit error banner — shown above footer when API call fails */}
      {submitError && (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
          data-testid="submit-error-banner"
        >
          {submitError}
        </div>
      )}

      {/* Footer navigation bar */}
      <div className="flex flex-col-reverse items-stretch gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        {/* Left: Cancel */}
        <Button
          type="button"
          variant="ghost"
          onClick={handleCancel}
          aria-label="Cancel and discard changes"
        >
          Cancel
        </Button>

        {/* Right: Back + Next */}
        <div className="flex gap-3">
          {formState.step > 1 && (
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              aria-label={`Go back to Step ${formState.step - 1}`}
            >
              ← Back
            </Button>
          )}
          <Button
            type="button"
            onClick={handleNext}
            disabled={isSubmitting}
            style={{ backgroundColor: '#1E3A5F' }}
            className="text-white hover:opacity-90"
            aria-label={
              formState.step < 3
                ? `Next: proceed to Step ${formState.step + 1}`
                : 'Save case'
            }
          >
            {formState.step < 3 ? 'Next →' : 'Save Case'}
          </Button>
        </div>
      </div>

      {/* DualLawModal — HR/Admin only; Manager bypasses */}
      <DualLawModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleSaveCase}
        requestDescription={formState.requestDescription}
        functionalLimitations={formState.functionalLimitations}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
