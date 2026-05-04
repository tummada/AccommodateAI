/**
 * StepDocuments — Step 3 of Case New form (ACMD-136-B)
 *
 * Sections:
 *   - Employee/Type summary card (read-only)
 *   - Medical Documentation upload zone (hidden for Manager role)
 *   - Supporting Documents upload zone
 *   - AI Consent check (3 states: consented / pending / declined)
 *
 * File upload rules:
 *   - Max 10MB per file
 *   - Accepted: PDF, DOC, DOCX, JPG, PNG
 *   - Local state only — server upload after case creation (ACMD-136-C)
 *   - Error messages shown inline per zone
 *
 * Role visibility:
 *   - Medical upload zone: hidden for Manager
 *   - AI consent action buttons (Send Consent Form, Skip AI): hidden for Manager
 *   - Manager sees consent status read-only
 */

import { useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ACCOMMODATION_TYPE_LABELS } from './TypeSpecificFields';

// ---------------------------------------------------------------------------
// Types (exported for CaseNewPage integration in ACMD-136-B2)
// ---------------------------------------------------------------------------

export interface DocumentFile {
  id: string;           // uuid v4 (generated client-side via crypto.randomUUID)
  name: string;
  size: number;
  type: string;         // MIME type
  file: File;           // raw File object
  category: 'medical' | 'supporting';
}

export interface Step3Data {
  medicalFiles: DocumentFile[];
  supportingFiles: DocumentFile[];
  aiConsent: 'consented' | 'pending' | 'declined' | null;  // null = not yet determined
}

export interface Step3Props {
  data: Step3Data;
  employee: { id: string; name: string; department: string; employeeId: string } | null;
  accommodationType: string | null;
  isManager: boolean;
  onChange: (data: Step3Data) => void;
  onSendConsentForm?: () => void;    // HR/Admin only
  onSkipAI?: () => void;             // HR/Admin only
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

const ACCEPTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
]);

const ACCEPTED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];

// ---------------------------------------------------------------------------
// File validation
// ---------------------------------------------------------------------------

export type FileValidationError = 'too_large' | 'unsupported_format';

/**
 * Client-side file validation (size + MIME type from browser).
 * NOTE: MIME type is derived from file extension by the browser and can be
 * spoofed. Server-side magic-byte validation MUST be performed in ACMD-136-C
 * before storing uploaded files. See: HIGH-SEC-01 in ACMD-136-B audit.
 */
export function validateFile(file: File): FileValidationError | null {
  if (file.size > MAX_FILE_SIZE_BYTES) return 'too_large';
  if (!ACCEPTED_MIME_TYPES.has(file.type)) return 'unsupported_format';
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// UploadZone
// ---------------------------------------------------------------------------

interface UploadZoneProps {
  category: 'medical' | 'supporting';
  files: DocumentFile[];
  label: string;
  hint?: string;
  onFilesAdded: (files: DocumentFile[]) => void;
  onFileRemoved: (id: string) => void;
  'data-testid'?: string;
}

function UploadZone({
  category,
  files,
  label,
  hint,
  onFilesAdded,
  onFileRemoved,
  'data-testid': testId,
}: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [zoneErrors, setZoneErrors] = useState<string[]>([]);

  const processFiles = useCallback(
    (rawFiles: FileList | File[]) => {
      const newErrors: string[] = [];
      const accepted: DocumentFile[] = [];

      Array.from(rawFiles).forEach((file) => {
        const err = validateFile(file);
        if (err === 'too_large') {
          newErrors.push(`"${file.name}" is too large (max 10MB per file).`);
        } else if (err === 'unsupported_format') {
          newErrors.push(
            `"${file.name}" is an unsupported format. Accepted: PDF, DOC, DOCX, JPG, PNG.`,
          );
        } else {
          accepted.push({
            id: crypto.randomUUID(),
            name: file.name,
            size: file.size,
            type: file.type,
            file,
            category,
          });
        }
      });

      setZoneErrors(newErrors);
      if (accepted.length > 0) {
        onFilesAdded(accepted);
      }
    },
    [category, onFilesAdded],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      processFiles(e.dataTransfer.files);
    },
    [processFiles],
  );

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      // Reset input so same file can be re-added if previously removed
      e.target.value = '';
    }
  };

  const inputId = `file-input-${category}`;
  const zoneId = `upload-zone-${category}`;

  return (
    <div className="space-y-2" data-testid={testId}>
      <p className="text-sm font-medium text-gray-700">{label}</p>

      {/* Drop zone */}
      <div
        id={zoneId}
        role="button"
        tabIndex={0}
        aria-label={`Upload ${label}. Drag files here or press Enter to browse.`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition',
          'focus:outline-none focus:ring-2 focus:ring-[#2563EB]',
          isDragOver
            ? 'border-[#2563EB] bg-blue-50'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100',
        )}
      >
        <svg
          className="mb-2 h-8 w-8 text-gray-400"
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
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <p className="text-sm text-gray-600">
          Drag files here or{' '}
          <span className="font-medium text-[#2563EB]">Browse Files</span>
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Accepted: PDF, DOC, DOCX, JPG, PNG (max 10MB each)
        </p>
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(',')}
        className="sr-only"
        aria-label={`File input for ${label}`}
        onChange={handleInputChange}
      />

      {/* Hint for medical zone */}
      {hint && (
        <p className="flex items-start gap-1.5 text-xs text-gray-500">
          <svg
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
            />
          </svg>
          {hint}
        </p>
      )}

      {/* Inline errors */}
      {zoneErrors.length > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700"
          data-testid={`upload-error-${category}`}
        >
          <ul className="list-disc pl-4 space-y-0.5">
            {zoneErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <ul className="space-y-1.5" aria-label={`Uploaded ${label}`}>
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
              data-testid={`file-item-${f.id}`}
            >
              <svg
                className="h-4 w-4 shrink-0 text-gray-400"
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
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
              <span className="min-w-0 flex-1 truncate text-gray-700">{f.name}</span>
              <span className="shrink-0 text-xs text-gray-400">{formatBytes(f.size)}</span>
              <button
                type="button"
                onClick={() => onFileRemoved(f.id)}
                aria-label={`Remove ${f.name}`}
                className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                <svg
                  className="h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AIConsentSection
// ---------------------------------------------------------------------------

type ConsentState = 'consented' | 'pending' | 'declined' | null;

interface AIConsentSectionProps {
  consent: ConsentState;
  isManager: boolean;
  onSendConsentForm?: () => void;
  onSkipAI?: () => void;
}

function AIConsentSection({
  consent,
  isManager,
  onSendConsentForm,
  onSkipAI,
}: AIConsentSectionProps) {
  const statusBadge = (): React.ReactNode => {
    if (consent === 'consented') {
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800"
          data-testid="consent-badge-consented"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
          AI Analysis Enabled
        </span>
      );
    }
    if (consent === 'pending') {
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-800"
          data-testid="consent-badge-pending"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" aria-hidden="true" />
          AI Consent Pending
        </span>
      );
    }
    if (consent === 'declined') {
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
          data-testid="consent-badge-declined"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" aria-hidden="true" />
          Manual Processing
        </span>
      );
    }
    // null — not yet determined
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500"
        data-testid="consent-badge-null"
      >
        Not determined
      </span>
    );
  };

  const statusDescription = (): string => {
    if (consent === 'consented') return 'Employee consented. AI-assisted analysis is enabled.';
    if (consent === 'pending') return 'Waiting for employee consent to use AI analysis.';
    if (consent === 'declined') return 'Case will be processed manually without AI assistance.';
    return 'Employee consent status has not been determined yet.';
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3" data-testid="ai-consent-section">
      {/* Header */}
      <div className="flex items-center gap-2">
        <svg
          className="h-5 w-5 text-[#2563EB]"
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
            d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
          />
        </svg>
        <h3 className="text-sm font-semibold text-[#1E3A5F]">AI-Assisted Analysis</h3>
      </div>

      {/* Status badge + description */}
      <div className="flex flex-wrap items-center gap-3">
        {statusBadge()}
        <p className="text-xs text-gray-600">{statusDescription()}</p>
      </div>

      {/* Action buttons — HR/Admin only (hidden for Manager) */}
      {!isManager && (consent === 'pending' || consent === null) && (
        <div className="flex flex-wrap gap-2 pt-1" data-testid="consent-action-buttons">
          <button
            type="button"
            onClick={onSendConsentForm}
            className={cn(
              'rounded-md bg-[#2563EB] px-4 py-2 text-xs font-medium text-white transition',
              'hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:ring-offset-1',
            )}
            data-testid="btn-send-consent"
          >
            Send Consent Form
          </button>
          <button
            type="button"
            onClick={onSkipAI}
            className={cn(
              'rounded-md border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition',
              'hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1',
            )}
            data-testid="btn-skip-ai"
          >
            Skip AI — Continue Manually
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Employee summary card (reused from StepDetails pattern)
// ---------------------------------------------------------------------------

interface EmployeeSummaryCardProps {
  employee: { id: string; name: string; department: string; employeeId: string };
  accommodationType: string | null;
}

function EmployeeSummaryCard({ employee, accommodationType }: EmployeeSummaryCardProps) {
  const typeLabel =
    accommodationType &&
    ACCOMMODATION_TYPE_LABELS[accommodationType as keyof typeof ACCOMMODATION_TYPE_LABELS]
      ? ACCOMMODATION_TYPE_LABELS[accommodationType as keyof typeof ACCOMMODATION_TYPE_LABELS]
      : accommodationType ?? '';

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#1E3A5F]">{employee.name}</p>
        <p className="text-xs text-gray-500">
          {employee.department} · #{employee.employeeId}
        </p>
      </div>
      {typeLabel && (
        <span
          className="inline-flex items-center rounded-full bg-[#1E3A5F]/10 px-3 py-1 text-xs font-medium text-[#1E3A5F]"
          aria-label={`Accommodation type: ${typeLabel}`}
        >
          {typeLabel}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepDocuments
// ---------------------------------------------------------------------------

export function StepDocuments({
  data,
  employee,
  accommodationType,
  isManager,
  onChange,
  onSendConsentForm,
  onSkipAI,
}: Step3Props) {
  const handleMedicalFilesAdded = useCallback(
    (newFiles: DocumentFile[]) => {
      onChange({ ...data, medicalFiles: [...data.medicalFiles, ...newFiles] });
    },
    [data, onChange],
  );

  const handleMedicalFileRemoved = useCallback(
    (id: string) => {
      onChange({ ...data, medicalFiles: data.medicalFiles.filter((f) => f.id !== id) });
    },
    [data, onChange],
  );

  const handleSupportingFilesAdded = useCallback(
    (newFiles: DocumentFile[]) => {
      onChange({ ...data, supportingFiles: [...data.supportingFiles, ...newFiles] });
    },
    [data, onChange],
  );

  const handleSupportingFileRemoved = useCallback(
    (id: string) => {
      onChange({ ...data, supportingFiles: data.supportingFiles.filter((f) => f.id !== id) });
    },
    [data, onChange],
  );

  return (
    <div className="space-y-6" data-testid="step-documents">
      {/* Heading */}
      <div>
        <h2 className="text-lg font-semibold text-[#1E3A5F]" id="step3-heading">
          Step 3 — Documents & AI Consent
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Upload supporting documents and review AI consent status.
        </p>
      </div>

      {/* Employee summary card */}
      {employee && (
        <EmployeeSummaryCard employee={employee} accommodationType={accommodationType} />
      )}

      {/* Medical Documentation — hidden for Manager */}
      {!isManager && (
        <UploadZone
          category="medical"
          files={data.medicalFiles}
          label="Medical Documentation (optional at intake)"
          hint="Medical docs can be uploaded later. PWFA may not require documentation."
          onFilesAdded={handleMedicalFilesAdded}
          onFileRemoved={handleMedicalFileRemoved}
          data-testid="upload-zone-medical"
        />
      )}

      {/* Supporting Documents */}
      <UploadZone
        category="supporting"
        files={data.supportingFiles}
        label="Supporting Documents (optional)"
        onFilesAdded={handleSupportingFilesAdded}
        onFileRemoved={handleSupportingFileRemoved}
        data-testid="upload-zone-supporting"
      />

      {/* AI Consent */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          AI Consent Check
        </h3>
        <AIConsentSection
          consent={data.aiConsent}
          isManager={isManager}
          onSendConsentForm={onSendConsentForm}
          onSkipAI={onSkipAI}
        />
      </div>
    </div>
  );
}
