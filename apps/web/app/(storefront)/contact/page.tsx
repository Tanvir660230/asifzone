import type { Metadata } from "next";
import { Mail, MessageCircle, Package } from "lucide-react";
import { getSiteSettings } from "@/lib/api/storefront";
import { getSiteUrl } from "@/lib/seo";

// Flat route with a real server-side settings fetch — see apps/web/app/(storefront)/page.tsx for why.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contact Us",
  description: "Get in touch with our support team for order help, questions, or feedback.",
  alternates: { canonical: `${getSiteUrl()}/contact` },
};

export default async function ContactPage() {
  const { settings } = await getSiteSettings();

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="mb-3 font-display text-3xl text-ink-900">Contact us</h1>
      <p className="mb-10 text-sm text-ink-500">We usually reply within one business day.</p>

      <div className="space-y-5">
        <div className="flex items-center gap-3 text-sm text-ink-700">
          <Mail size={18} className="text-brass-500" />
          {settings.contactEmail ? (
            <a href={`mailto:${settings.contactEmail}`} className="hover:text-brass-500">
              {settings.contactEmail}
            </a>
          ) : (
            <span className="text-ink-400">Email support coming soon</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-700">
          <MessageCircle size={18} className="text-brass-500" />
          {settings.contactPhone ? (
            <a href={`tel:${settings.contactPhone}`} className="hover:text-brass-500">
              {settings.contactPhone}
            </a>
          ) : (
            <span className="text-ink-400">Phone support coming soon</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-700">
          <Package size={18} className="text-brass-500" />
          <a href="/track-order" className="hover:text-brass-500">
            Already ordered? Track your order
          </a>
        </div>
      </div>
    </div>
  );
}
