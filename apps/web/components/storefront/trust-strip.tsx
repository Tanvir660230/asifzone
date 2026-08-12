import { resolveHomepageIcon } from "@/lib/homepage-icons";

export interface TrustStripItem {
  icon: string;
  label: string;
}

const DEFAULT_ITEMS: TrustStripItem[] = [
  { icon: "Truck", label: "Nationwide Delivery" },
  { icon: "RotateCcw", label: "7-Day Easy Returns" },
  { icon: "ShieldCheck", label: "Authentic Quality" },
  { icon: "Banknote", label: "Cash on Delivery" },
];

export function TrustStrip({ items = DEFAULT_ITEMS }: { items?: TrustStripItem[] }) {
  return (
    <section className="border-y border-ink-100 bg-cream-50">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-8 sm:px-6 lg:grid-cols-4 lg:px-8">
        {items.map(({ icon, label }) => {
          const Icon = resolveHomepageIcon(icon);
          return (
            <div key={label} className="flex items-center justify-center gap-3 text-center sm:justify-start">
              <Icon size={20} className="shrink-0 text-brass-500" />
              <span className="text-xs uppercase tracking-wide text-ink-600">{label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
