import { StickyNav } from '@/components/StickyNav';
import { Hero } from '@/components/Hero';
import { ValueProps } from '@/components/ValueProps';
import { BetaSignupForm } from '@/components/BetaSignupForm';
import { Footer } from '@/components/Footer';

/**
 * Landing page composition — section order per acmd-ux brief §5.1
 * (Top → Bottom): sticky nav → hero → value props → beta signup → footer.
 *
 * Skip-link target is <main>. The sticky nav sits outside <main> so screen
 * readers who use the skip-link reach the hero heading immediately without
 * re-reading the global navigation on every page.
 */
export function LandingPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <StickyNav />
      <main id="main" tabIndex={-1}>
        <Hero />
        <ValueProps />
        <BetaSignupForm />
      </main>
      <Footer />
    </>
  );
}
