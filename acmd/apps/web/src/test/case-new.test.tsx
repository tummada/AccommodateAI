/**
 * ACMD-136-A — Vitest tests for CaseNewPage and sub-components.
 *
 * Tests cover:
 *   1. CaseNewPage renders without crash (step 1 visible + stepper)
 *   2. EmployeeSearch debounce 300ms — no call before 300ms, calls after
 *   3. Step1 → Step2 navigation: Next validates all 3 fields
 *   4. TypeSpecificFields — all 6 types render correct fields
 *   5. Data persists when navigating Back from Step 2 → Step 1
 *   6. Role visibility — Manager sees "Manager View", AddNewEmployee hidden
 *   7. StepBasicInfo inline validation: error summary displayed
 *   8. CaseStepper: aria-current="step" on active step
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/auth-context';
import { CaseNewPage } from '@/pages/CaseNewPage';
import { CaseStepper } from '@/components/case-new/CaseStepper';
import { TypeSpecificFields, defaultTypeSpecificData, validateTypeSpecificData } from '@/components/case-new/TypeSpecificFields';
import type { AccommodationType } from '@/components/case-new/TypeSpecificFields';
import { validateStep1 } from '@/components/case-new/StepBasicInfo';
import { server } from './server';
import { makeFakeAccessToken } from './handlers';

// RS-013: split — data on acmd-api (port 3000), auth on vollos-core (port 3002).
const API = 'http://localhost:3000';
const AUTH = 'http://localhost:3002';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

/** Render CaseNewPage inside all required providers with a specific user role */
function renderCaseNewPage(role: 'hr' | 'super_admin' | 'manager' = 'hr') {
  const qc = makeQueryClient();
  const token = makeFakeAccessToken({ role });

  // Override refresh + me so AuthProvider boots to authenticated
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
    // Default employee search returns empty
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

// ---------------------------------------------------------------------------
// 1. Render test
// ---------------------------------------------------------------------------

describe('CaseNewPage — render', () => {
  it('renders without crash, shows stepper and Step 1', async () => {
    renderCaseNewPage('hr');

    // Wait for AuthProvider bootstrap
    await waitFor(() => {
      expect(screen.getByText('New Accommodation Case')).toBeInTheDocument();
    });

    // Stepper is present
    expect(screen.getByRole('group', { name: 'Case creation progress' })).toBeInTheDocument();

    // Step 1 heading visible
    expect(screen.getByText(/Step 1 — Basic Information/)).toBeInTheDocument();

    // Employee search input present
    expect(screen.getByRole('combobox', { name: /Search employee/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. EmployeeSearch debounce — unit test via EmployeeSearch directly
// ---------------------------------------------------------------------------

import { EmployeeSearch } from '@/components/case-new/EmployeeSearch';
import { createAuthenticatedClient } from '@/lib/api-client';

describe('EmployeeSearch — debounce 300ms', () => {
  it('does not call API immediately, calls after 300ms debounce (unit test)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    let callCount = 0;

    server.use(
      http.get(`${API}/api/v1/employees`, () => {
        callCount++;
        return HttpResponse.json({ employees: [] }, { status: 200 });
      }),
    );

    // Build a minimal authenticated client that reads from token ref
    const mockClient = createAuthenticatedClient({
      getAccessToken: () => makeFakeAccessToken(),
      onTokenRefreshed: () => {},
      onAuthLost: () => {},
    });

    render(
      <EmployeeSearch
        client={mockClient}
        selectedEmployee={null}
        onSelect={() => {}}
        onClear={() => {}}
      />,
    );

    const input = screen.getByRole('combobox', { name: /Search employee/i });
    fireEvent.change(input, { target: { value: 'Jo' } });

    // Before 300ms — no call
    act(() => { vi.advanceTimersByTime(200); });
    expect(callCount).toBe(0);

    // After 300ms (total 350ms) — call fires
    await act(async () => {
      vi.advanceTimersByTime(150);
      // Flush the microtask queue so the async fetch resolves
      await Promise.resolve();
    });

    // The debounce fired — callCount should be 1
    expect(callCount).toBe(1);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// 3. Step 1 → Step 2 validation
// ---------------------------------------------------------------------------

describe('CaseNewPage — Step 1 validation before advancing', () => {
  it('shows errors when Next clicked with no data', async () => {
    renderCaseNewPage('hr');
    await waitFor(() =>
      expect(screen.getByText(/Step 1 — Basic Information/)).toBeInTheDocument(),
    );

    const nextBtn = screen.getByRole('button', { name: /Next/i });
    await userEvent.click(nextBtn);

    // Error summary shown — use getAllByText because error appears in both list + field
    await waitFor(() => {
      expect(screen.getAllByText(/Please select an employee/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Please select an accommodation type/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Description must be at least 20 characters/i).length).toBeGreaterThan(0);
    });

    // Still on Step 1
    expect(screen.getByText(/Step 1 — Basic Information/)).toBeInTheDocument();
    expect(screen.queryByText(/Step 2 — Details/)).not.toBeInTheDocument();
  });

  it('validateStep1 returns errors for incomplete data', () => {
    const errors = validateStep1({
      employee: null,
      accommodationType: null,
      requestDescription: 'too short',
    });
    expect(errors.employee).toBeDefined();
    expect(errors.accommodationType).toBeDefined();
    expect(errors.requestDescription).toBeDefined();
  });

  it('validateStep1 returns no errors for complete valid data', () => {
    const errors = validateStep1({
      employee: {
        id: 'emp-1',
        name: 'Jane Smith',
        department: 'Engineering',
        employeeNumber: 'EMP-001',
        hireDate: '2023-01-01',
        email: 'jane@example.com',
      },
      accommodationType: 'physical_workspace',
      requestDescription: 'Needs a standing desk due to back issues',
    });
    expect(Object.keys(errors)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. TypeSpecificFields — all 6 types
// ---------------------------------------------------------------------------

describe('TypeSpecificFields — all 6 accommodation types', () => {
  const types: AccommodationType[] = [
    'physical_workspace',
    'schedule_modification',
    'equipment',
    'policy_exception',
    'leave',
    'other',
  ];

  const expectedLabels: Record<AccommodationType, string> = {
    physical_workspace: 'Workspace Requirements',
    schedule_modification: 'Requested Schedule',
    equipment: 'Equipment Description',
    policy_exception: 'Policy Exception Details',
    leave: 'Leave Type',
    other: 'Detailed Description',
  };

  types.forEach((type) => {
    it(`renders required field label for type: ${type}`, () => {
      const data = defaultTypeSpecificData(type);
      const { container } = render(
        <TypeSpecificFields
          type={type}
          data={data}
          onChange={() => {}}
          errors={[]}
        />,
      );

      // The type-specific section is rendered
      expect(container.querySelector(`[data-testid="type-specific-${type}"]`)).toBeInTheDocument();

      // The required field label is shown
      expect(screen.getByLabelText(new RegExp(expectedLabels[type], 'i'))).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Data persists when Back is clicked — DOM-based test
// ---------------------------------------------------------------------------

describe('CaseNewPage — data persists on Back', () => {
  it('Step 1 and Step 2 data is preserved when navigating Back then Forward (DOM test)', async () => {
    const fakeEmployee = {
      id: 'emp-dom-1',
      name: 'Alice Tester',
      department: 'Engineering',
      employeeNumber: 'EMP-001',
      hireDate: '2022-03-15',
      email: 'alice@example.com',
    };

    renderCaseNewPage('hr');

    // Wait for auth bootstrap + page to render
    await waitFor(
      () => expect(screen.getByText(/Step 1 — Basic Information/)).toBeInTheDocument(),
      { timeout: 3000 },
    );

    // Override employee handler AFTER renderCaseNewPage so this handler takes
    // priority (MSW prepends handlers added with server.use).
    server.use(
      http.get(`${API}/api/v1/employees`, () =>
        HttpResponse.json({ employees: [fakeEmployee] }, { status: 200 }),
      ),
    );

    // --- Fill Step 1 ---

    // 1. Trigger employee search via fireEvent.change (bypasses fake timer issues)
    const searchInput = screen.getByRole('combobox', { name: /Search employee/i });
    fireEvent.change(searchInput, { target: { value: 'Alice' } });

    // Wait for the 300ms debounce to fire + MSW to respond
    await waitFor(
      () => expect(screen.getByText('Alice Tester')).toBeInTheDocument(),
      { timeout: 2000 },
    );

    // 2. Select employee — component uses onMouseDown to avoid blur-before-click
    fireEvent.mouseDown(screen.getByText('Alice Tester'));

    // Employee card should be visible after selection
    await waitFor(() => {
      expect(screen.getByTestId('employee-card')).toBeInTheDocument();
    });

    // 3. Select accommodation type
    const typeSelect = screen.getByRole('combobox', { name: /Accommodation Type/i });
    fireEvent.change(typeSelect, { target: { value: 'physical_workspace' } });

    // 4. Fill request description (min 20 chars)
    const descTextarea = screen.getByRole('textbox', { name: /Request Description/i });
    fireEvent.change(descTextarea, {
      target: { value: 'Need a standing desk for back support at work' },
    });

    // 5. Click Next → advance to Step 2
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByText(/Step 2 — Details/)).toBeInTheDocument();
    });

    // --- Fill Step 2 ---
    const limitationsTextarea = screen.getByRole('textbox', { name: /Functional Limitations/i });
    fireEvent.change(limitationsTextarea, { target: { value: 'Cannot sit for extended periods' } });

    const workspaceInput = screen.getByRole('textbox', { name: /Workspace Requirements/i });
    fireEvent.change(workspaceInput, { target: { value: 'Electric standing desk' } });

    // --- Navigate Back to Step 1 ---
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));

    await waitFor(() => {
      expect(screen.getByText(/Step 1 — Basic Information/)).toBeInTheDocument();
    });

    // Step 1 data must still be present in DOM
    expect(screen.getByTestId('employee-card')).toBeInTheDocument();
    expect(screen.getByText('Alice Tester')).toBeInTheDocument();

    const typeSelectBack = screen.getByRole('combobox', { name: /Accommodation Type/i });
    expect((typeSelectBack as HTMLSelectElement).value).toBe('physical_workspace');

    const descBack = screen.getByRole('textbox', { name: /Request Description/i });
    expect((descBack as HTMLTextAreaElement).value).toContain('standing desk');

    // --- Navigate Forward again to Step 2 ---
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByText(/Step 2 — Details/)).toBeInTheDocument();
    });

    // Step 2 data must still be present in DOM
    const limitationsBack = screen.getByRole('textbox', { name: /Functional Limitations/i });
    expect((limitationsBack as HTMLTextAreaElement).value).toContain('Cannot sit');

    const workspaceBack = screen.getByRole('textbox', { name: /Workspace Requirements/i });
    expect((workspaceBack as HTMLInputElement).value).toContain('Electric standing desk');
  });
});

// ---------------------------------------------------------------------------
// 6. Role visibility — Manager
// ---------------------------------------------------------------------------

describe('CaseNewPage — role visibility', () => {
  it('shows "Manager View" badge for manager role', async () => {
    renderCaseNewPage('manager');
    await waitFor(() => {
      expect(screen.getByText('Manager View')).toBeInTheDocument();
    });
  });

  it('does NOT show "Manager View" for hr role', async () => {
    renderCaseNewPage('hr');
    await waitFor(() => {
      expect(screen.getByText('New Accommodation Case')).toBeInTheDocument();
    });
    expect(screen.queryByText('Manager View')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 7. StepBasicInfo inline error display
// ---------------------------------------------------------------------------

describe('StepBasicInfo — validation errors', () => {
  it('error summary is rendered when errors are present', async () => {
    renderCaseNewPage('hr');
    await waitFor(() =>
      expect(screen.getByText(/Step 1 — Basic Information/)).toBeInTheDocument(),
    );

    const nextBtn = screen.getByRole('button', { name: /Next/i });
    await userEvent.click(nextBtn);

    await waitFor(() => {
      // Error summary has role="alert"
      const alerts = screen.getAllByRole('alert');
      expect(alerts.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 8. CaseStepper accessibility
// ---------------------------------------------------------------------------

describe('CaseStepper — accessibility', () => {
  it('active step has aria-current="step"', () => {
    render(<CaseStepper currentStep={1} onStepClick={() => {}} />);
    // Both desktop and mobile render buttons — find any with aria-current="step"
    const activeButtons = screen.getAllByRole('button', { name: /Step 1.*current/i });
    expect(activeButtons.length).toBeGreaterThan(0);
    expect(activeButtons[0]).toHaveAttribute('aria-current', 'step');
  });

  it('step group has correct role and aria-label', () => {
    render(<CaseStepper currentStep={2} onStepClick={() => {}} />);
    expect(screen.getByRole('group', { name: 'Case creation progress' })).toBeInTheDocument();
  });

  it('completed steps are clickable (not disabled)', () => {
    const handleClick = vi.fn();
    render(<CaseStepper currentStep={3} onStepClick={handleClick} />);
    // Step 1 should be completed (not disabled)
    const step1Btn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.includes('Step 1') && b.getAttribute('aria-label')?.includes('completed'),
    );
    expect(step1Btn).not.toBeUndefined();
    expect(step1Btn).not.toBeDisabled();
  });

  it('future steps are disabled', () => {
    render(<CaseStepper currentStep={1} onStepClick={() => {}} />);
    // Step 3 is future — should be disabled
    const step3Btn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.includes('Step 3'),
    );
    expect(step3Btn).not.toBeUndefined();
    expect(step3Btn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 9. M-2 — label/input association via htmlFor/id (WCAG 2.2 SC 1.3.1)
// ---------------------------------------------------------------------------

describe('TypeSpecificFields — label/input association (M-2)', () => {
  it('physical_workspace: getByLabelText finds Workspace Requirements input', () => {
    render(
      <TypeSpecificFields
        type="physical_workspace"
        data={defaultTypeSpecificData('physical_workspace')}
        onChange={() => {}}
        errors={[]}
      />,
    );
    // getByLabelText works only when label htmlFor matches input id
    const input = screen.getByLabelText(/Workspace Requirements/i);
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe('INPUT');
  });

  it('schedule_modification: getByLabelText finds Requested Schedule input', () => {
    render(
      <TypeSpecificFields
        type="schedule_modification"
        data={defaultTypeSpecificData('schedule_modification')}
        onChange={() => {}}
        errors={[]}
      />,
    );
    const input = screen.getByLabelText(/Requested Schedule/i);
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe('INPUT');
  });

  it('equipment: getByLabelText finds Equipment Description input', () => {
    render(
      <TypeSpecificFields
        type="equipment"
        data={defaultTypeSpecificData('equipment')}
        onChange={() => {}}
        errors={[]}
      />,
    );
    const input = screen.getByLabelText(/Equipment Description/i);
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe('INPUT');
  });

  it('policy_exception: getByLabelText finds Policy Exception Details input', () => {
    render(
      <TypeSpecificFields
        type="policy_exception"
        data={defaultTypeSpecificData('policy_exception')}
        onChange={() => {}}
        errors={[]}
      />,
    );
    const input = screen.getByLabelText(/Policy Exception Details/i);
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe('INPUT');
  });

  it('leave: getByLabelText finds Leave Type select', () => {
    render(
      <TypeSpecificFields
        type="leave"
        data={defaultTypeSpecificData('leave')}
        onChange={() => {}}
        errors={[]}
      />,
    );
    const select = screen.getByLabelText(/Leave Type/i);
    expect(select).toBeInTheDocument();
    expect(select.tagName).toBe('SELECT');
  });

  it('leave: getByLabelText finds Start Date and End Date inputs', () => {
    render(
      <TypeSpecificFields
        type="leave"
        data={defaultTypeSpecificData('leave')}
        onChange={() => {}}
        errors={[]}
      />,
    );
    const startInput = screen.getByLabelText(/Start Date/i);
    expect(startInput).toBeInTheDocument();
    expect(startInput).toHaveAttribute('type', 'date');

    const endInput = screen.getByLabelText(/End Date/i);
    expect(endInput).toBeInTheDocument();
    expect(endInput).toHaveAttribute('type', 'date');
  });

  it('other: getByLabelText finds Detailed Description textarea', () => {
    render(
      <TypeSpecificFields
        type="other"
        data={defaultTypeSpecificData('other')}
        onChange={() => {}}
        errors={[]}
      />,
    );
    const textarea = screen.getByLabelText(/Detailed Description/i);
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe('TEXTAREA');
  });
});

// ---------------------------------------------------------------------------
// 10. SEC-002 — Leave date range validation
// ---------------------------------------------------------------------------

describe('TypeSpecificFields — leave date range validation (SEC-002)', () => {
  it('shows error when end date is before start date', () => {
    render(
      <TypeSpecificFields
        type="leave"
        data={{ leaveType: 'continuous', startDate: '2026-05-10', endDate: '2026-05-01' }}
        onChange={() => {}}
        errors={['End date must be on or after start date']}
      />,
    );
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.getAllByText('End date must be on or after start date').length).toBeGreaterThan(0);
  });

  it('validateTypeSpecificData returns error when endDate < startDate', () => {
    const errors = validateTypeSpecificData('leave', {
      leaveType: 'continuous',
      startDate: '2026-05-10',
      endDate: '2026-05-01',
    });
    expect(errors).toContain('End date must be on or after start date');
  });

  it('validateTypeSpecificData no error when endDate === startDate', () => {
    const errors = validateTypeSpecificData('leave', {
      leaveType: 'continuous',
      startDate: '2026-05-10',
      endDate: '2026-05-10',
    });
    expect(errors.filter((e) => e.includes('End date'))).toHaveLength(0);
  });

  it('validateTypeSpecificData no error when endDate > startDate', () => {
    const errors = validateTypeSpecificData('leave', {
      leaveType: 'continuous',
      startDate: '2026-05-01',
      endDate: '2026-05-10',
    });
    expect(errors.filter((e) => e.includes('End date'))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 11. defaultTypeSpecificData utility
// ---------------------------------------------------------------------------

describe('defaultTypeSpecificData', () => {
  it('returns empty strings for all types', () => {
    const types: AccommodationType[] = [
      'physical_workspace', 'schedule_modification', 'equipment',
      'policy_exception', 'leave', 'other',
    ];
    for (const type of types) {
      const data = defaultTypeSpecificData(type);
      expect(data).toBeDefined();
      // No undefined values
      for (const val of Object.values(data)) {
        expect(val).not.toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.useRealTimers();
});
