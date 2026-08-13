import type { ReactNode } from "react";
import { Header } from "@/components/storefront/header";
import { Footer } from "@/components/storefront/footer";
import { SearchOverlay } from "@/components/storefront/search-overlay";
import { CartDrawer } from "@/components/storefront/cart-drawer";
import { CartReminderBanner } from "@/components/storefront/cart-reminder-banner";
import { StickyCartBar } from "@/components/storefront/sticky-cart-bar";
import { StickyBottomBarSpacer } from "@/components/storefront/sticky-bottom-bar-spacer";
import { ContactWidget } from "@/components/storefront/contact-widget";
import { MobileBottomNav } from "@/components/storefront/mobile-bottom-nav";
import { LiveChatWidget } from "@/components/storefront/live-chat-widget";
import { QuickViewModal } from "@/components/storefront/quick-view-modal";
import { CompareBar } from "@/components/storefront/compare-bar";
import { PageTransition } from "@/components/storefront/page-transition";
import { SkipToContentLink } from "@/components/storefront/skip-to-content-link";
import { Toaster } from "@/components/ui/toast";
import {
  getActivePaymentMethodsSafe,
  getActiveSocialLinksSafe,
  getCategoryTreeSafe,
  getSiteSettingsSafe,
} from "@/lib/api/storefront";

/** Shared by both (storefront) and (storefront-detail) layouts — the latter exists only so
 * product/category pages aren't wrapped by (storefront)/loading.tsx's Suspense boundary, which
 * otherwise streams a 200 shell before their notFound() call can turn it into a real 404. */
export async function StorefrontShell({ children }: { children: ReactNode }) {
  const [{ tree }, { settings }, { links }, { methods }] = await Promise.all([
    getCategoryTreeSafe(),
    getSiteSettingsSafe(),
    getActiveSocialLinksSafe(),
    getActivePaymentMethodsSafe(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <SkipToContentLink />
      <Header categories={tree} settings={settings} />
      <main id="main-content" className="flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
      <Footer categories={tree} settings={settings} socialLinks={links} paymentMethods={methods} />
      <StickyBottomBarSpacer />
      <SearchOverlay />
      <CartDrawer />
      <CartReminderBanner />
      <StickyCartBar />
      <ContactWidget socialLinks={links} settings={settings} />
      <MobileBottomNav />
      <LiveChatWidget settings={settings} />
      <QuickViewModal />
      <CompareBar />
      <Toaster />
    </div>
  );
}
