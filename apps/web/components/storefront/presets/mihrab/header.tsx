import { withMenuLinks } from "@/lib/nav-links";
import Link from "next/link";
import { policyHighlights, storePolicy, type StoreSettings } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { StoreLogoImage } from "@/components/store-logo-image";
import { resolveImageUrl } from "@/lib/image-url";
import { MegaMenu } from "../../mega-menu";
import { PhoneNavBar } from "../../phone-nav-bar";
import { MihrabBagButton, MihrabMenu, MihrabSearchField, MihrabSearchIcon } from "./header-actions";
import { MihrabPromiseStrip } from "./promise-strip";

interface HeaderProps {
  categories: CategoryTreeNode[];
  settings: StoreSettings;
}

const TEXT_ACTION = "text-sm font-medium text-fg transition-colors duration-200 ease-smooth hover:text-[color:var(--nav-hover)]";

/**
 * Mihrab header: a navy strip with the store's own delivery promises, then search · centred logo · text actions, and the
 * categories on a row of their own. Phones get logo · search, with bag, menu and account in the bottom tab bar, and an iOS
 * navigation bar on inner pages (PhoneNavBar).
 */
export function MihrabHeader({ categories, settings }: HeaderProps) {
  const menu = withMenuLinks(categories, settings.storefrontDesign?.header?.menuLinks);
  const promises = policyHighlights(storePolicy(settings)).map((line) => line.label);
  const wordmark = <span className="font-display text-2xl leading-none text-fg">{settings.storeName}</span>;
  const logo = (size: string) =>
    settings.logoUrl ? (
      <StoreLogoImage src={resolveImageUrl(settings.logoUrl)} alt={settings.storeName} className={size} fallback={wordmark} />
    ) : (
      wordmark
    );

  return (
    <>
      {promises.length > 0 && <MihrabPromiseStrip promises={promises} />}
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-xl backdrop-saturate-150 [border-bottom-width:0.5px] lg:bg-canvas lg:[border-bottom-width:1px]">
        {/* Phones: logo and search; the menu panel opens from the tab bar's Shop tab. */}
        <PhoneNavBar>
          <div className="flex h-16 items-center justify-between gap-2 px-4 lg:hidden">
            <Link href="/" aria-label={`${settings.storeName} home`} className="flex items-center">
              {logo("h-8 w-32 object-contain object-left")}
            </Link>
            <MihrabSearchIcon />
          </div>
          <MihrabMenu categories={menu} />
        </PhoneNavBar>

        {/* Desktop */}
        <div className="mx-auto hidden h-20 max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-6 px-8 lg:grid">
          <MihrabSearchField />
          <Link href="/" aria-label={`${settings.storeName} home`} className="flex items-center justify-center">
            {logo("h-10 w-44 object-contain")}
          </Link>
          <nav aria-label="Your account" className="flex items-center justify-end gap-7">
            <Link href="/track-order" className={TEXT_ACTION}>
              Track order
            </Link>
            <Link href="/wishlist" className={TEXT_ACTION}>
              Wishlist
            </Link>
            <Link href="/account" className={TEXT_ACTION}>
              Account
            </Link>
            <MihrabBagButton />
          </nav>
        </div>
        <div className="hidden border-t border-line lg:block">
          <div className="mx-auto flex h-12 max-w-7xl items-center px-8">
            <MegaMenu categories={menu} />
          </div>
        </div>
      </header>
    </>
  );
}
