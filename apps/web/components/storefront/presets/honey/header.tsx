import { withMenuLinks } from "@/lib/nav-links";
import Link from "next/link";
import { PackageSearch, User } from "lucide-react";
import type { StoreSettings } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { StoreLogoImage } from "@/components/store-logo-image";
import { resolveImageUrl } from "@/lib/image-url";
import { MegaMenu } from "../../mega-menu";
import { PhoneNavBar } from "../../phone-nav-bar";
import { HoneyBagButton, HoneyMenu, HoneySearchField } from "./header-actions";

interface HeaderProps {
  categories: CategoryTreeNode[];
  settings: StoreSettings;
}

const TEXT_ACTION = "flex h-11 items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-fg transition-colors duration-200 ease-smooth hover:text-[color:var(--nav-hover)]";

/**
 * Honey header: a white shop bar. The logo, the search field (the widest thing on it, because search is how people shop
 * here), then order tracking, the account and the bag, with the categories on a thin row below. Phones get the logo and the
 * search field, or Back and the logo on inner pages (PhoneNavBar); moving around is in the tab bar.
 */
export function HoneyHeader({ categories, settings }: HeaderProps) {
  const menu = withMenuLinks(categories, settings.storefrontDesign?.header?.menuLinks);
  const wordmark = <span className="font-display text-xl leading-none text-fg">{settings.storeName}</span>;
  const logo = (size: string) => (settings.logoUrl ? <StoreLogoImage src={resolveImageUrl(settings.logoUrl)} alt={settings.storeName} className={size} fallback={wordmark} /> : wordmark);

  return (
    <header className="sticky top-0 z-30 border-b border-line-subtle bg-surface">
      {/* Phones: logo, account and search; the menu panel opens from the tab bar's Shop tab. */}
      <PhoneNavBar
        brand={
          <Link href="/" aria-label={`${settings.storeName} home`} className="flex items-center justify-center">
            {logo("h-8 w-32 object-contain")}
          </Link>
        }
      >
        <div className="px-3 pb-2.5 sm:px-6 lg:hidden">
          <div className="flex h-12 items-center justify-between gap-2">
            <Link href="/" aria-label={`${settings.storeName} home`} className="flex items-center">
              {logo("h-8 w-32 object-contain object-left")}
            </Link>
            <Link href="/account" aria-label="Account" className="-mr-2 flex h-11 w-11 items-center justify-center text-fg">
              <User size={22} strokeWidth={1.9} aria-hidden="true" />
            </Link>
          </div>
          <HoneySearchField />
        </div>
        <HoneyMenu categories={menu} />
      </PhoneNavBar>

      {/* Wide screens */}
      <div className="mx-auto hidden h-[4.5rem] max-w-7xl items-center gap-7 px-8 lg:flex">
        <Link href="/" aria-label={`${settings.storeName} home`} className="flex shrink-0 items-center">
          {logo("h-9 w-40 object-contain object-left")}
        </Link>
        <div className="min-w-0 flex-1">
          <HoneySearchField />
        </div>
        <nav aria-label="Your account" className="flex shrink-0 items-center gap-6">
          <Link href="/track-order" className={TEXT_ACTION}>
            <PackageSearch size={20} strokeWidth={1.9} aria-hidden="true" />
            Track order
          </Link>
          <Link href="/account" className={TEXT_ACTION}>
            <User size={20} strokeWidth={1.9} aria-hidden="true" />
            Account
          </Link>
          <HoneyBagButton />
        </nav>
      </div>
      <div className="mx-auto hidden h-11 max-w-7xl items-center px-8 lg:flex">
        <MegaMenu categories={menu} />
      </div>
    </header>
  );
}
