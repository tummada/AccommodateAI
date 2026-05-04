/**
 * ACMD-116 §7 — cross-tab logout sync test.
 *
 * BroadcastChannel is available in jsdom 22+. We mount two AuthProviders
 * in the same document (simulating two tabs sharing the same origin) and
 * assert that calling logout() in Provider A causes Provider B to drop
 * its auth state.
 */
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { server } from './server';
import { makeFakeAccessToken } from './handlers';

// RS-013: auth endpoints moved to vollos-core at port 3002.
const AUTH = 'http://localhost:3002';

function Tab({
  id,
  onReady,
}: {
  id: string;
  onReady?: (logout: () => Promise<void>) => void;
}) {
  const { bootstrap, isAuthenticated, login, logout } = useAuth();
  const loggedInOnce = useRef(false);
  useEffect(() => {
    if (!loggedInOnce.current && bootstrap === 'unauthenticated' && !isAuthenticated) {
      loggedInOnce.current = true;
      login(makeFakeAccessToken({ sub: `user-${id}` }), false);
    }
  }, [bootstrap, isAuthenticated, login, id]);
  useEffect(() => {
    if (onReady) onReady(logout);
  }, [logout, onReady]);
  return (
    <div>
      <span data-testid={`tab-${id}-authed`}>{String(isAuthenticated)}</span>
    </div>
  );
}

describe('cross-tab logout broadcast', () => {
  it('tab A logout → tab B state cleared', async () => {
    server.use(
      http.post(`${AUTH}/auth/refresh`, () =>
        HttpResponse.json({ error: 'missing' }, { status: 401 }),
      ),
      http.post(`${AUTH}/auth/logout`, () =>
        HttpResponse.json({ message: 'ok' }, { status: 200 }),
      ),
    );

    let logoutA: () => Promise<void> = async () => {};

    render(
      <>
        <MemoryRouter>
          <AuthProvider>
            <Tab
              id="A"
              onReady={(fn) => {
                logoutA = fn;
              }}
            />
          </AuthProvider>
        </MemoryRouter>
        <MemoryRouter>
          <AuthProvider>
            <Tab id="B" />
          </AuthProvider>
        </MemoryRouter>
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('tab-A-authed').textContent).toBe('true');
      expect(screen.getByTestId('tab-B-authed').textContent).toBe('true');
    });

    await act(async () => {
      await logoutA();
      // BroadcastChannel delivery is asynchronous — let microtasks flush.
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(screen.getByTestId('tab-A-authed').textContent).toBe('false');
    await waitFor(() => {
      expect(screen.getByTestId('tab-B-authed').textContent).toBe('false');
    });
  });
});
