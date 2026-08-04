import type { Metadata } from "next";
import { Mail, MessageCircle, Package } from "lucide-react";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = { title: "Contact Us" };

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="mb-3 font-display text-3xl text-ink-900">Contact us</h1>
      <p className="mb-10 text-sm text-ink-500">We usually reply within one business day.</p>

      <div className="space-y-5">
        <div className="flex items-center gap-3 text-sm text-ink-700">
          <Mail size={18} className="text-brass-500" />
          {siteConfig.contactEmail ? (
            <a href={`mailto:${siteConfig.contactEmail}`} className="hover:text-brass-500">
              {siteConfig.contactEmail}
            </a>
          ) : (
            <span className="text-ink-400">Email support coming soon</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-700">
          <MessageCircle size={18} className="text-brass-500" />
          {siteConfig.contactPhone ? (
            <a href={`tel:${siteConfig.contactPhone}`} className="hover:text-brass-500">
              {siteConfig.contactPhone}
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
