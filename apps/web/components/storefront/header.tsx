import Link from "next/link";
import { PackageSearch, User } from "lucide-react";
import type { StoreSettings } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
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

export function Header({ categories, settings }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30">
      <div className="glass border-b border-ink-200 shadow-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <MobileNav categories={categories} />
            <Link
              href="/"
              aria-label={`${settings.storeName} home`}
              className="flex items-center transition-transform duration-200 ease-smooth hover:scale-[1.02]"
            >
              {settings.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- admin-supplied URL, arbitrary host not worth whitelisting for next/image
                <img src={settings.logoUrl} alt={settings.storeName} className="h-9 w-auto object-contain" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink-900 font-display text-base font-semibold tracking-tight text-ink-900">
                  {getInitials(settings.storeName)}
                </span>
              )}
            </Link>
          </div>

          <div className="hidden flex-1 justify-center lg:flex">
            <MegaMenu categories={categories} />
          </div>

          <div className="flex items-center gap-5">
            <StickySearchBar />
            <div className="lg:hidden">
              <SearchTriggerButton />
            </div>
            <Link
              href="/track-order"
              aria-label="Track your order"
              className="hidden text-ink-700 transition-all duration-200 ease-smooth hover:scale-110 hover:text-brass-500 sm:block"
            >
              <PackageSearch size={20} />
            </Link>
            <Link
              href="/account"
              aria-label="Your account"
              className="text-ink-700 transition-all duration-200 ease-smooth hover:scale-110 hover:text-brass-500"
            >
              <User size={20} />
            </Link>
            <CartIcon />
          </div>
        </div>
      </div>
    </header>
  );
}
