import { withMenuLinks } from "@/lib/nav-links";
import Link from "next/link";
import type { StoreSettings } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { StoreLogoImage } from "@/components/store-logo-image";
import { resolveImageUrl } from "@/lib/image-url";
import { MegaMenu } from "../../mega-menu";
import { PhoneNavBar } from "../../phone-nav-bar";
import { HoneyBagButton, HoneyMenu, HoneySearchIcon } from "./header-actions";

interface HeaderProps {
  categories: CategoryTreeNode[];
  settings: StoreSettings;
}

const TEXT_ACTION = "text-sm font-medium tracking-normal text-fg transition-colors duration-200 ease-smooth hover:text-[color:var(--nav-hover)]";

/**
 * Honey header: one quiet charcoal row that runs straight into the hero. The logo (the store's dark-background one), the
 * categories, then search, account and the bag. Phones get the logo and search, with Back and the logo on inner pages
 * (PhoneNavBar); bag, menu and saved items are in the floating dock.
 */
export function HoneyHeader({ categories, settings }: HeaderProps) {
  const menu = withMenuLinks(categories, settings.storefrontDesign?.header?.menuLinks);
  const logoUrl = settings.logoOnDarkUrl ?? settings.logoUrl;
  const wordmark = <span className="font-display text-2xl leading-none text-fg">{settings.storeName}</span>;
  const logo = (size: string) => (logoUrl ? <StoreLogoImage src={resolveImageUrl(logoUrl)} alt={settings.storeName} className={size} fallback={wordmark} /> : wordmark);

  return (
    <header className="sticky top-0 z-30 bg-canvas/90 backdrop-blur-xl lg:bg-canvas">
      {/* Phones: logo and search; the menu panel opens from the dock's Shop tab. */}
      <PhoneNavBar
        brand={
          <Link href="/" aria-label={`${settings.storeName} home`} className="flex items-center justify-center">
            {logo("h-8 w-36 object-contain")}
          </Link>
        }
      >
        <div className="flex h-16 items-center justify-between gap-2 px-4 lg:hidden">
          <Link href="/" aria-label={`${settings.storeName} home`} className="flex items-center">
            {logo("h-8 w-36 object-contain object-left")}
          </Link>
          <HoneySearchIcon />
        </div>
        <HoneyMenu categories={menu} />
      </PhoneNavBar>

      {/* Wide screens */}
      <div className="mx-auto hidden h-[4.75rem] max-w-[90rem] items-center gap-9 px-12 lg:flex">
        <Link href="/" aria-label={`${settings.storeName} home`} className="flex shrink-0 items-center">
          {logo("h-10 w-44 object-contain object-left")}
        </Link>
        <div className="min-w-0 flex-1">
          <MegaMenu categories={menu} />
        </div>
        <nav aria-label="Your account" className="flex shrink-0 items-center gap-6">
          <HoneySearchIcon />
          <Link href="/track-order" className={TEXT_ACTION}>
            Track order
          </Link>
          <Link href="/account" className={TEXT_ACTION}>
            Account
          </Link>
          <HoneyBagButton />
        </nav>
      </div>
    </header>
  );
}
