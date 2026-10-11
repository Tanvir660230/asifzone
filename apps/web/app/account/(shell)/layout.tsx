import type { ReactNode } from "react";
import { AccountFooter, AccountTabs } from "@/components/account/account-tabs";
import { AccountContent } from "@/components/account/account-content";
import { AccountShellProvider } from "@/components/account/account-shell-context";
import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { StorefrontPage } from "@/components/storefront/storefront-page";
import { getSiteSettingsSafe } from "@/lib/api/storefront";
import { privatePageMetadata } from "@/lib/seo";

// Session-aware pages, must always be live — never cached or statically served.
export const dynamic = "force-dynamic";

// One shopper's account: titled, and kept out of search results (the pages are client components).
export const metadata = privatePageMetadata("My account");

/** One persistent shell for every signed-in account page (docs/ACCOUNT_HOME.md): the section tabs stay put and only
 * the content below them changes, so the account reads as one place rather than a set of separate pages. It sits inside
 * the regular storefront shell (header, footer, bottom nav, bag) and the shared page frame, so the account is part of
 * the site, not a different one. */
export default async function AccountShellLayout({ children }: { children: ReactNode }) {
  const { settings } = await getSiteSettingsSafe();

  return (
    <StorefrontShell>
      <StorefrontPage>
        <AccountShellProvider storeName={settings.storeName}>
          <AccountTabs />
          <AccountContent>{children}</AccountContent>
          <AccountFooter />
        </AccountShellProvider>
      </StorefrontPage>
    </StorefrontShell>
  );
}
