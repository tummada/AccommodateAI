/**
 * ACMD-136-B2 — Integration tests for CaseNewPage Step 3 + DualLawModal + createCase API
 *
 * Coverage:
 *   1. Route /cases/new renders CaseNewPage (smoke test)
 *   2. Step 3 renders StepDocuments (no placeholder)
 *   3. DualLawModal opens when clicking "Save Case" (HR role)
 *   4. createCase called with correct payload on Confirm
 *   5. computeCaseType — all 4 branches
 *   6. buildMedicalInfo — returns JSON string with expected fields
 *   7. navigate('/cases') after successful save
 *   8. Submit error banner shown when API fails (modal stays open)
 *   9. Manager flow — no DualLawModal, submit directly → navigate('/cases')
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/auth-context';
import { CaseNewPage } from '@/pages/CaseNewPage';
import { computeCaseType, buildMedicalInfo } from '@/pages/CaseNewPage';
import type { CaseNewFormState } from '@/pages/CaseNewPage';
import { server } from './server';
import { makeFakeAccessToken } from './handlers';

// RS-013: split — data on acmd-api (port 3000), auth on vollos-core (port 3002).
const API = 'http://localhost:3000';
const AUTH = 'http://localhost:3002';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

afterEach(() => {
  mockNavigate.mockClear();
  server.resetHandlers();
});

/** Render CaseNewPage with all providers; bootstraps auth with given role */
function renderCaseNewPage(role: 'hr' | 'super_admin' | 'manager' = 'hr') {
  const qc = makeQueryClient();
  const token = makeFakeAccessToken({ role });

  server.use(
    http.post(`${AUTH}/auth/refresh`, () =>
      HttpResponse.json({ accessToken: token }, { status: 200 }),
    ),
    http.get(`${API}/api/v1/auth/me`, () =>
      HttpResponse.json(
        {
          onboarding_required: false,
          profile: {
            id: 'user-test',
            email: `${role}@example.com`,
            name: role === 'manager' ? 'Manager User' : 'HR User',
            role,
            companyId: 'company-test',
          },
        },
        { status: 200 },
      ),
    ),
    http.get(`${API}/api/v1/employees`, () =>
      HttpResponse.json({ employees: [] }, { status: 200 }),
    ),
  );

  return render(
    <MemoryRouter initialEntries={['/cases/new']}>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <CaseNewPage />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Navigate to Step 3 by filling Step 1 + Step 2 minimal data */
async function advanceToStep3(user: ReturnType<typeof userEvent.setup>) {
  // Wait for auth bootstrap
  await waitFor(() =>
    expect(screen.getByText('New Accommodation Case')).toBeInTheDocument(),
  );

  // Override employee search to return a known employee
  server.use(
    http.get(`${API}/api/v1/employees`, () =>
      HttpResponse.json(
        {
          employees: [
            {
              id: 'emp-001',
              name: 'Jane Doe',
              department: 'Engineering',
              employeeNumber: 'EMP-001',
              hireDate: null,
              email: 'jane@example.com',
            },
          ],
        },
        { status: 200 },
      ),
    ),
  );

  // Type in the employee search input (EmployeeSearch combobox)
  const empInput = screen.getByRole('combobox', { name: /Search employee/i });
  await user.type(empInput, 'Jane');

  // Wait for employee dropdown result and select it
  await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
  await user.click(screen.getByText('Jane Doe'));

  // Select accommodation type — use 'other' (simplest: only needs detailedDescription)
  const typeSelect = screen.getByLabelText(/Accommodation Type/i);
  await user.selectOptions(typeSelect, 'other');

  // Fill request description (min 20 chars)
  const descField = screen.getByLabelText(/Request Description/i);
  await user.type(descField, 'Employee needs accommodation for medical disability');

  // Next → Step 2
  await user.click(screen.getByRole('button', { name: /Next: proceed to Step 2/i }));

  // Step 2: wait for details step
  await waitFor(() =>
    expect(screen.getByText(/Step 2 — Details/)).toBeInTheDocument(),
  );

  // Fill functional limitations (required)
  const limField = screen.getByLabelText(/Functional Limitations/i);
  await user.type(limField, 'Limited mobility due to chronic pain condition');

  // Fill type-specific field: 'other' type requires 'Detailed Description'
  const detailField = screen.getByLabelText(/Detailed Description/i);
  await user.type(detailField, 'Standing desk and ergonomic chair required');

  // Next → Step 3
  await user.click(screen.getByRole('button', { name: /Next: proceed to Step 3/i }));

  await waitFor(() =>
    expect(screen.getByTestId('step-documents')).toBeInTheDocument(),
  );
}

// ---------------------------------------------------------------------------
// 1. Smoke — page renders
// ---------------------------------------------------------------------------

describe('CaseNewPage — basic render', () => {
  it('renders the page heading and step 1 on mount', async () => {
    renderCaseNewPage('hr');
    await waitFor(() =>
      expect(screen.getByText('New Accommodation Case')).toBeInTheDocument(),
    );
    expect(screen.getByText(/Step 1 — Basic Information/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. Step 3 renders StepDocuments (no placeholder)
// ---------------------------------------------------------------------------

describe('Step 3 — StepDocuments renders', () => {
  it('shows step-documents, not the old placeholder', async () => {
    const user = userEvent.setup();
    renderCaseNewPage('hr');
    await advanceToStep3(user);

    // StepDocuments present
    expect(screen.getByTestId('step-documents')).toBeInTheDocument();
    expect(screen.getByText(/Step 3 — Documents & AI Consent/)).toBeInTheDocument();

    // Old placeholder must NOT be present
    expect(screen.queryByTestId('step3-placeholder')).not.toBeInTheDocument();
    expect(screen.queryByText(/Step 3 coming soon/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. DualLawModal opens on "Save Case" (HR role)
// ---------------------------------------------------------------------------

describe('DualLawModal — opens on Save Case', () => {
  it('opens modal when clicking Save Case as HR', async () => {
    const user = userEvent.setup();
    renderCaseNewPage('hr');
    await advanceToStep3(user);

    const saveBtn = screen.getByRole('button', { name: /Save Case/i });
    await user.click(saveBtn);

    await waitFor(() =>
      expect(screen.getByTestId('dual-law-modal')).toBeInTheDocument(),
    );
    expect(screen.getByText('DUAL-LAW EVALUATION')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4. createCase called with correct payload on Confirm
// ---------------------------------------------------------------------------

describe('createCase — payload on Confirm', () => {
  it('POSTs to /api/v1/cases with employeeId, requestDescription, type', async () => {
    const user = userEvent.setup();
    let capturedBody: unknown = null;

    server.use(
      http.post(`${API}/api/v1/cases`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          {
            id: 'case-uuid-001',
            caseId: 'CASE-2026-001',
            status: 'intake',
            type: 'ada',
            employeeId: 'emp-001',
            createdAt: new Date().toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    renderCaseNewPage('hr');
    await advanceToStep3(user);

    // Click Save Case → modal opens
    await user.click(screen.getByRole('button', { name: /Save Case/i }));
    await waitFor(() =>
      expect(screen.getByTestId('dual-law-modal')).toBeInTheDocument(),
    );

    // Click Confirm & Save
    await user.click(screen.getByTestId('btn-confirm'));

    await waitFor(() => {
      expect(capturedBody).not.toBeNull();
    });

    const body = capturedBody as Record<string, unknown>;
    expect(body).toHaveProperty('employeeId', 'emp-001');
    expect(body).toHaveProperty('requestDescription');
    expect(['ada', 'pwfa', 'state_law', 'multiple']).toContain(body.type);
  });
});

// ---------------------------------------------------------------------------
// 5. computeCaseType — unit tests (all 4 branches)
// ---------------------------------------------------------------------------

describe('computeCaseType — unit', () => {
  it('ada+pwfa → multiple', () => {
    expect(computeCaseType({ ada: true, pwfa: true, fmla: false })).toBe('multiple');
  });
  it('ada only → ada', () => {
    expect(computeCaseType({ ada: true, pwfa: false, fmla: false })).toBe('ada');
  });
  it('pwfa only → pwfa', () => {
    expect(computeCaseType({ ada: false, pwfa: true, fmla: false })).toBe('pwfa');
  });
  it('fmla only → state_law', () => {
    expect(computeCaseType({ ada: false, pwfa: false, fmla: true })).toBe('state_law');
  });
});

// ---------------------------------------------------------------------------
// 6. buildMedicalInfo — unit tests
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<CaseNewFormState> = {}): CaseNewFormState {
  return {
    step: 3,
    employee: {
      id: 'emp-001',
      name: 'Jane',
      department: 'Eng',
      employeeNumber: 'EMP-001',
      hireDate: null,
      email: 'jane@example.com',
    },
    accommodationType: 'physical_workspace',
    requestDescription: 'test',
    functionalLimitations: '',
    urgency: 'normal',
    preferredAccommodation: '',
    typeSpecificData: null,
    ...overrides,
  };
}

describe('buildMedicalInfo — unit', () => {
  it('returns null when both functionalLimitations and typeSpecificData are empty/null', () => {
    const state = makeState({ functionalLimitations: '', typeSpecificData: null });
    expect(buildMedicalInfo(state)).toBeNull();
  });

  it('returns JSON string with functionalLimitations when provided', () => {
    const state = makeState({ functionalLimitations: 'limited mobility', typeSpecificData: null });
    const result = buildMedicalInfo(state);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed).toHaveProperty('functionalLimitations', 'limited mobility');
    // M-01 fix: preferredAccommodation must NOT appear in medicalInfo (it is a preference, not PHI)
    expect(parsed).not.toHaveProperty('preferredAccommodation');
  });

  it('includes typeSpecificData in output', () => {
    const typeSpecificData = { detailedDescription: 'standing desk needed' };
    const state = makeState({
      functionalLimitations: 'pain',
      typeSpecificData: typeSpecificData as never,
    });
    const result = buildMedicalInfo(state);
    const parsed = JSON.parse(result!);
    expect(parsed).toHaveProperty('typeSpecificData');
    expect(parsed.typeSpecificData).toMatchObject({ detailedDescription: 'standing desk needed' });
  });
});

// ---------------------------------------------------------------------------
// 7. Navigate to /cases after successful save
// ---------------------------------------------------------------------------

describe('navigate after save', () => {
  it('calls navigate("/cases") on successful case creation', async () => {
    const user = userEvent.setup();

    server.use(
      http.post(`${API}/api/v1/cases`, () =>
        HttpResponse.json(
          {
            id: 'case-uuid-002',
            caseId: 'CASE-2026-002',
            status: 'intake',
            type: 'ada',
            employeeId: 'emp-001',
            createdAt: new Date().toISOString(),
          },
          { status: 201 },
        ),
      ),
    );

    renderCaseNewPage('hr');
    await advanceToStep3(user);

    await user.click(screen.getByRole('button', { name: /Save Case/i }));
    await waitFor(() =>
      expect(screen.getByTestId('dual-law-modal')).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId('btn-confirm'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/cases');
    });
  });
});

// ---------------------------------------------------------------------------
// 8. Submit error banner shown when API fails
// ---------------------------------------------------------------------------

describe('submit error banner', () => {
  it('shows error banner when POST /cases returns 500; modal stays open', async () => {
    const user = userEvent.setup();

    server.use(
      http.post(`${API}/api/v1/cases`, () =>
        HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: 'Server error occurred' },
          { status: 500 },
        ),
      ),
    );

    renderCaseNewPage('hr');
    await advanceToStep3(user);

    await user.click(screen.getByRole('button', { name: /Save Case/i }));
    await waitFor(() =>
      expect(screen.getByTestId('dual-law-modal')).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId('btn-confirm'));

    // Error banner appears
    await waitFor(() =>
      expect(screen.getByTestId('submit-error-banner')).toBeInTheDocument(),
    );

    // Modal stays open after failure
    expect(screen.getByTestId('dual-law-modal')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 9. Manager flow — no DualLawModal, submit directly → navigate('/cases')
// ---------------------------------------------------------------------------

describe('Manager flow', () => {
  it('submits directly without opening DualLawModal and navigates to /cases', async () => {
    const user = userEvent.setup();
    let capturedBody: unknown = null;

    server.use(
      http.post(`${API}/api/v1/cases`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          {
            id: 'case-uuid-003',
            caseId: 'CASE-2026-003',
            status: 'intake',
            type: 'ada',
            employeeId: 'emp-001',
            createdAt: new Date().toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    renderCaseNewPage('manager');
    await advanceToStep3(user);

    // Click Save Case
    await user.click(screen.getByRole('button', { name: /Save Case/i }));

    // DualLawModal must NOT open
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId('dual-law-modal')).not.toBeInTheDocument();

    // Should navigate to /cases directly
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/cases');
    });

    // Manager payload always uses type='ada'
    expect((capturedBody as Record<string, unknown>).type).toBe('ada');
  });
});
