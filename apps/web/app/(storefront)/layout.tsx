import type { ReactNode } from "react";
import { Header } from "@/components/storefront/header";
import { Footer } from "@/components/storefront/footer";
import { SearchOverlay } from "@/components/storefront/search-overlay";
import { CartReminderBanner } from "@/components/storefront/cart-reminder-banner";
import { StickyCartBar } from "@/components/storefront/sticky-cart-bar";
import { WhatsAppButton } from "@/components/storefront/whatsapp-button";
import { LiveChatWidget } from "@/components/storefront/live-chat-widget";
import { QuickViewModal } from "@/components/storefront/quick-view-modal";
import { CompareBar } from "@/components/storefront/compare-bar";
import { PageTransition } from "@/components/storefront/page-transition";
import { SkipToContentLink } from "@/components/storefront/skip-to-content-link";
import { getActiveSocialLinksSafe, getCategoryTreeSafe, getSiteSettingsSafe } from "@/lib/api/storefront";

export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  const [{ tree }, { settings }, { links }] = await Promise.all([
    getCategoryTreeSafe(),
    getSiteSettingsSafe(),
    getActiveSocialLinksSafe(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <SkipToContentLink />
      <Header categories={tree} settings={settings} />
      <main id="main-content" className="flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
      <Footer categories={tree} settings={settings} socialLinks={links} />
      <SearchOverlay />
      <CartReminderBanner />
      <StickyCartBar />
      <WhatsAppButton socialLinks={links} />
      <LiveChatWidget />
      <QuickViewModal />
      <CompareBar />
    </div>
  );
}
