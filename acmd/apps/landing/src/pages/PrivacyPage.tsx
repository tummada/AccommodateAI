import { Footer } from '@/components/Footer';
import { StickyNav } from '@/components/StickyNav';

/**
 * Privacy stub page — acmd-ux brief §11 issue 8 + acmd-legal brief §3.4.
 *
 * Day 1 acceptance: a clickable, navigable page so the Beta signup
 * "Privacy Policy" link is not a dead end. Real CCPA / PDPA / FTC ROSCA
 * record-retention language is owned by acmd-legal and lands in a follow-up
 * task before launch (Lead has flagged this).
 *
 * The disclosure block below uses the exact prose from acmd-legal's brief
 * §3.4 (Privacy / Data Handling Notice) so the consent record disclosure is
 * legally aligned even on Day 1, even though full policy sections are
 * pending.
 */
export function PrivacyPage() {
  return (
    <>
      <StickyNav />
      <main id="main" tabIndex={-1} className="bg-surface">
        <article className="container max-w-3xl py-16 text-text">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-text-muted">
            Last updated: April 2026 (Beta — interim notice)
          </p>

          <section aria-labelledby="overview" className="mt-10 space-y-4">
            <h2 id="overview" className="text-xl font-semibold">
              Overview
            </h2>
            <p>
              AccommodateAI is a product of VOLLOS, Inc. We collect the minimum
              information needed to manage your Beta invitation and, if you
              choose to sign up, your accommodation cases. This page is an
              interim notice for Founder Beta participants. The full Privacy
              Policy will be published before general availability.
            </p>
          </section>

          <section
            aria-labelledby="what-we-collect"
            className="mt-8 space-y-4"
          >
            <h2 id="what-we-collect" className="text-xl font-semibold">
              Information we collect during Beta signup
            </h2>
            <ul className="list-disc space-y-2 pl-6">
              <li>Your email address.</li>
              <li>The invite token you submit.</li>
              <li>
                A consent record (timestamp, IP address, browser information,
                and the exact terms you agreed to).
              </li>
            </ul>
          </section>

          <section
            aria-labelledby="consent-record"
            className="mt-8 space-y-4 rounded-md border border-border bg-bg p-6"
          >
            <h2 id="consent-record" className="text-xl font-semibold">
              Consent record retention
            </h2>
            <p>
              We will store your consent record (timestamp, IP address, browser
              information, and the exact terms you agreed to) for at least
              three years to comply with US consumer protection law (FTC
              ROSCA, 15 USC 8403; California Business &amp; Professions Code
              §17602). You can request a copy or deletion of this record at
              any time by emailing{' '}
              <a
                href="mailto:privacy@accommodate.vollos.ai"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                privacy@accommodate.vollos.ai
              </a>
              .
            </p>
          </section>

          <section aria-labelledby="rights" className="mt-8 space-y-4">
            <h2 id="rights" className="text-xl font-semibold">
              Your rights
            </h2>
            <p>
              California residents have the right to request access, deletion,
              and correction of personal information under the California
              Consumer Privacy Act (Cal. Civ. Code §1798.100 et seq.). EU and
              UK residents have equivalent rights under the GDPR. To exercise
              any of these rights, email{' '}
              <a
                href="mailto:privacy@accommodate.vollos.ai"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                privacy@accommodate.vollos.ai
              </a>
              . We respond within 30 days.
            </p>
          </section>

          <section aria-labelledby="gpc" className="mt-8 space-y-4">
            <h2 id="gpc" className="text-xl font-semibold">
              Global Privacy Control
            </h2>
            <p>
              If your browser sends a Global Privacy Control signal
              (<code className="rounded bg-bg px-1 py-0.5 font-mono text-sm">
                Sec-GPC: 1
              </code>
              ), we honor it as an opt-out request for the sale or sharing of
              personal information under the California Consumer Privacy Act
              (Cal. Civ. Code §1798.135). AccommodateAI does not sell or share
              personal information today, and if that ever changes the GPC
              signal will continue to be honored automatically. Learn more at{' '}
              <a
                href="https://globalprivacycontrol.org"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                globalprivacycontrol.org
              </a>
              .
            </p>
          </section>

          <section aria-labelledby="contact" className="mt-8 space-y-4">
            <h2 id="contact" className="text-xl font-semibold">
              Contact
            </h2>
            <p>
              Questions? Email{' '}
              <a
                href="mailto:privacy@accommodate.vollos.ai"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                privacy@accommodate.vollos.ai
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
