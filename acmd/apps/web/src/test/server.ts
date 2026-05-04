/**
 * MSW server used by tests. Handlers are per-test via server.use(...).
 * See handlers.ts for the default baseline.
 */
import { setupServer } from 'msw/node';
import { defaultHandlers } from './handlers';

export const server = setupServer(...defaultHandlers);
