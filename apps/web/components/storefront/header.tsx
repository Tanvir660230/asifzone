import Link from "next/link";
import { PackageSearch, User } from "lucide-react";
import type { StoreSettings } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { StoreLogoImage } from "@/components/store-logo-image";
import { MegaMenu } from "./mega-menu";
import { MobileNav } from "./mobile-nav";
import { CartIcon } from "./cart-icon";
import { SearchTriggerButton } from "./search-trigger-button";
import { StickySearchBar } from "./sticky-search-bar";

interface HeaderProps {
  categories: CategoryTreeNode[];
  settings: StoreSettings;
}

/** "Asif Zone" -> "AZ", "Considered" -> "C" — up to the first two significant words, for the fallback monogram mark shown when no logo image is set. */
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Shared treatment for every icon-only action in the header (track order, account, cart, mobile
 * search) — a soft circular hover surface reads as one deliberate button style instead of icons
 * just floating loose against the header background. */
const iconButtonClass =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-700 transition-all duration-200 ease-smooth hover:bg-ink-100 hover:text-brass-500";

export function Header({ categories, settings }: HeaderProps) {
  const monogram = (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink-900 font-display text-base font-semibold tracking-tight text-ink-900">
      {getInitials(settings.storeName)}
    </span>
  );
  const logo = settings.logoUrl ? (
    <StoreLogoImage
      src={settings.logoUrl}
      alt={settings.storeName}
      className="h-9 w-36 object-contain"
      fallback={monogram}
    />
  ) : (
    monogram
  );

  return (
    <header className="sticky top-0 z-30">
      <div className="glass border-b border-ink-200 shadow-[0_4px_20px_-8px_rgba(17,17,17,0.08)]">
        {/* Mobile: menu — centered logo — search. Account/cart/track-order live in the bottom
            tab bar on mobile instead, so the header stays uncluttered. */}
        <div className="grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 lg:hidden">
          <div className="flex items-center justify-start">
            <MobileNav categories={categories} />
          </div>
          <Link
            href="/"
            aria-label={`${settings.storeName} home`}
            className="flex items-center justify-center transition-transform duration-200 ease-smooth hover:scale-[1.02]"
          >
            {logo}
          </Link>
          <div className="flex items-center justify-end">
            <SearchTriggerButton />
          </div>
        </div>

        {/* Desktop */}
        <div className="mx-auto hidden h-[4.5rem] max-w-7xl items-center justify-between gap-4 px-6 lg:flex lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              aria-label={`${settings.storeName} home`}
              className="flex items-center transition-transform duration-200 ease-smooth hover:scale-[1.02]"
            >
              {logo}
            </Link>
          </div>

          <div className="flex flex-1 justify-center">
            <MegaMenu categories={categories} />
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <StickySearchBar />

            <div className="ml-1 flex items-center gap-0.5 border-l border-ink-200 pl-2 sm:ml-2 sm:pl-3">
              <Link href="/track-order" aria-label="Track your order" className={iconButtonClass}>
                <PackageSearch size={19} />
              </Link>
              <Link href="/account" aria-label="Your account" className={iconButtonClass}>
                <User size={19} />
              </Link>
              <CartIcon />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
