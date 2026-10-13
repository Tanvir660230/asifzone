import { NewsletterForm } from "./newsletter-form";
import { Reveal } from "./reveal";

interface NewsletterSectionProps {
  heading?: string | null;
  bodyText?: string | null;
}

/** An email sign-up band (NEWSLETTER): the invitation on the left, the form beside it from 1024px. */
export function NewsletterSection({ heading, bodyText }: NewsletterSectionProps) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-[calc(3.5rem*var(--section-rhythm))] sm:px-6 lg:px-8">
      <Reveal className="grid items-center gap-8 border-y border-line py-10 lg:grid-cols-2 lg:gap-16 lg:py-12">
        <div>
          <h2 className="ui-section-heading font-display text-fg">{heading || "Be the first to know"}</h2>
          <p className="mt-3 max-w-[48ch] text-sm leading-relaxed text-fg-muted sm:text-base">
            {bodyText || "New arrivals, restocks and offers — straight to your inbox. No spam."}
          </p>
        </div>
        <NewsletterForm variant="light" />
      </Reveal>
    </section>
  );
}
