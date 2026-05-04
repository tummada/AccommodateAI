import { WEB_LOGIN_URL } from '@/lib/api';

/**
 * Top sticky nav per acmd-ux brief §5.1 (height ~64px, "VOLLOS logo" left,
 * "Sign in" + "Beta CTA" right). The Beta CTA scrolls smoothly to the
 * #beta-signup form; "Sign in" links to the dashboard /login on
 * accommodate-app.vollos.ai (different subdomain → full URL, not a
 * react-router Link).
 */
export function StickyNav() {
  return (
    <header
      role="banner"
      className="sticky top-0 z-40 h-16 border-b border-border bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75"
    >
      <div className="container flex h-full items-center justify-between">
        <a
          href="/"
          aria-label="AccommodateAI by VOLLOS — home"
          className="flex items-center gap-2 text-text font-semibold tracking-tight"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold"
          >
            A
          </span>
          <span className="text-base">
            AccommodateAI <span className="text-text-muted font-normal">by VOLLOS</span>
          </span>
        </a>
        <nav aria-label="Primary" className="flex items-center gap-2">
          <a
            href={WEB_LOGIN_URL}
            className="hidden sm:inline-flex h-10 items-center rounded-md px-4 text-sm font-medium text-text hover:text-primary"
          >
            Sign in
          </a>
          <a
            href="#beta-signup"
            aria-label="Request Beta Access — scroll to signup form"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            Request Beta Access
          </a>
        </nav>
      </div>
    </header>
  );
}
