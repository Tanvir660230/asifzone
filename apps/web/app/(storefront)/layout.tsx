import type { ReactNode } from "react";
import { Header } from "@/components/storefront/header";
import { Footer } from "@/components/storefront/footer";
import { getActiveBanners, getCategoryTree } from "@/lib/api/storefront";

export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  const [{ tree }, { banners: announcements }] = await Promise.all([
    getCategoryTree(),
    getActiveBanners("PROMO_STRIP"),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header categories={tree} announcements={announcements} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
