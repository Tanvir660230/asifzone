"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Mail, MapPin, Phone } from "lucide-react";
import type { PaymentMethodOption, SocialLink, StoreSettings } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { SOCIAL_PLATFORM_META, SocialIcon } from "@/components/social-icon";
import { StoreLogoImage } from "@/components/store-logo-image";
import { NewsletterForm } from "./newsletter-form";

// Shown whenever the admin hasn't uploaded payment-method logos yet, so this section is never
// simply blank on a freshly-set-up store.
const FALLBACK_PAYMENT_METHODS = [
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
  paymentMethods?: PaymentMethodOption[];
}

interface FooterLinkGroupProps {
  title: string;
  children: React.ReactNode;
}

/** A bounded card for each link group — a flat, hard-edged panel (border + faint tint, no blur/
 * gradient) rather than plain text floating on the footer's background, so the footer reads as a
 * few distinct solid sections instead of one undifferentiated block of links. Collapses into an
 * accordion (closed by default) below `md` so the mobile footer stays short. */
function FooterLinkGroup({ title, children }: FooterLinkGroupProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-cream-50/10 bg-cream-50/[0.03] px-5 py-4 md:py-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-xs uppercase tracking-[0.15em] text-ink-400 md:pointer-events-none md:mb-4"
        aria-expanded={open}
      >
        {title}
        <ChevronDown size={14} className={cn("transition-transform duration-200 ease-smooth md:hidden", open && "rotate-180")} />
      </button>
      <div
        className={cn(
          "grid overflow-hidden transition-all duration-300 md:grid-rows-[1fr] md:opacity-100",
          open ? "grid-rows-[1fr] pt-3 opacity-100" : "grid-rows-[0fr] opacity-0 md:pt-0",
        )}
      >
        <ul className="space-y-2.5 overflow-hidden text-sm">{children}</ul>
      </div>
    </div>
  );
}

const FOOTER_LINK_CLASS = "text-ink-300 transition-colors duration-200 ease-smooth hover:text-brass-400";

export function Footer({ categories = [], settings, socialLinks = [], paymentMethods = [] }: FooterProps) {
  // Depth-first flatten (each parent immediately followed by its own children) so a store with
  // few top-level categories still fills this column meaningfully via subcategories, e.g.
  // Men → Prayer Caps, rather than showing a single lonely link.
  const categoryLinks = categories.flatMap((c) => [c, ...c.children]).slice(0, 6);
  const whatsappLink = socialLinks.find((l) => l.platform === "WHATSAPP" && l.isActive);
  // Prefer a logo made for dark backgrounds; fall back to the light-background one (better than
  // nothing) and finally to a plain text wordmark if no logo has been uploaded at all.
  const darkBgLogoUrl = settings.logoOnDarkUrl ?? settings.logoUrl;
  const wordmark = <span className="font-display text-sm text-cream-50">{settings.storeName.toUpperCase()}</span>;

  return (
    // A hard cut into solid black, not a gradient melt — the page content ends and the footer
    // simply starts, like distinct sections stacked on a page rather than one blending into the
    // next. Visual interest inside the footer instead comes from the bounded link cards below.
    <footer className="mt-24 bg-ink-950 text-cream-200">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        {/* Four content categories: who we are (+ how to reach us), what we sell, how to get
            help, and company/legal — each a clearly labeled, visually bounded group rather than
            one long undifferentiated link dump. */}
        <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            {darkBgLogoUrl ? (
              <StoreLogoImage src={darkBgLogoUrl} alt={settings.storeName} className="h-5 w-20 object-contain object-left" fallback={wordmark} />
            ) : (
              wordmark
            )}
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-300">
              {settings.tagline || "Premium products, quality service and a seamless shopping experience."}
            </p>
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
                        "flex h-9 w-9 items-center justify-center rounded-full border border-cream-50/15 bg-cream-50/5 text-cream-200 transition-all duration-200 ease-smooth hover:scale-110 active:scale-95",
                        meta.hoverClass,
                      )}
                    >
                      <SocialIcon platform={link.platform} size={16} />
                    </a>
                  );
                })}
              </div>
            )}
            <ul className="mt-5 space-y-2.5 text-sm">
              {settings.contactPhone && (
                <li className="flex items-center gap-2 text-ink-300">
                  <Phone size={14} className="shrink-0 text-ink-500" />
                  <a href={`tel:${settings.contactPhone}`} className="hover:text-brass-400">
                    {settings.contactPhone}
                  </a>
                </li>
              )}
              {whatsappLink && (
                <li className="flex items-center gap-2 text-ink-300">
                  <SocialIcon platform="WHATSAPP" size={14} className="shrink-0 text-ink-500" />
                  <a href={whatsappLink.url} target="_blank" rel="noreferrer" className="hover:text-brass-400">
                    WhatsApp
                  </a>
                </li>
              )}
              {settings.contactEmail && (
                <li className="flex items-center gap-2 text-ink-300">
                  <Mail size={14} className="shrink-0 text-ink-500" />
                  <a href={`mailto:${settings.contactEmail}`} className="hover:text-brass-400">
                    {settings.contactEmail}
                  </a>
                </li>
              )}
              <li className="flex items-center gap-2 text-ink-300">
                <MapPin size={14} className="shrink-0 text-ink-500" />
                Dhaka, Bangladesh
              </li>
            </ul>
          </div>

          <FooterLinkGroup title="Shop by Category">
            {categoryLinks.map((cat) => (
              <li key={cat.id}>
                <Link href={`/category/${cat.slug}`} className={FOOTER_LINK_CLASS}>
                  {cat.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/search" className={cn(FOOTER_LINK_CLASS, "font-medium text-cream-100")}>
                View all products →
              </Link>
            </li>
          </FooterLinkGroup>

          <FooterLinkGroup title="Customer Care">
            <li>
              <Link href="/track-order" className={FOOTER_LINK_CLASS}>
                Track Order
              </Link>
            </li>
            <li>
              <Link href="/shipping-returns" className={FOOTER_LINK_CLASS}>
                Shipping &amp; Delivery
              </Link>
            </li>
            <li>
              <Link href="/shipping-returns" className={FOOTER_LINK_CLASS}>
                Return &amp; Refund
              </Link>
            </li>
            <li>
              <Link href="/faq" className={FOOTER_LINK_CLASS}>
                FAQ
              </Link>
            </li>
          </FooterLinkGroup>

          <FooterLinkGroup title="Company">
            <li>
              <Link href="/contact" className={FOOTER_LINK_CLASS}>
                Contact Us
              </Link>
            </li>
            <li>
              <Link href="/privacy-policy" className={FOOTER_LINK_CLASS}>
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link href="/terms" className={FOOTER_LINK_CLASS}>
                Terms &amp; Conditions
              </Link>
            </li>
          </FooterLinkGroup>
        </div>

        {/* Get in touch — its own full-width moment (same weight as the brand logo below it),
            not squeezed into a narrow grid column where a side-by-side input+button has no room
            to breathe. Payment logos live in the bottom bar as a trust badge, not paired here —
            a newsletter signup and "we accept" iconography are different concerns. */}
        <div className="mt-14 border-t border-cream-50/10 pt-12 text-center sm:mt-16 sm:pt-14">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-brass-400">Newsletter</p>
          <h3 className="font-display text-2xl text-cream-50 sm:text-3xl">Get in Touch</h3>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-300">
            New arrivals, flash sales, and considered style notes — no spam, unsubscribe any time.
          </p>
          <div className="mt-6 flex justify-center">
            <NewsletterForm variant="dark" className="w-full max-w-sm" />
          </div>
        </div>

        {/* Closing brand moment — a large, centered logo mark before the copyright line. */}
        <div className="mt-14 flex flex-col items-center border-t border-cream-50/10 pt-12 text-center sm:pt-14">
          {darkBgLogoUrl ? (
            <StoreLogoImage
              src={darkBgLogoUrl}
              alt={settings.storeName}
              className="h-16 w-64 object-contain sm:h-24 sm:w-96"
              fallback={<span className="font-display text-4xl tracking-wide text-cream-50 sm:text-5xl">{settings.storeName}</span>}
            />
          ) : (
            <span className="font-display text-3xl tracking-wide text-cream-50 sm:text-4xl">{settings.storeName}</span>
          )}
          {settings.tagline && (
            <p className="mt-3 text-[11px] uppercase tracking-[0.25em] text-ink-400 sm:text-xs">{settings.tagline}</p>
          )}
        </div>

        {/* We Accept — its own full-width moment, same treatment as the brand logo above it,
            so the payment graphic stays large and legible instead of being squeezed into the
            fine-print bar below. */}
        <div className="mt-14 flex flex-col items-center border-t border-cream-50/10 pt-12 text-center sm:pt-14">
          <p className="mb-5 text-xs uppercase tracking-[0.3em] text-ink-500">We Accept</p>
          {settings.paymentMethodsImageUrl ? (
            // A single admin-uploaded graphic with every logo already laid out — takes priority
            // over the per-method list below since it's the simpler path for admins who don't
            // want to manage individual PaymentMethodOption entries.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={settings.paymentMethodsImageUrl}
              alt="Accepted payment methods"
              className="h-auto w-full max-w-[260px] rounded-lg object-contain sm:max-w-[320px] md:max-w-[380px]"
            />
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-3">
              {paymentMethods.length > 0
                ? paymentMethods.map((method) =>
                    method.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={method.id} src={method.logoUrl} alt={method.name} title={method.name} className="h-8 w-auto object-contain" />
                    ) : (
                      <span key={method.id} className="text-[11px] uppercase tracking-wide text-ink-400">
                        {method.name}
                      </span>
                    ),
                  )
                : FALLBACK_PAYMENT_METHODS.map((method) => (
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
          )}
        </div>

        {/* Bottom bar — copyright + legal links, kept light and out of the way of the moments
            above (logo, We Accept) that are meant to actually draw the eye. */}
        <div className="mt-10 flex w-full flex-col-reverse items-center gap-4 border-t border-cream-50/10 pt-8 sm:flex-row sm:justify-between">
          <p className="text-xs text-ink-500">
            © {new Date().getFullYear()} {settings.storeName}. All rights reserved.
          </p>
          <div className="flex items-center gap-3 text-xs text-ink-500">
            <Link href="/privacy-policy" className="hover:text-brass-400">
              Privacy
            </Link>
            <span className="text-ink-700">·</span>
            <Link href="/terms" className="hover:text-brass-400">
              Terms
            </Link>
            <span className="text-ink-700">·</span>
            <Link href="/shipping-returns" className="hover:text-brass-400">
              Refund Policy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
