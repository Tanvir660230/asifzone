import { DEFAULT_TRUST_STRIP_ITEMS } from "@clothing-brand/shared";
import { resolveHomepageIcon } from "@/lib/homepage-icons";

export interface TrustStripItem {
  icon: string;
  label: string;
}

const DEFAULT_ITEMS: TrustStripItem[] = [...DEFAULT_TRUST_STRIP_ITEMS];

/** The store's promises, as one quiet band: a swipeable row on phones, an evenly divided row from 1024px. Each promise
 * is a readable sentence-size label beside its icon, not a tiny caps caption. */
export function TrustStrip({ items = DEFAULT_ITEMS }: { items?: TrustStripItem[] }) {
  return (
    <section aria-label="Our promises" className="border-y border-line-subtle bg-surface">
      {/* Focusable, so a keyboard user can scroll the row on a phone (where it overflows). */}
      <ul tabIndex={0} className="ui-rail mx-auto flex max-w-7xl snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-5 sm:px-6 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(0,1fr))] lg:gap-0 lg:divide-x lg:divide-line-subtle lg:px-8 lg:py-6">
        {items.map(({ icon, label }) => {
          const Icon = resolveHomepageIcon(icon);
          return (
            <li
              key={label}
              className="flex shrink-0 snap-start items-center gap-3 rounded-full border border-line-subtle py-2 pl-2 pr-4 lg:justify-center lg:rounded-none lg:border-0 lg:px-6 lg:py-0"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-900">
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="whitespace-nowrap text-sm font-medium text-ink-900">{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
