/** @type {import('tailwindcss').Config} */
// Reuses apps/web token palette so landing + dashboard feel like one product.
// (acmd-ui brief §8: "use component pattern เดียวกับ apps/web (shadcn/ui +
// Tailwind) เพื่อ reuse design tokens".) If apps/web tailwind.config.js
// changes its palette, this file must be updated to match — they are the
// same brand surface seen by the same user across two subdomains.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: {
        '2xl': '1280px',
      },
    },
    extend: {
      colors: {
        bg: {
          DEFAULT: '#F8FAFC',
        },
        surface: {
          DEFAULT: '#FFFFFF',
        },
        text: {
          DEFAULT: '#0F172A',
          muted: '#475569',
        },
        border: {
          DEFAULT: '#E2E8F0',
          strong: '#CBD5E1',
        },
        // Emerald primary per acmd-ux brief §5.2 (Beta CTA emerald-600).
        // 5.48:1 contrast white-on-emerald-700 (#047857) — passes WCAG AA body
        // (≥4.5:1). Measured by QA in T-060 review (review-qa.md L242).
        primary: {
          DEFAULT: '#047857',
          hover: '#065F46',
          foreground: '#FFFFFF',
        },
        accent: {
          DEFAULT: '#047857',
          foreground: '#FFFFFF',
        },
        destructive: {
          DEFAULT: '#B91C1C',
          foreground: '#FFFFFF',
        },
        ring: '#047857',
      },
      fontFamily: {
        // T-069 / Auditor SEC-002: dropped Google-hosted "Inter" — Tailwind
        // now falls back to the OS-native sans stack (San Francisco on
        // macOS/iOS, Segoe UI on Windows, Roboto on Android). No external
        // font request, no SRI gap, no GDPR-style IP leak to Google.
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: {
        lg: '12px',
        md: '8px',
        sm: '6px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(15,23,42,0.08), 0 4px 16px rgba(15,23,42,0.05)',
      },
    },
  },
  plugins: [],
};
