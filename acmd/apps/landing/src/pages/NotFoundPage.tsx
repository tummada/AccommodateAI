import { Footer } from '@/components/Footer';
import { StickyNav } from '@/components/StickyNav';

/**
 * Catch-all 404 — keeps unknown URLs (e.g. SPA deep-links arriving via
 * browser refresh) navigable instead of bouncing to a blank page. nginx is
 * configured to fall back to index.html for unknown paths so this React
 * route renders for any non-asset URL.
 */
export function NotFoundPage() {
  return (
    <>
      <StickyNav />
      <main id="main" tabIndex={-1} className="bg-surface">
        <div className="container py-24 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            404
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-text md:text-4xl">
            Page not found
          </h1>
          <p className="mx-auto mt-4 max-w-md text-base text-text-muted">
            The page you're looking for doesn't exist or has moved.
          </p>
          <a
            href="/"
            className="mt-8 inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            Back to AccommodateAI
          </a>
        </div>
      </main>
      <Footer />
    </>
  );
}
