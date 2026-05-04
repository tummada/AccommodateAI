import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { AppShellSkeleton } from '@/components/AppShellSkeleton';

/**
 * ProtectedRoute — bootstrap-aware.
 *
 * ACMD-116 §1: while `bootstrap === 'pending'` we must render the
 * skeleton, not redirect to /login. A redirect-on-pending would flash
 * the login page on every hard refresh (the bug we are specifically
 * fixing).
 *
 * `network_error` is surfaced as a friendly retry panel so a flaky
 * connection does not dump the user back onto the login screen.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { bootstrap, isAuthenticated } = useAuth();
  const location = useLocation();

  if (bootstrap === 'pending') {
    return <AppShellSkeleton />;
  }

  if (bootstrap === 'network_error') {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-bg px-4"
        role="alert"
      >
        <div className="max-w-sm rounded-lg border border-border bg-surface p-6 text-center shadow-sm">
          <h1 className="mb-2 text-lg font-semibold text-text">Connection problem</h1>
          <p className="mb-4 text-sm text-text-muted">
            We could not reach the server. Check your network and try again.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
