import type { ReactNode } from "react";
import { Header } from "@/components/storefront/header";
import { Footer } from "@/components/storefront/footer";
import { SearchOverlay } from "@/components/storefront/search-overlay";
import { AccountNav } from "@/components/account/account-nav";
import { VerifyEmailBanner } from "@/components/account/verify-email-banner";
import { Toaster } from "@/components/ui/toast";
import { getActiveSocialLinks, getCategoryTree, getSiteSettings } from "@/lib/api/storefront";

// Session-aware pages, must always be live — never cached or statically served.
export const dynamic = "force-dynamic";

export default async function AccountShellLayout({ children }: { children: ReactNode }) {
  const [{ tree }, { settings }, { links }] = await Promise.all([
    getCategoryTree(),
    getSiteSettings(),
    getActiveSocialLinks(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header categories={tree} settings={settings} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        <VerifyEmailBanner />
        <div className="flex flex-col gap-8 sm:flex-row">
          <AccountNav />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>
      <Footer settings={settings} socialLinks={links} />
      <SearchOverlay />
      <Toaster />
    </div>
  );
}
