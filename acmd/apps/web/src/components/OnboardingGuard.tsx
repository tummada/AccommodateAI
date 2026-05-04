import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';

/**
 * OnboardingGuard — forces authenticated users with onboardingRequired === true
 * to complete /onboarding before accessing any other protected route.
 *
 * Must be used INSIDE <ProtectedRoute> so `user` is guaranteed non-null.
 * The /onboarding route itself must NOT be wrapped in this guard (otherwise
 * we get an infinite redirect loop).
 */
export function OnboardingGuard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (user?.onboardingRequired && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
