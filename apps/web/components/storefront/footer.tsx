import Link from "next/link";
import type { SocialLink, StoreSettings } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { SOCIAL_PLATFORM_META, SocialIcon } from "@/components/social-icon";
import { NewsletterForm } from "./newsletter-form";
import { FooterCategoryNav } from "./footer-category-nav";

const PAYMENT_METHODS = [
  { name: "bKash", className: "border-transparent bg-[#E2136E]/15 text-[#ff8dbd]" },
  { name: "Nagad", className: "border-transparent bg-[#F6921E]/15 text-[#ffb066]" },
  { name: "Visa", className: "border-transparent bg-[#1A1F71]/25 text-[#9aa2f0]" },
  { name: "Mastercard", className: "border-transparent bg-ink-700 text-cream-200" },
  { name: "Cash on Delivery", className: "border-ink-700 text-ink-400" },
];

interface FooterProps {
  categories?: CategoryTreeNode[];
  settings: StoreSettings;
  socialLinks?: SocialLink[];
}

export function Footer({ categories = [], settings, socialLinks = [] }: FooterProps) {
  // Prefer a logo made for dark backgrounds; fall back to the light-background one (better than
  // nothing) and finally to a plain text wordmark if no logo has been uploaded at all.
  const darkBgLogoUrl = settings.logoOnDarkUrl ?? settings.logoUrl;

  return (
    <footer className="mt-24 border-t border-ink-100 bg-gradient-to-b from-ink-800 to-ink-950 text-cream-200">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 xl:grid-cols-4 xl:gap-x-12">
          <div className="col-span-2 xl:col-span-1">
            <span className="font-display text-lg text-cream-50">{settings.storeName.toUpperCase()}</span>
            {settings.tagline && <p className="mt-2 text-sm leading-relaxed text-ink-300">{settings.tagline}</p>}
            {socialLinks.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2.5">
                {socialLinks.map((link) => {
                  const meta = SOCIAL_PLATFORM_META[link.platform];
                  const label = link.platform === "OTHER" ? (link.label ?? "Social link") : meta.label;
                  return (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={label}
                      title={label}
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-full border border-cream-50/15 bg-cream-50/5 text-cream-200 backdrop-blur-sm transition-all duration-200 ease-smooth hover:scale-110 active:scale-95",
                        meta.hoverClass,
                      )}
                    >
                      <SocialIcon platform={link.platform} size={16} />
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-4 text-xs uppercase tracking-[0.15em] text-ink-400">Shop</h3>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link href="/search" className="text-ink-300 transition-colors duration-200 ease-smooth hover:text-brass-400">
                  Search
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-xs uppercase tracking-[0.15em] text-ink-400">Help</h3>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link href="/track-order" className="text-ink-300 transition-colors duration-200 ease-smooth hover:text-brass-400">
                  Track Order
                </Link>
              </li>
              <li>
                <Link
                  href="/shipping-returns"
                  className="text-ink-300 transition-colors duration-200 ease-smooth hover:text-brass-400"
                >
                  Shipping &amp; Returns
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-ink-300 transition-colors duration-200 ease-smooth hover:text-brass-400">
                  Contact Us
                </Link>
              </li>
            </ul>
          </div>

          <div className="col-span-2 xl:col-span-1">
            <h3 className="mb-4 text-xs uppercase tracking-[0.15em] text-ink-400">Stay in touch</h3>
            <NewsletterForm variant="dark" />
          </div>
        </div>

        <FooterCategoryNav categories={categories} />

        {/* Closing brand moment — a large, centered logo mark before the copyright line. */}
        <div className="mt-16 flex flex-col items-center border-t border-ink-800 pt-12 text-center sm:pt-14">
          {darkBgLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin-supplied URL, arbitrary host not worth whitelisting for next/image
            <img src={darkBgLogoUrl} alt={settings.storeName} className="h-11 w-auto object-contain sm:h-14" />
          ) : (
            <span className="font-display text-3xl tracking-wide text-cream-50 sm:text-4xl">{settings.storeName}</span>
          )}
          {settings.tagline && (
            <p className="mt-3 text-[11px] uppercase tracking-[0.25em] text-ink-400 sm:text-xs">{settings.tagline}</p>
          )}
        </div>

        <div className="mt-10 flex flex-col-reverse items-center gap-4 border-t border-ink-800 pt-6 sm:flex-row sm:justify-between">
          <p className="text-xs text-ink-500">
            © {new Date().getFullYear()} {settings.storeName}. All rights reserved.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {PAYMENT_METHODS.map((method) => (
              <span
                key={method.name}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors duration-200 ease-smooth",
                  method.className,
                )}
              >
                {method.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
