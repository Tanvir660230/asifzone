import type { CSSProperties } from "react";
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
import { TAHAFI_NAV_LINK } from "./styles";

interface HeaderProps {
  categories: CategoryTreeNode[];
  settings: StoreSettings;
}

// The shared chrome inside (the phone navigation bar's Back and Search) draws in `fg`: cream on this ink bar.
const ON_INK = { "--color-fg": "242 239 234" } as CSSProperties;

/**
 * The Tahafi header: an ink bar with the logo in the middle. Wide screens put the pieces of clothing on the left and the
 * shopper's actions on the right, as words. Phones show only the logo and Account; moving around lives in the dock
 * (dock.tsx), and pages inside a tab get Back and Search (PhoneNavBar). The menu sheet the dock's Shop opens is the
 * mihrab preset's, which reads only tokens.
 */
export function TahafiHeader({ categories, settings }: HeaderProps) {
  const menu = withMenuLinks(categories, settings.storefrontDesign?.header?.menuLinks);
  const logoUrl = settings.logoOnDarkUrl ?? settings.logoUrl;
  const wordmark = <span className="font-display text-2xl leading-none text-cream-100">{settings.storeName}</span>;
  const logo = (size: string) =>
    logoUrl ? <StoreLogoImage src={resolveImageUrl(logoUrl)} alt={settings.storeName} className={size} fallback={wordmark} /> : wordmark;
  const home = (size: string) => (
    <Link href="/" aria-label={`${settings.storeName} home`} className="flex items-center justify-center">
      {logo(size)}
    </Link>
  );

  return (
    <HeaderShell>
      <div className="bg-ink-950" style={ON_INK}>
        <PhoneNavBar brand={home("h-7 w-32 object-contain")}>
          <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center px-2 lg:hidden">
            <span />
            {home("h-7 w-32 object-contain")}
            <Link href="/account" aria-label="Your account" className="flex h-11 w-11 items-center justify-center justify-self-end text-cream-100">
              <User size={22} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          </div>
          <MihrabMenu categories={menu} />
        </PhoneNavBar>

        <div className="mx-auto hidden h-[4.75rem] max-w-7xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 px-8 lg:grid">
          <nav aria-label="Shop" className="flex min-w-0 items-center gap-7 overflow-hidden">
            {menu.slice(0, 5).map((node) => (
              <Link key={node.id} href={node.href ?? `/category/${node.slug}`} className={`${TAHAFI_NAV_LINK} whitespace-nowrap`}>
                {node.name}
              </Link>
            ))}
          </nav>
          {home("h-9 w-40 object-contain")}
          <TahafiHeaderActions />
        </div>
      </div>
    </HeaderShell>
  );
}
