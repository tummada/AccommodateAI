// vitest.setup.ts — global test env stubs (runs before any test module loads)
// Placeholder values only — never real secrets.

process.env['TURNSTILE_SECRET_KEY'] = process.env['TURNSTILE_SECRET_KEY'] ?? 'test-secret-key';
process.env['GMAIL_USER'] = process.env['GMAIL_USER'] ?? 'test@example.com';
process.env['GOOGLE_CLIENT_ID'] = process.env['GOOGLE_CLIENT_ID'] ?? 'test-client-id';
process.env['GOOGLE_CLIENT_SECRET'] = process.env['GOOGLE_CLIENT_SECRET'] ?? 'test-client-secret';
process.env['GOOGLE_REFRESH_TOKEN'] = process.env['GOOGLE_REFRESH_TOKEN'] ?? 'test-refresh-token';
