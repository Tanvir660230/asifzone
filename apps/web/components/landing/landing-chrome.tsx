import Link from "next/link";
import { ChevronDown, Phone } from "lucide-react";
import type { StoreSettings } from "@clothing-brand/shared";
import { StoreLogoImage } from "@/components/store-logo-image";
import { resolveImageUrl } from "@/lib/image-url";

/* The frame every landing page shares — the product's automatic page and campaign pages alike: a slim header (logo,
   "call us"), a minimal footer, and the FAQ list. No menu, bag or search: nothing to wander off into from an ad. */

export function LandingHeader({ settings, tel }: { settings: Pick<StoreSettings, "storeName" | "logoUrl" | "logoOnDarkUrl">; tel: string | null }) {
  const wordmark = <span className="truncate font-display text-lg text-fg">{settings.storeName}</span>;
  const logo = (url: string) => (
    <StoreLogoImage src={resolveImageUrl(url)} alt={settings.storeName} className="h-8 w-32 object-contain object-left" fallback={wordmark} />
  );
  const onDark = settings.logoOnDarkUrl ?? settings.logoUrl;
  return (
    <header className="sticky top-0 z-dock border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex min-w-0 items-center" aria-label={settings.storeName}>
          {settings.logoUrl && onDark ? (
            <>
              <span className="ui-mode-light-art">{logo(settings.logoUrl)}</span>
              <span className="ui-mode-dark-art">{logo(onDark)}</span>
            </>
          ) : (
            wordmark
          )}
        </Link>
        {tel && (
          <a href={tel} className="inline-flex h-10 items-center gap-2 rounded-[var(--control-radius)] bg-surface-muted px-4 text-sm font-semibold text-fg" lang="bn">
            <Phone size={16} aria-hidden="true" />
            কল করুন
          </a>
        )}
      </div>
    </header>
  );
}

export function LandingFooter({ storeName }: { storeName: string }) {
  return (
    <footer className="border-t border-line bg-surface py-6 text-center text-xs text-fg-muted">
      <p>
        © {new Date().getFullYear()} {storeName}
      </p>
      <nav aria-label="Policies" className="mt-2 flex justify-center gap-4">
        <Link href="/shipping-returns">Shipping &amp; returns</Link>
        <Link href="/privacy-policy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </nav>
    </footer>
  );
}

export function LandingFaqList({ faqs }: { faqs: { q: string; a: string }[] }) {
  return (
    <div className="divide-y divide-line rounded-xl border border-line bg-surface">
      {faqs.map(({ q, a }) => (
        <details key={q} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-base font-semibold text-fg [&::-webkit-details-marker]:hidden">
            {q}
            <ChevronDown size={18} className="shrink-0 text-fg-muted transition-transform duration-base group-open:rotate-180" aria-hidden="true" />
          </summary>
          <p className="whitespace-pre-line px-5 pb-4 text-sm leading-relaxed text-fg-muted">{a}</p>
        </details>
      ))}
    </div>
  );
}

/** The store's phone as a tel: link, or null. */
export const telHref = (phone: string | null | undefined) => (phone ? `tel:${phone.replace(/\s+/g, "")}` : null);
