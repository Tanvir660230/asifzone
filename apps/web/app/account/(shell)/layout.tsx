import type { ReactNode } from "react";
import { Header } from "@/components/storefront/header";
import { Footer } from "@/components/storefront/footer";
import { AccountNav } from "@/components/account/account-nav";
import { getActiveBanners, getCategoryTree } from "@/lib/api/storefront";

export default async function AccountShellLayout({ children }: { children: ReactNode }) {
  const [{ tree }, { banners: announcements }] = await Promise.all([
    getCategoryTree(),
    getActiveBanners("PROMO_STRIP"),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header categories={tree} announcements={announcements} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 sm:flex-row">
          <AccountNav />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
