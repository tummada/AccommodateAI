/**
 * ACMD-136-B — Vitest tests for StepDocuments + DualLawModal
 *
 * Coverage:
 *   1. StepDocuments renders — 2 upload zones + AI consent section
 *   2. File validation — rejects > 10MB, rejects unsupported format
 *   3. Role visibility — isManager=true → medical zone hidden, action buttons hidden
 *   4. AI consent 3 states — consented / pending / declined render correctly
 *   5. DualLawModal auto-detect — ADA/PWFA pre-checked from keywords, FMLA always pre-checked
 *   6. DualLawModal validation — Confirm disabled + error if ADA+PWFA both unchecked
 *   7. Modal escape/cancel — Escape key + Cancel button → onClose called, no confirm
 *   8. Dual-law badge — shown when >= 2 laws checked
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepDocuments, validateFile } from '@/components/case-new/StepDocuments';
import type { Step3Data } from '@/components/case-new/StepDocuments';
import { DualLawModal, detectLaws } from '@/components/case-new/DualLawModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep3Data(overrides: Partial<Step3Data> = {}): Step3Data {
  return {
    medicalFiles: [],
    supportingFiles: [],
    aiConsent: null,
    ...overrides,
  };
}

const mockEmployee = {
  id: 'emp-001',
  name: 'Jane Doe',
  department: 'Engineering',
  employeeId: 'EMP-001',
};

function renderStepDocuments(props: Partial<Parameters<typeof StepDocuments>[0]> = {}) {
  const defaults = {
    data: makeStep3Data(),
    employee: mockEmployee,
    accommodationType: 'physical_workspace',
    isManager: false,
    onChange: vi.fn(),
    onSendConsentForm: vi.fn(),
    onSkipAI: vi.fn(),
  };
  return render(<StepDocuments {...defaults} {...props} />);
}

function renderDualLawModal(props: Partial<Parameters<typeof DualLawModal>[0]> = {}) {
  const defaults = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    requestDescription: '',
    functionalLimitations: '',
    isSubmitting: false,
  };
  return render(<DualLawModal {...defaults} {...props} />);
}

// ---------------------------------------------------------------------------
// 1. StepDocuments renders
// ---------------------------------------------------------------------------

describe('StepDocuments — render', () => {
  it('shows heading, both upload zones, and AI consent section', () => {
    renderStepDocuments();

    expect(screen.getByTestId('step-documents')).toBeInTheDocument();
    expect(screen.getByText(/Step 3 — Documents & AI Consent/)).toBeInTheDocument();

    // Medical zone (HR user — not manager)
    expect(screen.getByTestId('upload-zone-medical')).toBeInTheDocument();

    // Supporting zone
    expect(screen.getByTestId('upload-zone-supporting')).toBeInTheDocument();

    // AI consent section
    expect(screen.getByTestId('ai-consent-section')).toBeInTheDocument();
  });

  it('shows employee name and department in summary card', () => {
    renderStepDocuments();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText(/Engineering/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. File validation unit tests
// ---------------------------------------------------------------------------

describe('validateFile — unit tests', () => {
  it('returns null for valid PDF under 10MB', () => {
    const file = Object.defineProperty(
      new File(['data'], 'report.pdf', { type: 'application/pdf' }),
      'size',
      { value: 5 * 1024 * 1024 },
    ) as File;
    expect(validateFile(file)).toBeNull();
  });

  it('returns "too_large" for file > 10MB', () => {
    const file = Object.defineProperty(
      new File(['data'], 'huge.pdf', { type: 'application/pdf' }),
      'size',
      { value: 11 * 1024 * 1024 },
    ) as File;
    expect(validateFile(file)).toBe('too_large');
  });

  it('returns "unsupported_format" for .exe file', () => {
    const file = Object.defineProperty(
      new File(['data'], 'virus.exe', { type: 'application/octet-stream' }),
      'size',
      { value: 1024 },
    ) as File;
    expect(validateFile(file)).toBe('unsupported_format');
  });

  it('accepts DOCX MIME type', () => {
    const file = Object.defineProperty(
      new File(['data'], 'letter.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      'size',
      { value: 1024 * 1024 },
    ) as File;
    expect(validateFile(file)).toBeNull();
  });

  it('accepts image/jpeg', () => {
    const file = Object.defineProperty(
      new File(['data'], 'photo.jpg', { type: 'image/jpeg' }),
      'size',
      { value: 500 * 1024 },
    ) as File;
    expect(validateFile(file)).toBeNull();
  });

  it('accepts image/png', () => {
    const file = Object.defineProperty(
      new File(['data'], 'scan.png', { type: 'image/png' }),
      'size',
      { value: 2 * 1024 * 1024 },
    ) as File;
    expect(validateFile(file)).toBeNull();
  });

  it('shows error banner when oversized file is dropped into supporting zone', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderStepDocuments({ onChange });

    const oversizedFile = Object.defineProperty(
      new File(['data'], 'toobig.pdf', { type: 'application/pdf' }),
      'size',
      { value: 15 * 1024 * 1024 },
    ) as File;

    // Use the hidden file input directly
    const input = screen.getAllByLabelText(/File input for/)[1]; // supporting zone input
    await user.upload(input, oversizedFile);

    expect(screen.getByTestId('upload-error-supporting')).toBeInTheDocument();
    expect(screen.getByText(/too large/i)).toBeInTheDocument();
  });

  it('shows error banner for unsupported format via drop event', async () => {
    renderStepDocuments();

    const badFile = Object.defineProperty(
      new File(['data'], 'virus.exe', { type: 'application/octet-stream' }),
      'size',
      { value: 1024 },
    ) as File;

    // Use drag-and-drop to bypass the <input accept> filter
    const dropZone = screen
      .getAllByRole('button')
      .find((el) => el.getAttribute('aria-label')?.includes('Supporting Documents'))!;

    fireEvent.drop(dropZone, {
      dataTransfer: { files: [badFile] },
    });

    expect(screen.getByTestId('upload-error-supporting')).toBeInTheDocument();
    expect(screen.getByText(/unsupported format/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. Role visibility — Manager
// ---------------------------------------------------------------------------

describe('StepDocuments — role visibility (isManager=true)', () => {
  it('hides medical upload zone for manager', () => {
    renderStepDocuments({ isManager: true });
    expect(screen.queryByTestId('upload-zone-medical')).not.toBeInTheDocument();
  });

  it('still shows supporting upload zone for manager', () => {
    renderStepDocuments({ isManager: true });
    expect(screen.getByTestId('upload-zone-supporting')).toBeInTheDocument();
  });

  it('hides Send Consent Form and Skip AI buttons for manager when consent is pending', () => {
    renderStepDocuments({
      isManager: true,
      data: makeStep3Data({ aiConsent: 'pending' }),
    });
    expect(screen.queryByTestId('consent-action-buttons')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-send-consent')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-skip-ai')).not.toBeInTheDocument();
  });

  it('shows action buttons for HR user when consent is pending', () => {
    renderStepDocuments({
      isManager: false,
      data: makeStep3Data({ aiConsent: 'pending' }),
    });
    expect(screen.getByTestId('btn-send-consent')).toBeInTheDocument();
    expect(screen.getByTestId('btn-skip-ai')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4. AI consent 3 states
// ---------------------------------------------------------------------------

describe('StepDocuments — AI consent states', () => {
  it('shows green badge for consented', () => {
    renderStepDocuments({ data: makeStep3Data({ aiConsent: 'consented' }) });
    expect(screen.getByTestId('consent-badge-consented')).toBeInTheDocument();
    expect(screen.getByTestId('consent-badge-consented')).toHaveTextContent('AI Analysis Enabled');
  });

  it('shows yellow badge for pending', () => {
    renderStepDocuments({ data: makeStep3Data({ aiConsent: 'pending' }) });
    expect(screen.getByTestId('consent-badge-pending')).toBeInTheDocument();
    expect(screen.getByTestId('consent-badge-pending')).toHaveTextContent('AI Consent Pending');
  });

  it('shows gray badge for declined', () => {
    renderStepDocuments({ data: makeStep3Data({ aiConsent: 'declined' }) });
    expect(screen.getByTestId('consent-badge-declined')).toBeInTheDocument();
    expect(screen.getByTestId('consent-badge-declined')).toHaveTextContent('Manual Processing');
  });

  it('hides action buttons when consent is consented', () => {
    renderStepDocuments({ data: makeStep3Data({ aiConsent: 'consented' }), isManager: false });
    expect(screen.queryByTestId('btn-send-consent')).not.toBeInTheDocument();
  });

  it('hides action buttons when consent is declined', () => {
    renderStepDocuments({ data: makeStep3Data({ aiConsent: 'declined' }), isManager: false });
    expect(screen.queryByTestId('btn-send-consent')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 5. DualLawModal — auto-detection (unit tests via detectLaws)
// ---------------------------------------------------------------------------

describe('detectLaws — keyword detection unit tests', () => {
  it('detects ADA from "disability" in description', () => {
    const result = detectLaws('employee has a disability', '');
    expect(result.ada).toBe(true);
  });

  it('detects ADA from "wheelchair" in functional limitations', () => {
    const result = detectLaws('', 'requires wheelchair access');
    expect(result.ada).toBe(true);
  });

  it('detects PWFA from "pregnancy"', () => {
    const result = detectLaws('pregnancy accommodation needed', '');
    expect(result.pwfa).toBe(true);
  });

  it('detects PWFA from "breastfeeding" in limitations', () => {
    const result = detectLaws('', 'needs space for breastfeeding');
    expect(result.pwfa).toBe(true);
  });

  it('does NOT detect ADA when no keywords present', () => {
    const result = detectLaws('needs schedule change', 'works from home');
    expect(result.ada).toBe(false);
  });

  it('does NOT detect PWFA when no keywords present', () => {
    const result = detectLaws('needs ergonomic chair', '');
    expect(result.pwfa).toBe(false);
  });

  it('always pre-checks FMLA regardless of text', () => {
    const result = detectLaws('', '');
    expect(result.fmla).toBe(true);
  });

  it('detects case-insensitively — "DISABILITY" triggers ADA', () => {
    const result = detectLaws('DISABILITY accommodation', '');
    expect(result.ada).toBe(true);
  });
});

describe('DualLawModal — renders auto-detected checkboxes', () => {
  it('pre-checks ADA when description has ADA keyword', () => {
    renderDualLawModal({ requestDescription: 'employee has a disability' });
    const adaCheckbox = screen.getByRole('checkbox', { name: /ADA/i });
    expect(adaCheckbox).toBeChecked();
  });

  it('does not pre-check PWFA when no PWFA keywords', () => {
    renderDualLawModal({ requestDescription: 'schedule change for disability' });
    const pwfaCheckbox = screen.getByRole('checkbox', { name: /PWFA/i });
    expect(pwfaCheckbox).not.toBeChecked();
  });

  it('always pre-checks FMLA', () => {
    renderDualLawModal({ requestDescription: '' });
    const fmlaCheckbox = screen.getByRole('checkbox', { name: /FMLA/i });
    expect(fmlaCheckbox).toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// 6. DualLawModal — validation
// ---------------------------------------------------------------------------

describe('DualLawModal — validation', () => {
  it('Confirm button is disabled when neither ADA nor PWFA checked', () => {
    renderDualLawModal({ requestDescription: '', functionalLimitations: '' });

    // Uncheck FMLA (ADA and PWFA are already unchecked with no keywords)
    // ADA and PWFA are not checked (no keywords) — only FMLA is checked
    // Uncheck FMLA to get 0 law state → but validation is ada+pwfa must be >= 1
    // So confirm should be disabled already since ada=false, pwfa=false
    const confirmBtn = screen.getByTestId('btn-confirm');
    expect(confirmBtn).toBeDisabled();
  });

  it('shows validation-error element when both ADA and PWFA are unchecked', () => {
    const onConfirm = vi.fn();
    renderDualLawModal({
      requestDescription: '',
      functionalLimitations: '',
      onConfirm,
    });

    // With no ADA/PWFA keywords, both are unchecked → static validation-error is visible
    expect(screen.getByTestId('validation-error')).toBeInTheDocument();
    expect(screen.getByTestId('validation-error')).toHaveTextContent(
      'At least one law (ADA or PWFA) must apply.',
    );
    // Confirm button is disabled — click should not fire onConfirm
    fireEvent.click(screen.getByTestId('btn-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('enables Confirm button when ADA is checked', () => {
    renderDualLawModal({ requestDescription: 'disability accommodation' });

    // ADA should be auto-checked → confirm enabled
    const confirmBtn = screen.getByTestId('btn-confirm');
    expect(confirmBtn).not.toBeDisabled();
  });

  it('calls onConfirm with correct law selection when confirmed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderDualLawModal({
      requestDescription: 'disability accommodation',
      onConfirm,
    });

    await user.click(screen.getByTestId('btn-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ ada: true }),
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Modal escape/cancel
// ---------------------------------------------------------------------------

describe('DualLawModal — escape / cancel', () => {
  it('calls onClose when Cancel button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    renderDualLawModal({ onClose, onConfirm });

    await user.click(screen.getByTestId('btn-cancel'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDualLawModal({ onClose });

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not render when isOpen=false', () => {
    renderDualLawModal({ isOpen: false });
    expect(screen.queryByTestId('dual-law-modal')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 8. Dual-law badge — >= 2 laws checked
// ---------------------------------------------------------------------------

describe('DualLawModal — dual-law banner', () => {
  it('shows DUAL-LAW CASE banner when ADA + FMLA are checked', () => {
    // ADA = detected from 'disability', FMLA = always true → 2 laws = banner shown
    renderDualLawModal({ requestDescription: 'disability accommodation' });
    expect(screen.getByTestId('dual-law-banner')).toBeInTheDocument();
    expect(screen.getByTestId('dual-law-banner')).toHaveTextContent('DUAL-LAW CASE');
  });

  it('shows DUAL-LAW CASE banner when ADA + PWFA + FMLA are all detected', () => {
    renderDualLawModal({
      requestDescription: 'disability and pregnancy accommodation',
    });
    expect(screen.getByTestId('dual-law-banner')).toBeInTheDocument();
  });

  it('does NOT show dual-law banner when only 1 law is checked', () => {
    // No ADA/PWFA keywords → only FMLA checked = 1 law
    renderDualLawModal({ requestDescription: '', functionalLimitations: '' });
    expect(screen.queryByTestId('dual-law-banner')).not.toBeInTheDocument();
  });

  it('shows banner when user manually checks additional law', async () => {
    const user = userEvent.setup();
    // Start with no keywords → only FMLA checked
    renderDualLawModal({ requestDescription: '', functionalLimitations: '' });
    expect(screen.queryByTestId('dual-law-banner')).not.toBeInTheDocument();

    // Check ADA manually → now 2 laws checked
    const adaCheckbox = screen.getByRole('checkbox', { name: /ADA/i });
    await user.click(adaCheckbox);

    expect(screen.getByTestId('dual-law-banner')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 9. DualLawModal — uncheck warning
// ---------------------------------------------------------------------------

describe('DualLawModal — uncheck warning', () => {
  it('shows warning when user un-checks an auto-detected law', async () => {
    const user = userEvent.setup();
    renderDualLawModal({ requestDescription: 'disability accommodation' });

    // ADA is auto-detected and checked — uncheck it
    const adaCheckbox = screen.getByRole('checkbox', { name: /ADA/i });
    await user.click(adaCheckbox);

    expect(screen.getByTestId('warn-ada')).toBeInTheDocument();
    expect(screen.getByTestId('warn-ada')).toHaveTextContent(/ADA may apply/i);
  });
});
