import type { Metadata } from "next";
import Link from "next/link";
import { Truck, MapPin, Wallet, PackageCheck, Ban } from "lucide-react";
import { getSiteSettings } from "@/lib/api/storefront";
import { getSiteUrl, buildOpenGraph } from "@/lib/seo";
import { PageHero } from "@/components/storefront/page-hero";

// Now does a real server-side settings fetch for the og:image fallback below — without this,
// `next build` would try to statically prerender the page and fail (the api container isn't
// reachable during the Docker image build). Same reasoning as apps/web/app/(storefront)/page.tsx.
export const dynamic = "force-dynamic";

const TITLE = "Shipping & Returns";
const DESCRIPTION = "Delivery timelines, shipping fees, and our return & exchange policy.";

// A content page like this has no photo of its own — falls back to the store logo rather than
// shipping no og:image at all, so a share still renders a card instead of a blank/generic one.
export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getSiteSettings();
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: `${getSiteUrl()}/shipping-returns` },
    ...buildOpenGraph({
      title: TITLE,
      description: DESCRIPTION,
      url: `${getSiteUrl()}/shipping-returns`,
      images: settings.logoUrl ? [settings.logoUrl] : undefined,
    }),
  };
}

const SHIPPING_FACTS = [
  {
    icon: Truck,
    title: "Order processing",
    body: "Every order is packed and dispatched within 1–2 business days of being placed.",
  },
  {
    icon: MapPin,
    title: "Delivery time",
    body: "Inside Dhaka: 1–2 business days. Outside Dhaka: 3–5 business days via courier.",
  },
  {
    icon: Wallet,
    title: "Cash on Delivery",
    body: "Available on every order, nationwide — pay when your parcel arrives at your door.",
  },
];

const RETURN_STEPS = [
  {
    step: "1",
    title: "Get in touch",
    body: (
      <>
        Reach us via the{" "}
        <Link href="/contact" className="text-ink-900 underline underline-offset-2 hover:text-brass-500">
          contact page
        </Link>{" "}
        within 7 days of delivery with your order number.
      </>
    ),
  },
  {
    step: "2",
    title: "Pack it up",
    body: "Keep the item unworn, in its original condition, with all tags still attached.",
  },
  {
    step: "3",
    title: "We take it from there",
    body: "Once received and inspected, we'll process your exchange or refund and confirm by phone or email.",
  },
];

export default function ShippingReturnsPage() {
  return (
    <div>
      <PageHero
        eyebrow="Delivery & aftercare"
        title="Shipping & Returns"
        description="What to expect after you check out — from dispatch to doorstep, and how to send something back if it's not quite right."
      />

      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <section className="mb-16">
          <h2 className="mb-6 text-xs uppercase tracking-[0.2em] text-ink-400">Shipping</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {SHIPPING_FACTS.map((fact) => (
              <div key={fact.title} className="rounded-2xl border border-ink-100 bg-cream-50 p-6">
                <span className="glossy mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-brass-100 text-brass-600">
                  <fact.icon size={18} />
                </span>
                <h3 className="mb-1.5 font-display text-base text-ink-900">{fact.title}</h3>
                <p className="text-sm leading-relaxed text-ink-500">{fact.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-xs uppercase tracking-[0.2em] text-ink-400">Returns &amp; Exchanges</h2>

          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-ink-100 bg-cream-50 p-6">
            <PackageCheck size={20} className="mt-0.5 shrink-0 text-ink-400" />
            <p className="text-sm leading-relaxed text-ink-700">
              Unworn items in original condition with tags attached can be returned or exchanged within{" "}
              <strong className="font-semibold text-ink-900">7 days</strong> of delivery.
            </p>
          </div>

          <ol className="mb-6 space-y-5">
            {RETURN_STEPS.map((s) => (
              <li key={s.step} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-900 text-sm font-medium text-cream-50">
                  {s.step}
                </span>
                <div>
                  <h3 className="mb-1 text-sm font-medium text-ink-900">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-ink-500">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="flex items-start gap-3 rounded-2xl border border-dashed border-ink-200 p-5">
            <Ban size={18} className="mt-0.5 shrink-0 text-ink-400" />
            <p className="text-sm leading-relaxed text-ink-500">
              Items marked <strong className="font-medium text-ink-700">final sale</strong> are not eligible for return
              or exchange.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
