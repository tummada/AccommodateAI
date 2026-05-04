import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// ACMD-116: the dev server port must match the backend CORS whitelist
// (apps/acmd-api/src/config.ts → corsOrigins). Cookies on `credentials:'include'`
// will be silently rejected by the browser if the Origin header does not match,
// so the refresh-token flow would break if these drift apart.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3003,
    strictPort: true,
  },
});
