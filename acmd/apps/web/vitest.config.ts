import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// ACMD-116: dedicated vitest config so the Vite build config stays lean.
// jsdom is required for React Testing Library (document, window, fetch).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    clearMocks: true,
    restoreMocks: true,
    // BUG-1 fix: pin the API base URL for the test environment so MSW
    // handlers (all registered at http://localhost:3000) match the actual
    // fetch() calls made by api-client.ts.  Without this, .env.local
    // (VITE_API_BASE_URL=http://localhost:3001) leaks into the test run
    // and every bootstrap / refresh / logout test fails with NetworkError
    // because MSW's 'error' strategy fires for unhandled port-3001 requests.
    env: {
      VITE_API_BASE_URL: 'http://localhost:3000',
      // RS-013: api-client now talks to two services. Point the auth
      // base URL at a distinct MSW origin so handlers can assert the
      // split (acmd-api vs vollos-core) is being honoured at the
      // request layer. Tests register handlers at both origins.
      VITE_VOLLOS_AUTH_URL: 'http://localhost:3002',
    },
  },
});
