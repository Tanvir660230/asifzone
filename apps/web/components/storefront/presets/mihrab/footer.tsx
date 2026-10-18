"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PaymentMethodOption, SocialLink, StoreSettings } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { trackingConfigured } from "@/lib/pixels";
import { openTrackingPreferences } from "@/lib/pixels/consent";
import { shortAddress } from "@/lib/store-identity";
import { resolveImageUrl } from "@/lib/image-url";
import { SOCIAL_PLATFORM_META, SocialIcon } from "@/components/social-icon";
import { NewsletterForm } from "../../newsletter-form";
import { ARCH_PATH } from "./arch";

interface FooterProps {
  categories?: CategoryTreeNode[];
  settings: StoreSettings;
  socialLinks?: SocialLink[];
  paymentMethods?: PaymentMethodOption[];
}

const LINK = "text-fg-muted transition-colors duration-200 ease-smooth hover:text-fg";

function LinkColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h2 className="text-sm font-medium text-fg">{title}</h2>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map((link, i) => (
          <li key={i}>
            <Link href={link.href} className={LINK}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Mihrab footer: a light sand band. The newsletter is a statement on the left, the links are plain columns on the right,
 * and the store's contact details, socials and payment methods sit in one quiet row above the legal line.
 */
export function MihrabFooter({ categories = [], settings, socialLinks = [], paymentMethods = [] }: FooterProps) {
  const address = shortAddress(settings);
  const categoryLinks = categories.flatMap((c) => [c, ...c.children]).slice(0, 6);
  const whatsappLink = socialLinks.find((l) => l.platform === "WHATSAPP" && l.isActive);
  const contacts = [
    settings.contactPhone && { href: `tel:${settings.contactPhone}`, label: settings.contactPhone },
    whatsappLink && { href: whatsappLink.url, label: "WhatsApp", external: true },
    settings.contactEmail && { href: `mailto:${settings.contactEmail}`, label: settings.contactEmail },
  ].filter(Boolean) as { href: string; label: string; external?: boolean }[];
  // The store's own footer choices (Storefront Studio → Site design → Footer).
  const design = settings.storefrontDesign?.footer;
  const extraLinks = design?.links ?? [];
  const showNewsletter = design?.showNewsletter !== false;
  // At the checkout only the legal line: a newsletter and a page of links under the order button are ways out of it.
  const atCheckout = usePathname()?.startsWith("/checkout") ?? false;

  if (atCheckout) {
    return (
      <footer className="mt-12 bg-cream-200 text-fg">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-xs text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>
            © {new Date().getFullYear()} {settings.storeName}
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {[
              { href: "/shipping-returns", label: "Delivery and returns" },
              { href: "/privacy-policy", label: "Privacy" },
              { href: "/terms", label: "Terms" },
            ].map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={LINK}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </footer>
    );
  }

  return (
    <footer className="mt-12 bg-cream-200 text-fg sm:mt-20">
      <div className="mx-auto max-w-7xl px-4 pb-10 pt-14 sm:px-6 sm:pt-20 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            {showNewsletter ? (
              <>
                <h2 className="font-display text-[1.75rem] leading-[1.1] sm:text-[2.125rem]">{settings.newsletterHeading || "Stay in touch"}</h2>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-fg-muted">
                  {settings.newsletterText || "New arrivals and offers by email. Unsubscribe any time."}
                </p>
                <NewsletterForm variant="light" className="mt-6 w-full max-w-sm" />
                {design?.about && <p className="mt-8 max-w-sm text-sm leading-relaxed text-fg-muted">{design.about}</p>}
              </>
            ) : (
              <>
                <h2 className="font-display text-[1.75rem] leading-[1.1] sm:text-[2.125rem]">{settings.storeName}</h2>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-fg-muted">{design?.about || settings.tagline}</p>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:col-span-6 lg:col-start-7">
            {categoryLinks.length > 0 && (
              <LinkColumn
                title="Shop"
                links={[...categoryLinks.map((c) => ({ href: `/category/${c.slug}`, label: c.name })), { href: "/search", label: "All products" }]}
              />
            )}
            {extraLinks.length > 0 && <LinkColumn title={design?.linksTitle || "Explore"} links={extraLinks} />}
            <LinkColumn
              title="Help"
              links={[
                { href: "/track-order", label: "Track an order" },
                { href: "/shipping-returns", label: "Delivery and returns" },
                { href: "/faq", label: "FAQ" },
                { href: "/contact", label: "Contact us" },
              ]}
            />
            <LinkColumn
              title="Your account"
              links={[
                { href: "/account", label: "Account" },
                { href: "/account/orders", label: "Orders" },
                { href: "/wishlist", label: "Wishlist" },
              ]}
            />
          </div>
        </div>

        {(contacts.length > 0 || address || socialLinks.length > 0) && (
          <div className="mt-14 flex flex-col gap-6 border-t border-line-strong pt-8 text-sm md:flex-row md:items-center md:justify-between">
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {contacts.map((contact) => (
                <li key={contact.href}>
                  <a href={contact.href} {...(contact.external ? { target: "_blank", rel: "noreferrer" } : {})} className={LINK}>
                    {contact.label}
                  </a>
                </li>
              ))}
              {address && <li className="text-fg-muted">{address}</li>}
            </ul>
            {socialLinks.length > 0 && (
              <ul className="-ml-2.5 flex flex-wrap md:ml-0 md:-mr-2.5">
                {socialLinks.map((link) => {
                  const label = link.platform === "OTHER" ? (link.label ?? "Social link") : SOCIAL_PLATFORM_META[link.platform].label;
                  return (
                    <li key={link.id}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={label}
                        title={label}
                        className="flex h-10 w-10 items-center justify-center text-fg-muted transition-colors duration-200 ease-smooth hover:text-fg"
                      >
                        <SocialIcon platform={link.platform} size={18} />
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {(settings.paymentMethodsImageUrl || paymentMethods.length > 0) && (
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <span className="text-xs text-fg-muted">We accept</span>
            {settings.paymentMethodsImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resolveImageUrl(settings.paymentMethodsImageUrl)} alt="Accepted payment methods" className="h-8 w-auto max-w-[320px] object-contain" />
            ) : (
              paymentMethods.map((method) =>
                method.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={method.id} src={resolveImageUrl(method.logoUrl)} alt={method.name} title={method.name} className="h-7 w-auto object-contain" />
                ) : (
                  <span key={method.id} className="text-xs text-fg">
                    {method.name}
                  </span>
                ),
              )
            )}
          </div>
        )}

        <div className="mt-10 flex flex-col gap-4 border-t border-line-strong pt-6 text-xs text-fg-muted sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2.5">
            <svg aria-hidden viewBox="-2 -2 104 129" className="h-5 w-4 text-fg">
              <path d={ARCH_PATH} fill="none" stroke="currentColor" strokeWidth="7" />
            </svg>
            © {new Date().getFullYear()} {settings.storeName}
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            <li>
              <Link href="/privacy-policy" className={LINK}>
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/terms" className={LINK}>
                Terms
              </Link>
            </li>
            <li>
              <Link href="/shipping-returns" className={LINK}>
                Refunds
              </Link>
            </li>
            {trackingConfigured() && (
              <li>
                <button type="button" onClick={openTrackingPreferences} className={LINK}>
                  Tracking preferences
                </button>
              </li>
            )}
          </ul>
        </div>
      </div>
    </footer>
  );
}
