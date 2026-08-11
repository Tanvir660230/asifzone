import type { Metadata } from "next";
import { getSiteSettings } from "@/lib/api/storefront";
import { getSiteUrl, buildOpenGraph } from "@/lib/seo";
import { buildFaqJsonLd } from "@/lib/structured-data";
import { PageHero } from "@/components/storefront/page-hero";
import { FaqAccordion, type FaqGroup } from "@/components/storefront/faq-accordion";

// Now does a real server-side settings fetch for the og:image fallback below — without this,
// `next build` would try to statically prerender the page and fail (the api container isn't
// reachable during the Docker image build). Same reasoning as apps/web/app/(storefront)/page.tsx.
export const dynamic = "force-dynamic";

const TITLE = "FAQ";
const DESCRIPTION = "Answers to common questions about ordering, shipping, and returns.";

// A content page like this has no photo of its own — falls back to the store logo rather than
// shipping no og:image at all, so a share still renders a card instead of a blank/generic one.
export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getSiteSettings();
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: `${getSiteUrl()}/faq` },
    ...buildOpenGraph({
      title: TITLE,
      description: DESCRIPTION,
      url: `${getSiteUrl()}/faq`,
      images: settings.logoUrl ? [settings.logoUrl] : undefined,
    }),
  };
}

const FAQ_GROUPS: FaqGroup[] = [
  {
    category: "Orders & Products",
    items: [
      {
        question: "How do I place an order?",
        answer: "Add items to your cart, choose a size and color if applicable, then head to checkout and fill in your delivery details.",
      },
      {
        question: "Can I change or cancel my order after placing it?",
        answer:
          "Reach out via our contact page as soon as possible — we can usually adjust or cancel an order before it's dispatched.",
      },
      {
        question: "Do you restock sold-out items?",
        answer: "Popular sizes and styles are restocked when possible. Check back on the product page, or contact us to ask about a specific item.",
      },
    ],
  },
  {
    category: "Shipping & Delivery",
    items: [
      {
        question: "How long does delivery take?",
        answer: "Inside Dhaka: 1–2 business days. Outside Dhaka: 3–5 business days.",
      },
      {
        question: "Do you offer Cash on Delivery?",
        answer: "Yes — Cash on Delivery is available on every order, nationwide.",
      },
      {
        question: "Do you deliver outside Dhaka?",
        answer: "Yes, we deliver nationwide via courier partners, typically within 3–5 business days.",
      },
    ],
  },
  {
    category: "Returns & Exchanges",
    items: [
      {
        question: "Can I return or exchange an item?",
        answer:
          "Unworn items in original condition with tags attached can be returned or exchanged within 7 days of delivery. See our Shipping & Returns page for the full policy.",
      },
      {
        question: "How do I start a return?",
        answer: "Contact us with your order number within 7 days of delivery, and we'll walk you through the next steps.",
      },
      {
        question: "Are all items eligible for return?",
        answer: "Most items are, except those marked final sale at checkout — those are excluded from returns and exchanges.",
      },
    ],
  },
  {
    category: "Payment & Account",
    items: [
      {
        question: "What payment methods do you accept?",
        answer: "We accept Cash on Delivery along with the card and mobile-wallet options shown at checkout.",
      },
      {
        question: "Do I need an account to order?",
        answer: "No — you can check out as a guest. Creating an account just makes it faster to track orders and reorder later.",
      },
      {
        question: "How do I track my order?",
        answer: "Use the Track Order page with your order number and phone number to see live status.",
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFaqJsonLd(FAQ_GROUPS)) }}
      />
      <PageHero
        eyebrow="Got questions?"
        title="Frequently Asked Questions"
        description="Quick answers about ordering, shipping, and returns — still stuck? We're one message away."
      />

      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
        <FaqAccordion groups={FAQ_GROUPS} />

        <p className="mt-10 text-center text-sm text-ink-500">
          Still have a question?{" "}
          <a href="/contact" className="text-ink-900 underline underline-offset-2 hover:text-brass-500">
            Get in touch
          </a>
          .
        </p>
      </div>
    </div>
  );
}
