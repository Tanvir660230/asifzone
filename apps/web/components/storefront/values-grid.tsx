import { DEFAULT_VALUES_GRID_ITEMS } from "@clothing-brand/shared";
import { resolveHomepageIcon } from "@/lib/homepage-icons";
import { Reveal } from "./reveal";

export interface ValuesGridItem {
  icon: string;
  title: string;
  description: string;
}

const DEFAULT_VALUES: ValuesGridItem[] = [...DEFAULT_VALUES_GRID_ITEMS];

interface ValuesGridProps {
  storeName: string;
  eyebrow?: string | null;
  heading?: string | null;
  items?: ValuesGridItem[];
}

/** What the store stands for, set editorially: the heading holds the left column (sticky beside the list from 1024px)
 * and the values read as a two-column list divided by hairlines, not a row of identical boxed cards. */
export function ValuesGrid({ storeName, eyebrow, heading, items = DEFAULT_VALUES }: ValuesGridProps) {
  return (
    <section className="py-[calc(3.5rem*var(--section-rhythm))] sm:py-[calc(5rem*var(--section-rhythm))]">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:px-8">
        <Reveal className="lg:col-span-4">
          <div className="lg:sticky lg:top-[calc(var(--sticky-top)+2rem)]">
            <p className="mb-3 text-xs ui-eyebrow text-fg-muted">{eyebrow || `Why ${storeName}`}</p>
            <h2 className="ui-section-heading font-display text-ink-900">{heading || "What We Stand For"}</h2>
          </div>
        </Reveal>
        <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:col-span-8">
          {items.map(({ icon, title, description }, i) => {
            const Icon = resolveHomepageIcon(icon);
            return (
              <Reveal as="li" key={title} index={i % 2} className="border-t border-line pt-6">
                <Icon className="mb-5 text-ink-900" size={26} strokeWidth={1.5} aria-hidden="true" />
                <h3 className="mb-2 font-display text-xl text-ink-900">{title}</h3>
                <p className="max-w-[38ch] text-sm leading-relaxed text-ink-500">{description}</p>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
