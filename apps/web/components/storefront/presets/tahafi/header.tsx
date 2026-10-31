import Link from "next/link";
import { User } from "lucide-react";
import type { StoreSettings } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { withMenuLinks } from "@/lib/nav-links";
import { resolveImageUrl } from "@/lib/image-url";
import { StoreLogoImage } from "@/components/store-logo-image";
import { HeaderShell } from "../../header-shell";
import { PhoneNavBar } from "../../phone-nav-bar";
import { MihrabMenu } from "../mihrab/header-actions";
import { TahafiHeaderActions } from "./header-actions";
import { ModeToggle } from "./mode-toggle";
import { TAHAFI_GLASS_BUTTON, TAHAFI_NAV_LINK } from "./styles";

interface HeaderProps {
  categories: CategoryTreeNode[];
  settings: StoreSettings;
}

/**
 * The Tahafi header, as in the approved mockup. Phones: on the tab pages, round glass buttons float over the page — light
 * or dark, the logo in a glass capsule, the account — and the bar behind them turns to glass once the page scrolls
 * (`.ui-header-float`); on pages inside a tab, Back and Search (PhoneNavBar) on that glass bar. Wide screens: one glass
 * bar — the logo, the pieces as soft pills, search, light/dark, account, bag. The logo is the store's light-page one, or
 * its dark-page one in dark mode. The menu sheet the dock's Shop opens is the mihrab preset's, which reads only tokens.
 */
export function TahafiHeader({ categories, settings }: HeaderProps) {
  const menu = withMenuLinks(categories, settings.storefrontDesign?.header?.menuLinks);
  const onLight = settings.logoUrl ?? settings.logoOnDarkUrl;
  const onDark = settings.logoOnDarkUrl ?? settings.logoUrl;
  const wordmark = <span className="font-display text-xl font-semibold leading-none text-fg">{settings.storeName}</span>;
  const logo = (size: string) =>
    onLight && onDark ? (
      <>
        <span className="ui-mode-light-art">
          <StoreLogoImage src={resolveImageUrl(onLight)} alt={settings.storeName} className={size} fallback={wordmark} />
        </span>
        <span className="ui-mode-dark-art">
          <StoreLogoImage src={resolveImageUrl(onDark)} alt={settings.storeName} className={size} fallback={wordmark} />
        </span>
      </>
    ) : (
      wordmark
    );
  const home = (size: string, className = "") => (
    <Link href="/" aria-label={`${settings.storeName} home`} className={`flex items-center justify-center ${className}`}>
      {logo(size)}
    </Link>
  );

  return (
    <HeaderShell>
      <div className="ui-header-float glass border-b border-ink-900/[0.06]">
        <PhoneNavBar brand={home("h-7 w-28 object-contain")}>
          <div className="flex h-[3.75rem] items-center justify-between px-3 lg:hidden">
            <ModeToggle className={TAHAFI_GLASS_BUTTON} />
            {home("h-6 w-24 object-contain", "glass-panel h-11 rounded-full px-4")}
            <Link href="/account" aria-label="Your account" className={TAHAFI_GLASS_BUTTON}>
              <User size={20} aria-hidden="true" />
            </Link>
          </div>
          <MihrabMenu categories={menu} />
        </PhoneNavBar>

        <div className="mx-auto hidden h-[4.25rem] max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-8 px-8 lg:grid">
          {home("h-8 w-32 object-contain object-left", "justify-start")}
          <nav aria-label="Shop" className="flex min-w-0 items-center justify-center gap-1 overflow-hidden">
            {menu.slice(0, 6).map((node) => (
              <Link key={node.id} href={node.href ?? `/category/${node.slug}`} className={`${TAHAFI_NAV_LINK} whitespace-nowrap`}>
                {node.name}
              </Link>
            ))}
          </nav>
          <TahafiHeaderActions modeToggle={<ModeToggle className="flex h-10 w-10 items-center justify-center rounded-full text-fg transition-colors duration-200 ease-smooth hover:bg-ink-900/[0.06]" />} />
        </div>
      </div>
    </HeaderShell>
  );
}
