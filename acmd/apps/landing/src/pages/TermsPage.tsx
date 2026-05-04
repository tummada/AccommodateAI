import { Footer } from '@/components/Footer';
import { StickyNav } from '@/components/StickyNav';

/**
 * Terms stub page — acmd-ux brief §11 issue 8.
 *
 * Day 1 acceptance: a clickable, navigable page so the Footer "Terms" link
 * is not a dead end. Full ROSCA / FTC §5 / California ARL-compliant Terms
 * land in a follow-up task owned by acmd-legal before general availability.
 */
export function TermsPage() {
  return (
    <>
      <StickyNav />
      <main id="main" tabIndex={-1} className="bg-surface">
        <article className="container max-w-3xl py-16 text-text">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-text-muted">
            Last updated: April 2026 (Beta — interim notice)
          </p>

          <section aria-labelledby="beta-only" className="mt-10 space-y-4">
            <h2 id="beta-only" className="text-xl font-semibold">
              Founder Beta participation
            </h2>
            <p>
              AccommodateAI is currently in Founder Beta, limited to 50
              invited customers. Access is provided as-is during the Beta
              period. Full Terms of Service — including service-level terms,
              auto-renewal disclosures, and cancellation procedures — will be
              published before general availability. Beta participants will be
              notified by email at least 7 days before any change that affects
              their account.
            </p>
          </section>

          <section aria-labelledby="contact" className="mt-8 space-y-4">
            <h2 id="contact" className="text-xl font-semibold">
              Contact
            </h2>
            <p>
              Questions about these terms? Email{' '}
              <a
                href="mailto:hello@accommodate.vollos.ai"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                hello@accommodate.vollos.ai
              </a>
              .
            </p>
          </section>
        </article>
      </main>
      <Footer />
    </>
  );
}
