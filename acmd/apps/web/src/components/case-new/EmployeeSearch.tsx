/**
 * EmployeeSearch — Phase 6C (ACMD-136-A)
 *
 * Combobox/autocomplete for employee lookup.
 * - GET /api/v1/employees?search={q}&limit=10
 * - Debounce 300ms, min 2 chars
 * - Shows: name, department, employee ID in results
 * - Manager role: server sends only their team (no frontend filter needed)
 * - "No results" if nothing found (no Add New Employee in this task)
 * - After selection: shows employee info card (name, dept, hire date)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthenticatedClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Employee {
  id: string;
  name: string;
  department: string;
  employeeNumber: string; // e.g. EMP-042
  hireDate: string | null; // ISO date string
  email: string;
}

interface SearchEmployeesResponse {
  employees: Employee[];
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

async function searchEmployees(
  client: AuthenticatedClient,
  query: string,
): Promise<Employee[]> {
  const params = new URLSearchParams({ search: query, limit: '10' });
  const data = await client.request<SearchEmployeesResponse>(
    `/api/v1/employees?${params.toString()}`,
  );
  return data.employees ?? [];
}

// ---------------------------------------------------------------------------
// EmployeeCard — shown after selection
// ---------------------------------------------------------------------------

interface EmployeeCardProps {
  employee: Employee;
  onClear: () => void;
}

function EmployeeCard({ employee, onClear }: EmployeeCardProps) {
  const hireDisplay = employee.hireDate
    ? new Date(employee.hireDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';

  return (
    <div
      className="mt-2 flex items-start justify-between rounded-lg border border-[#2563EB]/30 bg-blue-50 p-3"
      data-testid="employee-card"
    >
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-[#1E3A5F]">{employee.name}</p>
        <p className="text-xs text-gray-600">{employee.department} · #{employee.employeeNumber}</p>
        <p className="text-xs text-gray-500">Hired: {hireDisplay}</p>
      </div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Remove selected employee"
        className="ml-3 rounded p-0.5 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmployeeSearch component
// ---------------------------------------------------------------------------

interface EmployeeSearchProps {
  client: AuthenticatedClient;
  /** Currently selected employee (null = none) */
  selectedEmployee: Employee | null;
  onSelect: (employee: Employee) => void;
  onClear: () => void;
  error?: string;
  disabled?: boolean;
}

export function EmployeeSearch({
  client,
  selectedEmployee,
  onSelect,
  onClear,
  error,
  disabled = false,
}: EmployeeSearchProps) {
  const [inputValue, setInputValue] = useState('');
  const [results, setResults] = useState<Employee[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Close dropdown on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults([]);
        setIsOpen(false);
        return;
      }
      setIsLoading(true);
      setSearchError(null);
      try {
        const employees = await searchEmployees(client, q);
        setResults(employees);
        setIsOpen(true);
        setActiveIndex(-1);
      } catch {
        setSearchError('Search failed. Please try again.');
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    [client],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInputValue(val);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // 300ms debounce
      debounceRef.current = setTimeout(() => {
        void doSearch(val);
      }, 300);
    },
    [doSearch],
  );

  const handleSelect = useCallback(
    (emp: Employee) => {
      onSelect(emp);
      setInputValue('');
      setResults([]);
      setIsOpen(false);
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen || results.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault();
        const emp = results[activeIndex];
        if (emp) handleSelect(emp);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    },
    [isOpen, results, activeIndex, handleSelect],
  );

  const listboxId = 'employee-search-listbox';

  // If already selected, show the card
  if (selectedEmployee) {
    return (
      <div>
        <EmployeeCard employee={selectedEmployee} onClear={onClear} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id="employee-search-input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `emp-option-${activeIndex}` : undefined}
          aria-label="Search employee by name, ID, or email"
          aria-required="true"
          aria-invalid={!!error}
          aria-describedby={error ? 'employee-search-error' : undefined}
          disabled={disabled}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Search employee by name, ID, or email..."
          className={cn(
            'w-full rounded-md border px-3 py-2 text-sm shadow-sm transition',
            'focus:outline-none focus:ring-2 focus:ring-[#2563EB]',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error ? 'border-red-500 bg-red-50' : 'border-gray-300 bg-white',
          )}
        />
        {isLoading && (
          <span
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400"
            aria-live="polite"
          >
            Searching…
          </span>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Employee search results"
          className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500" role="option" aria-selected={false}>
              No results found
            </li>
          ) : (
            results.map((emp, idx) => (
              <li
                key={emp.id}
                id={`emp-option-${idx}`}
                role="option"
                aria-selected={idx === activeIndex}
                className={cn(
                  'cursor-pointer px-3 py-2 text-sm transition',
                  idx === activeIndex
                    ? 'bg-[#2563EB] text-white'
                    : 'text-gray-900 hover:bg-blue-50',
                )}
                onMouseDown={(e) => {
                  // prevent blur before click
                  e.preventDefault();
                  handleSelect(emp);
                }}
              >
                <span className="font-medium">{emp.name}</span>
                <span
                  className={cn(
                    'ml-2 text-xs',
                    idx === activeIndex ? 'text-blue-100' : 'text-gray-500',
                  )}
                >
                  {emp.department} · #{emp.employeeNumber}
                </span>
              </li>
            ))
          )}
        </ul>
      )}

      {/* Error messages */}
      {error && (
        <p id="employee-search-error" className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      {searchError && (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {searchError}
        </p>
      )}
    </div>
  );
}
