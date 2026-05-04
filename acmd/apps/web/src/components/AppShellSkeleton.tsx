/**
 * AppShellSkeleton — bootstrap loading placeholder that mirrors AppLayout.
 *
 * ACMD-116 §3: rendered while the refresh probe is in flight so the user
 * never sees a flash of the login page on page reload. Shape intentionally
 * mirrors `<AppLayout>` (topbar + sidebar + main) so the hand-off is
 * visually continuous once data lands.
 */
import { useEffect, useState } from 'react';

interface AppShellSkeletonProps {
  /** Delay in ms before the skeleton becomes visible (ACMD-116 R5 anti-flash). */
  delayMs?: number;
}

export function AppShellSkeleton({ delayMs = 300 }: AppShellSkeletonProps) {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) return;
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  if (!visible) {
    // Under 300ms: render nothing so bootstrap feels instant.
    return <div aria-hidden="true" data-testid="skeleton-hidden" />;
  }

  return (
    <div
      className="flex min-h-screen bg-bg"
      role="status"
      aria-live="polite"
      aria-label="Loading workspace"
      data-testid="app-shell-skeleton"
    >
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface p-4 lg:flex">
        <div className="mb-6 h-8 w-32 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 w-full animate-pulse rounded bg-muted" />
          ))}
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-6">
          <div className="h-6 w-40 animate-pulse rounded bg-muted" />
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
            <div className="hidden h-6 w-24 animate-pulse rounded bg-muted sm:block" />
          </div>
        </header>
        <main className="flex-1 p-6">
          <div className="mb-4 h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        </main>
      </div>
      <span className="sr-only">Loading your workspace…</span>
    </div>
  );
}
