interface PageHeroProps {
  eyebrow: string;
  title: string;
  description?: string;
}

/** Shared header band for standalone content pages (Contact, FAQ, Shipping & Returns, Privacy,
 * Terms) — gives every one of them the same confident, editorial opening instead of a bare `<h1>`
 * dropped straight into the page body, matching the eyebrow/display-heading language used
 * elsewhere on the storefront (see BrandStory). */
export function PageHero({ eyebrow, title, description }: PageHeroProps) {
  return (
    <div className="border-b border-ink-100 bg-cream-100">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-20 lg:px-8">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-brass-500">{eyebrow}</p>
        <h1 className="font-display text-4xl text-ink-900 sm:text-5xl">{title}</h1>
        {description && (
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-ink-500 sm:text-base">{description}</p>
        )}
      </div>
    </div>
  );
}
