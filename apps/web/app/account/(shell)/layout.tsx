import type { ReactNode } from "react";
import { Header } from "@/components/storefront/header";
import { Footer } from "@/components/storefront/footer";
import { SearchOverlay } from "@/components/storefront/search-overlay";
import { AccountFooter, AccountTabs } from "@/components/account/account-tabs";
import { AccountContent } from "@/components/account/account-content";
import { AccountShellProvider } from "@/components/account/account-shell-context";
import { Toaster } from "@/components/ui/toast";
import { getActiveSocialLinks, getCategoryTree, getSiteSettings } from "@/lib/api/storefront";

// Session-aware pages, must always be live — never cached or statically served.
export const dynamic = "force-dynamic";

/** One persistent shell for every signed-in account page (docs/ACCOUNT_HOME.md): the section tabs stay put and only
 * the content below them changes, so the account reads as one place rather than a set of separate pages. */
export default async function AccountShellLayout({ children }: { children: ReactNode }) {
  const [{ tree }, { settings }, { links }] = await Promise.all([
    getCategoryTree(),
    getSiteSettings(),
    getActiveSocialLinks(),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header categories={tree} settings={settings} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-10">
        <AccountShellProvider storeName={settings.storeName}>
          <AccountTabs />
          <AccountContent>{children}</AccountContent>
          <AccountFooter />
        </AccountShellProvider>
      </main>
      <Footer settings={settings} socialLinks={links} />
      <SearchOverlay />
      <Toaster />
    </div>
  );
}
