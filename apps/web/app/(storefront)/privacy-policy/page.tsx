import type { Metadata } from "next";
import Link from "next/link";
import { getSiteSettings } from "@/lib/api/storefront";
import { getSiteUrl, buildOpenGraph } from "@/lib/seo";
import { PageHero } from "@/components/storefront/page-hero";
import { Breadcrumb } from "@/components/storefront/breadcrumb";
import { MobileTocSelect } from "@/components/storefront/mobile-toc-select";

// Now does a real server-side settings fetch for the og:image fallback below — without this,
// `next build` would try to statically prerender the page and fail (the api container isn't
// reachable during the Docker image build). Same reasoning as apps/web/app/(storefront)/page.tsx.
export const dynamic = "force-dynamic";

const TITLE = "Privacy Policy";
const DESCRIPTION = "How we collect, use, and protect your personal information.";

// A content page like this has no photo of its own — falls back to the store logo rather than
// shipping no og:image at all, so a share still renders a card instead of a blank/generic one.
export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getSiteSettings();
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: `${getSiteUrl()}/privacy-policy` },
    ...buildOpenGraph({
      title: TITLE,
      description: DESCRIPTION,
      url: `${getSiteUrl()}/privacy-policy`,
      images: settings.logoUrl ? [settings.logoUrl] : undefined,
    }),
  };
}

const LAST_UPDATED = "August 10, 2026";

const SECTIONS = [
  {
    id: "information-we-collect",
    title: "Information We Collect",
    body: (
      <>
        <p>
          We collect the information you give us directly — your name, email, phone number, and delivery address —
          when you create an account, place an order, or contact us for support.
        </p>
        <p>
          We also collect basic technical information automatically, such as your browser type, device, and pages
          viewed, which helps us keep the storefront fast, secure, and working correctly across devices.
        </p>
      </>
    ),
  },
  {
    id: "how-we-use-it",
    title: "How We Use Your Information",
    body: (
      <p>
        Your information is used to process and deliver orders, provide customer support, prevent fraud, and — only
        where you&rsquo;ve opted in — send updates about promotions, restocks, or your order status. We do not sell
        your personal information to third parties.
      </p>
    ),
  },
  {
    id: "cookies",
    title: "Cookies & Tracking",
    body: (
      <p>
        We use essential cookies to keep you signed in and remember your cart between visits, and limited analytics
        to understand which pages are useful so we can improve them. You can disable cookies in your browser
        settings, though some parts of checkout may not work correctly without them.
      </p>
    ),
  },
  {
    id: "sharing",
    title: "Data Sharing & Third Parties",
    body: (
      <p>
        We share only what&rsquo;s necessary with the courier partners who deliver your order and the payment
        providers who process your payment. These partners are only permitted to use your information to complete
        that specific service — not for their own marketing.
      </p>
    ),
  },
  {
    id: "security",
    title: "Data Security",
    body: (
      <p>
        Account passwords are stored encrypted, and payment details are never stored on our own servers. We use
        industry-standard safeguards to protect your data, though no online system can be guaranteed 100% secure —
        if we ever become aware of a breach affecting your account, we will notify you promptly.
      </p>
    ),
  },
  {
    id: "your-rights",
    title: "Your Rights & Choices",
    body: (
      <p>
        You can review or update your personal details anytime from your account page, unsubscribe from marketing
        messages using the link in any email, or request that we delete your account and associated data by
        contacting us directly.
      </p>
    ),
  },
  {
    id: "children",
    title: "Children's Privacy",
    body: (
      <p>
        Our store is intended for users aged 18 and older. We do not knowingly collect personal information from
        children, and will delete any such information if we become aware of it.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to This Policy",
    body: (
      <p>
        We may update this policy from time to time as our services evolve. Material changes will be reflected here
        with an updated date at the top of this page.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions about this policy or your data can be sent via the{" "}
        <Link href="/contact" className="text-ink-900 underline underline-offset-2 hover:text-brass-500">
          contact page
        </Link>
        .
      </p>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div>
      <div className="mx-auto max-w-3xl px-4 pt-6 sm:px-6 lg:px-8">
        <Breadcrumb trail={[{ name: "Privacy Policy" }]} />
      </div>
      <PageHero
        eyebrow={`Last updated ${LAST_UPDATED}`}
        title="Privacy Policy"
        description="A plain-language look at what we collect, why, and how it's kept safe."
      />

      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <MobileTocSelect sections={SECTIONS} />
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
