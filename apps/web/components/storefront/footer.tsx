import Link from "next/link";
import { Facebook, Instagram, MessageCircle } from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import { NewsletterForm } from "./newsletter-form";

const SOCIAL_ICONS = [
  { key: "facebook" as const, icon: Facebook, label: "Facebook" },
  { key: "instagram" as const, icon: Instagram, label: "Instagram" },
  { key: "whatsapp" as const, icon: MessageCircle, label: "WhatsApp" },
];

const PAYMENT_METHODS = ["bKash", "Nagad", "Cards", "Cash on Delivery"];

export function Footer() {
  const activeSocials = SOCIAL_ICONS.filter(({ key }) => siteConfig.social[key]);

  return (
    <footer className="mt-24 border-t border-ink-100 bg-ink-900 text-cream-200">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <span className="font-display text-lg text-cream-50">{siteConfig.name.toUpperCase()}</span>
            <p className="mt-2 text-sm text-ink-300">{siteConfig.tagline}</p>
            {activeSocials.length > 0 && (
              <div className="mt-4 flex gap-3">
                {activeSocials.map(({ key, icon: Icon, label }) => (
                  <a
                    key={key}
                    href={siteConfig.social[key]!}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={label}
                    className="text-ink-400 hover:text-brass-400"
                  >
                    <Icon size={18} />
                  </a>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-3 text-xs uppercase tracking-wide text-ink-400">Shop</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/search" className="hover:text-brass-400">Search</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-xs uppercase tracking-wide text-ink-400">Help</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/track-order" className="hover:text-brass-400">Track Order</Link></li>
              <li><Link href="/shipping-returns" className="hover:text-brass-400">Shipping &amp; Returns</Link></li>
              <li><Link href="/contact" className="hover:text-brass-400">Contact Us</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-xs uppercase tracking-wide text-ink-400">Stay in touch</h3>
            <NewsletterForm variant="dark" />
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-ink-800 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-500">
            © {new Date().getFullYear()} {siteConfig.name}. All rights reserved.
          </p>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((method) => (
              <span key={method} className="rounded border border-ink-700 px-2 py-1 text-[11px] uppercase tracking-wide text-ink-400">
                {method}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
