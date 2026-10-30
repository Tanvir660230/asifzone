import { DEFAULT_TRUST_STRIP_ITEMS } from "@clothing-brand/shared";
import { resolveHomepageIcon } from "@/lib/homepage-icons";

export interface TrustStripItem {
  icon: string;
  label: string;
}

const DEFAULT_ITEMS: TrustStripItem[] = [...DEFAULT_TRUST_STRIP_ITEMS];

/** The store's promises, as one quiet band: a two-column grid on phones (every promise in view, none cut off at the
 * screen edge), an evenly divided row from 1024px. Each promise is a readable sentence-size label beside its icon, not a
 * tiny caps caption. */
export function TrustStrip({ items = DEFAULT_ITEMS }: { items?: TrustStripItem[] }) {
  return (
    <section aria-label="Our promises" className="border-y border-line-subtle bg-surface">
      <ul className="mx-auto grid max-w-7xl grid-cols-2 gap-x-3 gap-y-4 px-4 py-5 sm:px-6 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(0,1fr))] lg:gap-0 lg:divide-x lg:divide-line-subtle lg:px-8 lg:py-6">
        {items.map(({ icon, label }) => {
          const Icon = resolveHomepageIcon(icon);
          return (
            <li
              key={label}
              className="flex min-w-0 items-center gap-2.5 lg:justify-center lg:gap-3 lg:px-6"
            >
              <span className="flex h-[var(--icon-chip-size,2.25rem)] w-[var(--icon-chip-size,2.25rem)] shrink-0 items-center justify-center rounded-full bg-[color:var(--icon-chip-bg,rgb(var(--color-surface-muted)))] text-ink-900">
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="text-[0.8125rem] font-medium leading-snug text-ink-900 sm:text-sm lg:whitespace-nowrap">{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
