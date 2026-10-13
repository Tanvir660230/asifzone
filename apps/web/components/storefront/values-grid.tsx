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
    <section className="py-[calc(3rem*var(--section-rhythm))] sm:py-[calc(5rem*var(--section-rhythm))]">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:gap-10 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:px-8">
        <Reveal className="lg:col-span-4">
          <div className="lg:sticky lg:top-[calc(var(--sticky-top)+2rem)]">
            <p className="mb-3 text-xs ui-eyebrow text-fg-muted">{eyebrow || `Why ${storeName}`}</p>
            <h2 className="ui-section-heading font-display text-ink-900">{heading || "What We Stand For"}</h2>
          </div>
        </Reveal>
        <ul className="grid gap-x-10 gap-y-6 sm:grid-cols-2 sm:gap-y-8 lg:col-span-8">
          {items.map(({ icon, title, description }, i) => {
            const Icon = resolveHomepageIcon(icon);
            return (
              <Reveal as="li" key={title} index={i % 2} className="border-t border-line pt-5 sm:pt-6">
                {/* Phones: the icon sits beside the title, so four values read as a short list instead of four screens. */}
                <div className="mb-2 flex items-center gap-3 sm:block">
                  <Icon className="shrink-0 text-ink-900 sm:mb-5" size={24} strokeWidth={1.5} aria-hidden="true" />
                  <h3 className="font-display text-xl text-ink-900 sm:mb-2">{title}</h3>
                </div>
                <p className="max-w-[38ch] text-sm leading-relaxed text-ink-500">{description}</p>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
