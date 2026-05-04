/**
 * Hero section — acmd-ux brief §5.2.
 *  - h1 = "AccommodateAI by VOLLOS" (D13 umbrella brand positioning)
 *  - h2 = compliance-anxiety tagline
 *  - sub-copy = US HR audience reassurance
 *  - Primary CTA = "Request Beta Access →" → smooth-scroll to #beta-signup
 *
 * Per brief §5.2, the secondary "Watch 2-min demo" button is intentionally
 * omitted Day 1 — there is no demo video to link to and shipping a dead
 * button is worse than shipping a single CTA.
 */
export function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative overflow-hidden bg-gradient-to-b from-surface to-bg"
    >
      <div className="container py-20 md:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-text-muted">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full bg-primary"
            />
            Founder Beta — limited to 20 founding customers
          </p>
          <h1
            id="hero-heading"
            className="text-4xl font-bold tracking-tight text-text md:text-5xl"
          >
            AccommodateAI <span className="text-text-muted">by VOLLOS</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-xl text-text md:text-2xl">
            ADA + PWFA accommodation management that doesn't require a law degree.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-base text-text-muted md:text-lg">
            Built for US HR teams managing accommodation requests. Compliance
            guardrails built in — so you handle every case correctly, even if
            you've never read EEOC guidelines.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="#beta-signup"
              aria-label="Request Beta Access — scroll to signup form"
              className="inline-flex h-12 min-w-[12rem] items-center justify-center rounded-md bg-primary px-8 text-base font-semibold text-primary-foreground shadow-card hover:bg-primary-hover"
            >
              Request Beta Access
              <span aria-hidden="true" className="ml-2">
                &rarr;
              </span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
