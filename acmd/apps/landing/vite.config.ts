import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Landing dev server runs on port 3103 to match docker-compose.yml mapping
// and the production subdomain accommodate.vollos.ai (D6.1 / D20 flat-with-hyphen
// pattern: accommodate.vollos.ai = landing, accommodate-app.* = web,
// accommodate-api.* = api). Keeping the dev port aligned with the production
// host port avoids cross-environment surprises in CORS / cookie testing.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3103,
    strictPort: true,
  },
});
