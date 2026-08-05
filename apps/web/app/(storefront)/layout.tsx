import type { ReactNode } from "react";
import { Header } from "@/components/storefront/header";
import { Footer } from "@/components/storefront/footer";
import { SearchOverlay } from "@/components/storefront/search-overlay";
import { CartReminderBanner } from "@/components/storefront/cart-reminder-banner";
import { getActiveSocialLinks, getCategoryTree, getSiteSettings } from "@/lib/api/storefront";

export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  const [{ tree }, { settings }, { links }] = await Promise.all([
    getCategoryTree(),
    getSiteSettings(),
    getActiveSocialLinks(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header categories={tree} settings={settings} />
      <main className="flex-1">{children}</main>
      <Footer categories={tree} settings={settings} socialLinks={links} />
      <SearchOverlay />
      <CartReminderBanner />
    </div>
  );
}
