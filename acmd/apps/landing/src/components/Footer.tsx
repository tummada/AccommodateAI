/**
 * Footer — acmd-ux brief §5.5.
 *  - "AccommodateAI by VOLLOS" wordmark
 *  - Four inline links: vollos.ai (external) · Privacy (/privacy stub) ·
 *    Terms (/terms stub) · Contact (mailto:hello@accommodate.vollos.ai)
 *  - Copyright © 2026 VOLLOS
 *
 * The vollos.ai link is the umbrella-brand backreference (D13). It opens in
 * a new tab with rel="noopener noreferrer" so the parent landing page is
 * isolated from window.opener tampering.
 */
export function Footer() {
  return (
    <footer
      role="contentinfo"
      className="border-t border-border bg-bg py-10 text-sm text-text-muted"
    >
      <div className="container flex flex-col items-center gap-3 text-center">
        <p className="font-semibold text-text">AccommodateAI by VOLLOS</p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap items-center justify-center gap-x-1 gap-y-2">
            <li>
              <a
                href="https://vollos.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="px-2 py-1 hover:text-text hover:underline"
              >
                vollos.ai
              </a>
            </li>
            <li aria-hidden="true">·</li>
            <li>
              <a
                href="/privacy"
                className="px-2 py-1 hover:text-text hover:underline"
              >
                Privacy
              </a>
            </li>
            <li aria-hidden="true">·</li>
            <li>
              <a
                href="/terms"
                className="px-2 py-1 hover:text-text hover:underline"
              >
                Terms
              </a>
            </li>
            <li aria-hidden="true">·</li>
            <li>
              <a
                href="mailto:hello@accommodate.vollos.ai"
                className="px-2 py-1 hover:text-text hover:underline"
              >
                Contact
              </a>
            </li>
          </ul>
        </nav>
        <p>&copy; 2026 VOLLOS</p>
      </div>
    </footer>
  );
}
