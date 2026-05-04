/**
 * Vitest + Testing Library global setup.
 *
 * ACMD-116: all tests run in jsdom. We wire up MSW to intercept fetch
 * and @testing-library/jest-dom matchers for ergonomic assertions.
 */
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './server';
import { __resetPendingRefresh } from '@/lib/auth-context';

// Ensure VITE_API_BASE_URL resolves for the api-client during tests.
// Using the same origin jsdom reports so fetch() URL matching in MSW
// handlers is predictable.
if (!import.meta.env.VITE_API_BASE_URL) {
  (import.meta.env as Record<string, string>).VITE_API_BASE_URL = 'http://localhost:3000';
}
// RS-013: auth endpoints live on vollos-core at a DIFFERENT origin.
// Pin to localhost:3002 so MSW handlers registered at that origin
// match the actual cross-origin fetch() calls made by authRequest.
if (!import.meta.env.VITE_VOLLOS_AUTH_URL) {
  (import.meta.env as Record<string, string>).VITE_VOLLOS_AUTH_URL = 'http://localhost:3002';
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  // ACMD-131: reset module-level deduplication singleton so a never-resolving
  // promise from one test (e.g. ProtectedRoute pending test) does not bleed
  // into subsequent tests.
  __resetPendingRefresh();
});

afterAll(() => {
  server.close();
});
