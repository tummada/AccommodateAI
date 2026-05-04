import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { CasesPage } from '@/pages/CasesPage';
import { CaseNewPage } from '@/pages/CaseNewPage';
import { CaseDetailPage } from '@/pages/CaseDetailPage';
import { DecisionPage } from '@/pages/DecisionPage';
import { ChecklistPage } from '@/pages/ChecklistPage';
import { TimelinePage } from '@/pages/TimelinePage';
import { EmployeesPage } from '@/pages/EmployeesPage';
import { LettersPage } from '@/pages/LettersPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ManagerInputPage } from '@/pages/ManagerInputPage';
import { MedicalRequestPage } from '@/pages/MedicalRequestPage';
import { AIAnalysisPage } from '@/pages/AIAnalysisPage';
import { PwfaFastTrackPage } from '@/pages/PwfaFastTrackPage';
import { PwfaInterimPage } from '@/pages/PwfaInterimPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { RedeemInvitePage } from '@/pages/RedeemInvitePage';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { OnboardingGuard } from '@/components/OnboardingGuard';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import { AppShellSkeleton } from '@/components/AppShellSkeleton';

/**
 * RoleGuard — SEC-001: Enforce role-based route access before component mounts.
 * Unlike a useEffect redirect (which fires after render), this renders null and
 * redirects synchronously so the protected component never mounts for denied roles.
 *
 * Usage: <RoleGuard allowedRoles={['super_admin', 'hr']}><ProtectedPage /></RoleGuard>
 */
function RoleGuard({
  allowedRoles,
  children,
}: {
  allowedRoles: string[];
  children: React.ReactNode;
}) {
  const { user, bootstrap } = useAuth();

  // While auth is still bootstrapping, render nothing (prevents flash)
  if (bootstrap === 'pending') {
    return <AppShellSkeleton />;
  }

  const role = user?.role ?? '';
  if (!allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace state={{ roleBlocked: true }} />;
  }

  return <div data-testid="role-guard">{children}</div>;
}

/**
 * CatchAllRedirect — L-04: avoid double-hop (unknown path -> /dashboard ->
 * ProtectedRoute bounce to /login). Route unknown paths directly based on
 * auth/onboarding state.
 *
 * ACMD-116: wait for bootstrap before deciding — otherwise a hard reload
 * at `/` always races to /login even for authed users.
 */
function CatchAllRedirect() {
  const { isAuthenticated, user, bootstrap } = useAuth();
  if (bootstrap === 'pending') {
    return <AppShellSkeleton />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  // T-118: needsBetaInvite branch must be checked BEFORE onboardingRequired
  // because both flags can be true simultaneously (a user without a beta
  // redemption row also has no acmd_users row, so /me sets both). Beta
  // gate wins — onboarding is the next step AFTER successful redemption.
  if (user?.needsBetaInvite) {
    return <Navigate to="/redeem-invite" replace />;
  }
  return <Navigate to={user?.onboardingRequired ? '/onboarding' : '/dashboard'} replace />;
}

/**
 * GuardedOutlet — wraps the nested route <Outlet/> in OnboardingGuard so
 * every non-onboarding protected route enforces onboarding completion
 * (L-02).
 */
function GuardedOutlet() {
  return (
    <OnboardingGuard>
      <Outlet />
    </OnboardingGuard>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* T-049: /onboarding is protected (auth gate still required) but is
          rendered OUTSIDE of <AppLayout> so the Sidebar + Topbar chrome do
          NOT wrap the onboarding card. A user whose company has not been
          provisioned has definitionally nothing to navigate to yet — showing
          disabled nav links on day 0 was confusing (owner test 2026-04-19)
          and breaks the "guided workflow" principle. OnboardingGuard is NOT
          applied here (same invariant as before) because that guard exists
          to push users INTO /onboarding — applying it here would redirect
          us into an infinite loop. See _workspace/T-048-ux-onboarding-brief/
          domain-brief.md for the full ADR. */}
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <OnboardingPage />
          </ProtectedRoute>
        }
      />

      {/* T-118: /redeem-invite is the beta-gate page that appears after
          Google login when /me reports `needs_beta_invite: true`. It is
          chromeless (no AppLayout) and intentionally NOT inside
          OnboardingGuard — same invariant as /onboarding (the guard
          exists to push users INTO the gate, not redirect away from it).
          See _workspace/T-117-ux-brief-redeem-invite-page/domain-brief.md
          Section 1 + Section 2 for the full ADR. */}
      <Route
        path="/redeem-invite"
        element={
          <ProtectedRoute>
            <RedeemInvitePage />
          </ProtectedRoute>
        }
      />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        {/* /mgr/:token — Manager Input Form. Protected but NOT wrapped in
            OnboardingGuard — managers may not need onboarding. Token-based. */}
        <Route path="/mgr/:token" element={<ManagerInputPage />} />

        {/* L-02: every non-onboarding protected route goes through
            OnboardingGuard so users with onboardingRequired=true cannot
            bypass onboarding by navigating directly. */}
        <Route element={<GuardedOutlet />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/cases/new" element={<CaseNewPage />} />
          <Route path="/cases/:id" element={<CaseDetailPage />} />
          <Route path="/cases/:id/decision" element={<DecisionPage />} />
          <Route path="/cases/:id/checklist" element={<ChecklistPage />} />
          <Route path="/cases/:id/timeline" element={<TimelinePage />} />
          <Route
            path="/employees"
            element={
              <RoleGuard allowedRoles={['super_admin', 'hr']}>
                <EmployeesPage />
              </RoleGuard>
            }
          />
          <Route path="/cases/:id/letters" element={<LettersPage />} />
          <Route
            path="/cases/:id/medical-request"
            element={
              <RoleGuard allowedRoles={['super_admin', 'hr']}>
                <MedicalRequestPage />
              </RoleGuard>
            }
          />
          <Route
            path="/cases/:id/ai-analysis"
            element={
              <RoleGuard allowedRoles={['super_admin', 'hr']}>
                <AIAnalysisPage />
              </RoleGuard>
            }
          />
          <Route
            path="/cases/:id/pwfa-fast-track"
            element={
              <RoleGuard allowedRoles={['super_admin', 'hr']}>
                <PwfaFastTrackPage />
              </RoleGuard>
            }
          />
          <Route
            path="/cases/:id/pwfa-interim"
            element={
              <RoleGuard allowedRoles={['super_admin', 'hr', 'manager']}>
                <PwfaInterimPage />
              </RoleGuard>
            }
          />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      {/* L-04: route unknown and root paths directly; no double-hop via /dashboard. */}
      <Route path="/" element={<CatchAllRedirect />} />
      <Route path="*" element={<CatchAllRedirect />} />
    </Routes>
  );
}
