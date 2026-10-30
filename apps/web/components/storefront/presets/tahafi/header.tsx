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
import { TahafiHeaderActions, TahafiSearchButton } from "./header-actions";
import { TAHAFI_NAV_LINK } from "./styles";

interface HeaderProps {
  categories: CategoryTreeNode[];
  settings: StoreSettings;
}

const PHONE_ICON = "flex h-11 w-11 items-center justify-center rounded-full text-fg active:bg-ink-900/[0.06]";

/**
 * The Tahafi header: a bar of light glass (the page shows through, blurred) — on wide screens the logo, the pieces of
 * clothing as soft pills, a search field, the account and the bag; on phones Search, the logo and Account, with moving
 * around in the dock (dock.tsx) and Back on pages inside a tab (PhoneNavBar). The menu sheet the dock's Shop opens is
 * the mihrab preset's, which reads only tokens.
 */
export function TahafiHeader({ categories, settings }: HeaderProps) {
  const menu = withMenuLinks(categories, settings.storefrontDesign?.header?.menuLinks);
  const logoUrl = settings.logoUrl ?? settings.logoOnDarkUrl;
  const wordmark = <span className="font-display text-xl font-semibold leading-none text-fg">{settings.storeName}</span>;
  const home = (size: string, align = "justify-center") => (
    <Link href="/" aria-label={`${settings.storeName} home`} className={`flex items-center ${align}`}>
      {logoUrl ? <StoreLogoImage src={resolveImageUrl(logoUrl)} alt={settings.storeName} className={size} fallback={wordmark} /> : wordmark}
    </Link>
  );

  return (
    <HeaderShell>
      <div className="glass border-b border-ink-900/[0.06]">
        <PhoneNavBar brand={home("h-7 w-28 object-contain")}>
          <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center px-1.5 lg:hidden">
            <TahafiSearchButton className={PHONE_ICON} />
            {home("h-7 w-28 object-contain")}
            <Link href="/account" aria-label="Your account" className={`${PHONE_ICON} justify-self-end`}>
              <User size={21} aria-hidden="true" />
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
          <TahafiHeaderActions />
        </div>
      </div>
    </HeaderShell>
  );
}
