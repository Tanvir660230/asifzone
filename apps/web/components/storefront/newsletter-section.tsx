import { NewsletterForm } from "./newsletter-form";

export function NewsletterSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
      <p className="mb-2 text-xs uppercase tracking-[0.3em] text-brass-500">Newsletter</p>
      <h2 className="mb-3 font-display text-2xl text-ink-900">Join the list</h2>
      <p className="mx-auto mb-6 max-w-md text-sm text-ink-500">
        New arrivals, flash sales, and considered style notes — no spam, unsubscribe any time.
      </p>
      <div className="flex justify-center">
        <NewsletterForm variant="light" />
      </div>
    </section>
  );
}
