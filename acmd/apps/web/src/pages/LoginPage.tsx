import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { Shield } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth-context';
import { ApiError, GOOGLE_PATH, authRequest } from '@/lib/api-client';
import { AppShellSkeleton } from '@/components/AppShellSkeleton';

interface GoogleAuthResponse {
  accessToken: string;
  onboarding_required: boolean;
}

export function LoginPage() {
  const { isAuthenticated, user, login, bootstrap } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ACMD-116 §1: do not flash the Google button while the bootstrap
  // refresh probe is still running — otherwise a user with a valid
  // refresh cookie briefly sees the login page before being redirected.
  if (bootstrap === 'pending') {
    return <AppShellSkeleton />;
  }

  // L-01: honor onboardingRequired when an already-authed user lands on /login.
  // T-118: needsBetaInvite gate wins over onboardingRequired (both flags can
  // be true at once for a user with no beta redemption row).
  if (isAuthenticated) {
    let target = '/dashboard';
    if (user?.needsBetaInvite) {
      target = '/redeem-invite';
    } else if (user?.onboardingRequired) {
      target = '/onboarding';
    }
    return <Navigate to={target} replace />;
  }

  const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
    // L-03: guard against double-fire while a previous exchange is in flight.
    if (loading) return;
    setError(null);
    const idToken = credentialResponse.credential;
    if (!idToken) {
      setError('Google sign-in did not return a credential. Please try again.');
      return;
    }

    setLoading(true);
    try {
      // RS-013: /auth/google is served by vollos-core auth-service.
      // authRequest prefixes AUTH_BASE_URL (VITE_VOLLOS_AUTH_URL) so
      // the request lands on the shared auth origin, not acmd-api.
      const data = await authRequest<GoogleAuthResponse>(GOOGLE_PATH, {
        method: 'POST',
        body: { idToken },
      });

      if (!data?.accessToken) {
        setError('Sign-in succeeded but the server did not return a session. Please try again.');
        return;
      }

      // ACMD-124: login() is now async — it fetches GET /auth/me to
      // populate the user profile before flipping auth state. We must
      // await it so ProtectedRoute sees `authenticated` on navigate.
      // T-118: login() returns the resolved AuthUser so we can synchronously
      // route based on the freshly-fetched needsBetaInvite flag without
      // waiting for the React state update to flush.
      const authedUser = await login(data.accessToken, data.onboarding_required);
      // Routing precedence (per task.md AC4 + T-117 brief Section 1):
      //   1. needsBetaInvite=true → /redeem-invite (BEFORE onboarding check)
      //   2. onboarding_required → /onboarding
      //   3. else → /dashboard
      let target: string;
      if (authedUser.needsBetaInvite) {
        target = '/redeem-invite';
      } else if (data.onboarding_required) {
        target = '/onboarding';
      } else {
        target = '/dashboard';
      }
      navigate(target, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Unable to sign in right now. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleError = () => {
    setError('Google sign-in was cancelled or failed. Please try again.');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-white">
            <Shield className="h-6 w-6" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl">Sign in to AccommodateAI</CardTitle>
          <CardDescription>
            ADA &amp; PWFA accommodation compliance for US employers.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <div aria-busy={loading}>
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
              useOneTap={false}
              width="320"
            />
          </div>

          {loading && (
            <p role="status" className="text-sm text-text-muted">
              Signing you in...
            </p>
          )}

          {error && (
            <p
              role="alert"
              tabIndex={-1}
              className="w-full rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <p className="mt-2 text-center text-xs text-text-muted">
            By signing in, you agree to our Terms of Service and Privacy Policy.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
