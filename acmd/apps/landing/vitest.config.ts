import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// T-069 / F-005 fix: dedicated vitest config for apps/landing. The Beta
// signup contract bug (F-001 — invite_token vs token) and the 202 waitlist
// false-success bug (F-002) shipped because there were no FE unit tests.
// jsdom is required because src/lib/api.ts reads `navigator` for GPC
// detection (COMP-001).
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
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    clearMocks: true,
    restoreMocks: true,
    // Pin the API base URL for the test environment so request-shape
    // assertions match a stable origin (instead of localhost:3101 fallback).
    env: {
      VITE_API_URL: 'http://api.test.local',
    },
  },
});
