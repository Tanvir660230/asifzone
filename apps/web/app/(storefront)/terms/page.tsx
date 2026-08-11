import type { Metadata } from "next";
import { getSiteSettings } from "@/lib/api/storefront";
import { getSiteUrl, buildOpenGraph } from "@/lib/seo";
import { PageHero } from "@/components/storefront/page-hero";

// Now does a real server-side settings fetch for the og:image fallback below — without this,
// `next build` would try to statically prerender the page and fail (the api container isn't
// reachable during the Docker image build). Same reasoning as apps/web/app/(storefront)/page.tsx.
export const dynamic = "force-dynamic";

const TITLE = "Terms & Conditions";
const DESCRIPTION = "The terms that govern your use of this store and orders placed with us.";

// A content page like this has no photo of its own — falls back to the store logo rather than
// shipping no og:image at all, so a share still renders a card instead of a blank/generic one.
export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getSiteSettings();
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: `${getSiteUrl()}/terms` },
    ...buildOpenGraph({
      title: TITLE,
      description: DESCRIPTION,
      url: `${getSiteUrl()}/terms`,
      images: settings.logoUrl ? [settings.logoUrl] : undefined,
    }),
  };
}

const LAST_UPDATED = "August 10, 2026";

const SECTIONS = [
  {
    id: "orders",
    title: "Orders",
    body: (
      <p>
        By placing an order, you confirm that the shipping details and items in your cart are correct. We reserve
        the right to cancel an order if an item turns out to be unavailable or mispriced, in which case you&rsquo;ll
        be notified and refunded in full.
      </p>
    ),
  },
  {
    id: "pricing",
    title: "Pricing & Availability",
    body: (
      <p>
        Prices are listed in the currency shown at checkout and may change without notice. The price charged is the
        one shown at the time your order is placed, not any earlier or later price for the same item.
      </p>
    ),
  },
  {
    id: "payment",
    title: "Payment",
    body: (
      <p>
        We accept the payment methods shown at checkout, including Cash on Delivery. For prepaid methods, your order
        is only confirmed once payment is successfully processed by our payment partner.
      </p>
    ),
  },
  {
    id: "shipping",
    title: "Shipping & Delivery",
    body: (
      <p>
        Delivery timelines and fees are outlined on our{" "}
        <a href="/shipping-returns" className="text-ink-900 underline underline-offset-2 hover:text-brass-500">
          Shipping &amp; Returns
        </a>{" "}
        page. Timelines are estimates — occasional delays from courier partners are outside our control.
      </p>
    ),
  },
  {
    id: "returns",
    title: "Returns & Refunds",
    body: (
      <p>
        Our return and exchange window, eligibility, and process are detailed on the same{" "}
        <a href="/shipping-returns" className="text-ink-900 underline underline-offset-2 hover:text-brass-500">
          Shipping &amp; Returns
        </a>{" "}
        page. Refunds are issued to the original payment method, or as store credit where applicable.
      </p>
    ),
  },
  {
    id: "account",
    title: "Your Account",
    body: (
      <p>
        You&rsquo;re responsible for keeping your account password confidential and for all activity that happens
        under your account. Let us know immediately if you suspect unauthorized access.
      </p>
    ),
  },
  {
    id: "intellectual-property",
    title: "Intellectual Property",
    body: (
      <p>
        All product photography, branding, and content on this site belong to us or our licensors and may not be
        reused without permission.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of Liability",
    body: (
      <p>
        We aim for every order to arrive as described, but to the extent permitted by law, we&rsquo;re not liable for
        indirect or incidental losses arising from delayed delivery, product unavailability, or use of this site.
      </p>
    ),
  },
  {
    id: "governing-law",
    title: "Governing Law",
    body: <p>These terms are governed by the laws of Bangladesh.</p>,
  },
  {
    id: "changes",
    title: "Changes to These Terms",
    body: (
      <p>
        We may update these terms as our services evolve. Continued use of the site after a change means you accept
        the updated terms.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions about these terms can be sent via the{" "}
        <a href="/contact" className="text-ink-900 underline underline-offset-2 hover:text-brass-500">
          contact page
        </a>
        .
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <div>
      <PageHero
        eyebrow={`Last updated ${LAST_UPDATED}`}
        title="Terms & Conditions"
        description="The ground rules for shopping with us — please give it a read before you check out."
      />

      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
          <nav aria-label="Table of contents" className="hidden lg:block">
            <div className="sticky top-28 space-y-1 border-l border-ink-100 pl-4">
              {SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="block py-1 text-sm text-ink-500 transition-colors duration-150 ease-smooth hover:text-ink-900"
                >
                  {section.title}
                </a>
              ))}
            </div>
          </nav>

          <div className="max-w-2xl space-y-10 text-sm leading-relaxed text-ink-700">
            {SECTIONS.map((section, i) => (
              <section key={section.id} id={section.id} className="scroll-mt-28">
                <h2 className="mb-3 flex items-baseline gap-2 font-display text-lg text-ink-900">
                  <span className="text-xs font-normal text-ink-300">{String(i + 1).padStart(2, "0")}</span>
                  {section.title}
                </h2>
                <div className="space-y-3">{section.body}</div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
