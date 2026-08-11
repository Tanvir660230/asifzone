import type { Metadata } from "next";
import { Mail, MapPin, Package, Phone, HelpCircle, Truck } from "lucide-react";
import { getSiteSettings, getActiveSocialLinksSafe } from "@/lib/api/storefront";
import { getSiteUrl, buildOpenGraph } from "@/lib/seo";
import { PageHero } from "@/components/storefront/page-hero";
import { ContactForm } from "@/components/storefront/contact-form";
import { SocialIcon } from "@/components/social-icon";

// Flat route with a real server-side settings fetch — see apps/web/app/(storefront)/page.tsx for why.
export const dynamic = "force-dynamic";

const TITLE = "Contact Us";
const DESCRIPTION = "Get in touch with our support team for order help, questions, or feedback.";

// A content page like this has no photo of its own — falls back to the store logo rather than
// shipping no og:image at all, so a share still renders a card instead of a blank/generic one.
export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getSiteSettings();
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: `${getSiteUrl()}/contact` },
    ...buildOpenGraph({
      title: TITLE,
      description: DESCRIPTION,
      url: `${getSiteUrl()}/contact`,
      images: settings.logoUrl ? [settings.logoUrl] : undefined,
    }),
  };
}

export default async function ContactPage() {
  const [{ settings }, { links }] = await Promise.all([getSiteSettings(), getActiveSocialLinksSafe()]);
  const whatsapp = links.find((l) => l.platform === "WHATSAPP" && l.isActive);

  const methods = [
    settings.contactEmail && {
      icon: Mail,
      label: "Email",
      value: settings.contactEmail,
      href: `mailto:${settings.contactEmail}`,
    },
    settings.contactPhone && {
      icon: Phone,
      label: "Phone",
      value: settings.contactPhone,
      href: `tel:${settings.contactPhone}`,
    },
    whatsapp && {
      icon: null,
      label: "WhatsApp",
      value: "Message us instantly",
      href: whatsapp.url,
      external: true,
    },
    {
      icon: MapPin,
      label: "Address",
      value: "Dhaka, Bangladesh",
    },
  ].filter(Boolean) as {
    icon: typeof Mail | null;
    label: string;
    value: string;
    href?: string;
    external?: boolean;
  }[];

  return (
    <div>
      <PageHero
        eyebrow="We're here to help"
        title="Contact Us"
        description="Order questions, product help, or just feedback — reach out below and we usually reply within one business day."
      />

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-10 px-4 py-16 sm:px-6 lg:grid-cols-5 lg:px-8">
        <div className="lg:col-span-3">
          <ContactForm />
        </div>

        <div className="space-y-6 lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {methods.map((method) => (
              <a
                key={method.label}
                href={method.href}
                target={method.external ? "_blank" : undefined}
                rel={method.external ? "noreferrer" : undefined}
                className="group flex items-center gap-4 rounded-2xl border border-ink-100 bg-cream-50 p-5 transition-all duration-200 ease-smooth hover:border-ink-200 hover:shadow-float"
              >
                <span className="glossy flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brass-100 text-brass-600">
                  {method.icon ? <method.icon size={18} /> : <SocialIcon platform="WHATSAPP" size={18} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs uppercase tracking-wide text-ink-400">{method.label}</span>
                  <span className="block truncate text-sm font-medium text-ink-900">{method.value}</span>
                </span>
              </a>
            ))}
          </div>

          <div className="rounded-2xl border border-dashed border-ink-200 p-5">
            <p className="mb-3 text-xs uppercase tracking-wide text-ink-400">Quick links</p>
            <div className="space-y-2 text-sm">
              <a href="/track-order" className="flex items-center gap-2 text-ink-700 hover:text-brass-600">
                <Package size={15} className="text-ink-400" /> Track an existing order
              </a>
              <a href="/shipping-returns" className="flex items-center gap-2 text-ink-700 hover:text-brass-600">
                <Truck size={15} className="text-ink-400" /> Shipping &amp; returns policy
              </a>
              <a href="/faq" className="flex items-center gap-2 text-ink-700 hover:text-brass-600">
                <HelpCircle size={15} className="text-ink-400" /> Frequently asked questions
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
