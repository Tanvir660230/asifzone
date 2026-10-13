"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Mail, MapPin, Phone } from "lucide-react";
import type { PaymentMethodOption, SocialLink, StoreSettings } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";
import { trackingConfigured } from "@/lib/pixels";
import { openTrackingPreferences } from "@/lib/pixels/consent";
import { shortAddress } from "@/lib/store-identity";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { SOCIAL_PLATFORM_META, SocialIcon } from "@/components/social-icon";
import { StoreLogoImage } from "@/components/store-logo-image";
import { NewsletterForm } from "./newsletter-form";
import { resolveImageUrl } from "@/lib/image-url";

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

/** One column of footer links: a plain labelled list from 768px; below, an accordion row (closed by default) so the
 * phone footer stays short. */
function FooterLinkGroup({ title, children }: FooterLinkGroupProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-cream-50/10 md:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between py-4 text-left text-sm font-medium text-cream-50 md:pointer-events-none md:py-0 md:pb-5"
        aria-expanded={open}
      >
        {title}
        <ChevronDown size={16} aria-hidden="true" className={cn("text-ink-400 transition-transform duration-200 ease-smooth md:hidden", open && "rotate-180")} />
      </button>
      <div
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-smooth md:grid-rows-[1fr] md:opacity-100",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <ul className="space-y-1.5 overflow-hidden pb-4 text-sm md:pb-0">{children}</ul>
      </div>
    </div>
  );
}

// inline-block + vertical padding: a 26px-tall target, comfortably over the 24px minimum (WCAG 2.2 target size).
const FOOTER_LINK_CLASS = "inline-block py-1 text-ink-300 transition-colors duration-200 ease-smooth hover:text-[color:var(--band-accent,rgb(var(--color-cream-50)))]";

/** The storefront footer: a newsletter row, then the brand and its contact details beside three link columns, then one
 * bottom bar with how to pay, the copyright and the legal links. Designed on the dark palette as a `.ui-band-inverse`
 * section, so a theme may render it light (logos swap through `.ui-art-on-dark` / `.ui-art-on-light`). */
export function Footer({ categories = [], settings, socialLinks = [], paymentMethods = [] }: FooterProps) {
  const address = shortAddress(settings);
  // Depth-first flatten (each parent immediately followed by its own children) so a store with
  // few top-level categories still fills this column meaningfully via subcategories, e.g.
  // Men → Prayer Caps, rather than showing a single lonely link.
  const categoryLinks = categories.flatMap((c) => [c, ...c.children]).slice(0, 6);
  const whatsappLink = socialLinks.find((l) => l.platform === "WHATSAPP" && l.isActive);
  // The footer is designed on the dark palette, but a theme may render it light (`ui-band-inverse`), so both logos are
  // offered and the theme's band shows the one made for its background — each falling back to the other, then to a plain
  // text wordmark if no logo has been uploaded at all.
  const darkBgLogoUrl = settings.logoOnDarkUrl ?? settings.logoUrl;
  const lightBgLogoUrl = settings.logoUrl ?? settings.logoOnDarkUrl;
  const wordmark = <span className="font-display text-lg text-cream-50 [text-transform:var(--caps-transform)]">{settings.storeName}</span>;
  const bandLogo = (render: (url: string) => React.ReactNode) =>
    darkBgLogoUrl === lightBgLogoUrl ? (
      render(darkBgLogoUrl!)
    ) : (
      <>
        <span className="ui-art-on-dark">{render(darkBgLogoUrl!)}</span>
        <span className="ui-art-on-light">{render(lightBgLogoUrl!)}</span>
      </>
    );
  const hasPayments = Boolean(settings.paymentMethodsImageUrl || paymentMethods.length > 0);
  // The store's own footer choices (Storefront Studio → Site design → Footer).
  const design = settings.storefrontDesign?.footer;
  const extraLinks = design?.links ?? [];

  return (
    <footer data-band="footer" className="ui-band-inverse mt-12 bg-ink-950 text-cream-200 sm:mt-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Newsletter: its own row, the invitation on the left and the form where the eye lands next. */}
        {design?.showNewsletter !== false && (
        <div className="grid gap-6 border-b border-cream-50/10 py-12 md:grid-cols-2 md:items-end md:gap-12 md:py-14">
          <div>
            <h2 className="font-display text-3xl leading-tight text-cream-50 sm:text-4xl">{settings.newsletterHeading || "Stay in the loop"}</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-300">
              {settings.newsletterText || "New arrivals and offers, now and then. Unsubscribe any time."}
            </p>
          </div>
          <NewsletterForm variant="dark" className="w-full md:max-w-md md:justify-self-end" />
        </div>
        )}

        {/* The brand and how to reach it, then the link columns. */}
        <div className={cn("grid gap-10 py-12 md:gap-8 md:py-14", extraLinks.length > 0 ? "md:grid-cols-[1.4fr_repeat(4,1fr)]" : "md:grid-cols-[1.4fr_repeat(3,1fr)]")}>
          <div>
            {darkBgLogoUrl ? (
              bandLogo((url) => <StoreLogoImage src={resolveImageUrl(url)} alt={settings.storeName} className="h-9 w-36 object-contain object-left" fallback={wordmark} />)
            ) : (
              wordmark
            )}
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-300">
              {design?.about || settings.tagline || "Premium products, quality service and a seamless shopping experience."}
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {settings.contactPhone && (
                <li className="flex items-center gap-2.5 text-ink-300">
                  <Phone size={15} aria-hidden="true" className="shrink-0 text-ink-400" />
                  <a href={`tel:${settings.contactPhone}`} className={FOOTER_LINK_CLASS}>
                    {settings.contactPhone}
                  </a>
                </li>
              )}
              {whatsappLink && (
                <li className="flex items-center gap-2.5 text-ink-300">
                  <SocialIcon platform="WHATSAPP" size={15} className="shrink-0 text-ink-400" />
                  <a href={whatsappLink.url} target="_blank" rel="noreferrer" className={FOOTER_LINK_CLASS}>
                    WhatsApp
                  </a>
                </li>
              )}
              {settings.contactEmail && (
                <li className="flex items-center gap-2.5 text-ink-300">
                  <Mail size={15} aria-hidden="true" className="shrink-0 text-ink-400" />
                  <a href={`mailto:${settings.contactEmail}`} className={FOOTER_LINK_CLASS}>
                    {settings.contactEmail}
                  </a>
                </li>
              )}
              {address && (
                <li className="flex items-center gap-2.5 text-ink-300">
                  <MapPin size={15} aria-hidden="true" className="shrink-0 text-ink-400" />
                  {address}
                </li>
              )}
            </ul>
            {socialLinks.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2.5">
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
                        "flex h-10 w-10 items-center justify-center rounded-full border border-cream-50/15 text-cream-200 transition-[transform,background-color,border-color] duration-200 ease-smooth hover:-translate-y-0.5 hover:border-cream-50/40 active:translate-y-0",
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

          <div className="md:contents">
            <FooterLinkGroup title="Shop">
              {categoryLinks.map((cat) => (
                <li key={cat.id}>
                  <Link href={`/category/${cat.slug}`} className={FOOTER_LINK_CLASS}>
                    {cat.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/search" className={cn(FOOTER_LINK_CLASS, "font-medium text-cream-100")}>
                  All products
                </Link>
              </li>
            </FooterLinkGroup>

            <FooterLinkGroup title="Customer care">
              <li>
                <Link href="/track-order" className={FOOTER_LINK_CLASS}>
                  Track your order
                </Link>
              </li>
              <li>
                <Link href="/shipping-returns" className={FOOTER_LINK_CLASS}>
                  Shipping &amp; returns
                </Link>
              </li>
              <li>
                <Link href="/faq" className={FOOTER_LINK_CLASS}>
                  FAQ
                </Link>
              </li>
              <li>
                <Link href="/contact" className={FOOTER_LINK_CLASS}>
                  Contact us
                </Link>
              </li>
            </FooterLinkGroup>

            {extraLinks.length > 0 && (
              <FooterLinkGroup title={design?.linksTitle || "Explore"}>
                {extraLinks.map((link, i) => (
                  <li key={i}>
                    <Link href={link.href} className={FOOTER_LINK_CLASS}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </FooterLinkGroup>
            )}

            <FooterLinkGroup title="Your account">
              <li>
                <Link href="/account" className={FOOTER_LINK_CLASS}>
                  Account &amp; orders
                </Link>
              </li>
              <li>
                <Link href="/wishlist" className={FOOTER_LINK_CLASS}>
                  Wishlist
                </Link>
              </li>
              <li>
                <Link href="/cart" className={FOOTER_LINK_CLASS}>
                  Bag
                </Link>
              </li>
            </FooterLinkGroup>
          </div>
        </div>

        {/* Bottom bar: how to pay (only what the store configured — an uploaded graphic, or its payment methods), then the
            copyright and the legal links. */}
        <div className="flex flex-col gap-6 border-t border-cream-50/10 py-8 lg:flex-row lg:items-center lg:justify-between">
          {hasPayments ? (
            settings.paymentMethodsImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolveImageUrl(settings.paymentMethodsImageUrl)}
                alt="Accepted payment methods"
                className="h-auto w-full max-w-[280px] rounded-lg object-contain object-left"
              />
            ) : (
              <div className="flex flex-wrap items-center gap-3" aria-label="Accepted payment methods">
                {paymentMethods.map((method) =>
                  method.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={method.id} src={resolveImageUrl(method.logoUrl)} alt={method.name} title={method.name} className="h-7 w-auto object-contain" />
                  ) : (
                    <span key={method.id} className="text-xs ui-caps text-ink-400">
                      {method.name}
                    </span>
                  ),
                )}
              </div>
            )
          ) : (
            <span />
          )}
          <div className="flex flex-col gap-3 text-xs text-ink-500 sm:flex-row sm:items-center sm:gap-6">
            <p>
              © {new Date().getFullYear()} {settings.storeName}. All rights reserved.
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <Link href="/privacy-policy" className="inline-block py-1 transition-colors hover:text-cream-50">
                Privacy
              </Link>
              <Link href="/terms" className="inline-block py-1 transition-colors hover:text-cream-50">
                Terms
              </Link>
              <Link href="/shipping-returns" className="inline-block py-1 transition-colors hover:text-cream-50">
                Refund policy
              </Link>
              {trackingConfigured() && (
                <button type="button" onClick={openTrackingPreferences} className="inline-block py-1 transition-colors hover:text-cream-50">
                  Tracking preferences
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
