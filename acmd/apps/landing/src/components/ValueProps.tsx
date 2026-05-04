/**
 * Value-proposition cards — acmd-ux brief §5.3 ("Built for HR teams that
 * aren't tax lawyers"). Brief recommends shipping 3 cards Day 1 (1, 2, 3 from
 * the table), adding 4 + 5 in week 2. Visual rhythm: 3 columns on desktop,
 * single column stack ≤768px.
 */

type ValueCard = {
  title: string;
  body: string;
};

const cards: ValueCard[] = [
  {
    title: 'Compliance guardrails built in',
    body:
      "We track ADA, PWFA, and EEOC interactive process automatically. The system tells you what's missing before you ship a denial that triggers a lawsuit.",
  },
  {
    title: '40 minutes saved per case',
    body:
      'AI drafts the acknowledgment letter, the medical info request, and the decision letter. You review and send.',
  },
  {
    title: 'Audit trail your lawyer will love',
    body:
      'Every action timestamped, every document versioned, every decision justified. Export the full case packet as PDF in one click.',
  },
];

export function ValueProps() {
  return (
    <section
      aria-labelledby="value-props-heading"
      className="border-t border-border bg-bg py-20"
    >
      <div className="container">
        <div className="mx-auto max-w-3xl text-center">
          <h2
            id="value-props-heading"
            className="text-3xl font-bold tracking-tight text-text md:text-4xl"
          >
            Built for HR teams that aren't tax lawyers
          </h2>
          <p className="mt-4 text-lg text-text-muted">
            For 15-500 employee teams. Cleaner than enterprise tools, deeper
            than spreadsheets.
          </p>
        </div>
        <ul className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
          {cards.map((card) => (
            <li
              key={card.title}
              className="rounded-lg border border-border bg-surface p-6 shadow-card"
            >
              <h3 className="text-lg font-semibold text-text">{card.title}</h3>
              <p className="mt-3 text-base text-text-muted">{card.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
