import type { ReactNode } from "react";
import nextDynamic from "next/dynamic";
import { Header } from "@/components/storefront/header";
import { Footer } from "@/components/storefront/footer";
import { CartDrawer } from "@/components/storefront/cart-drawer";
import { CartReminderBanner } from "@/components/storefront/cart-reminder-banner";
import { StickyCartBar } from "@/components/storefront/sticky-cart-bar";
import { StickyBottomBarSpacer } from "@/components/storefront/sticky-bottom-bar-spacer";
import { ContactWidget } from "@/components/storefront/contact-widget";
import { MobileBottomNav } from "@/components/storefront/mobile-bottom-nav";
import { PageTransition } from "@/components/storefront/page-transition";
import { SkipToContentLink } from "@/components/storefront/skip-to-content-link";
import { Toaster } from "@/components/ui/toast";
import {
  getActivePaymentMethodsSafe,
  getActiveSocialLinksSafe,
  getCategoryTreeSafe,
  getSiteSettingsSafe,
} from "@/lib/api/storefront";

// Interaction-triggered overlays — idle on the vast majority of page views (a shopper has to open
// search/quick-view/compare/chat before any of these render anything) — split out of the initial
// bundle every storefront page pays for, same reasoning as the homepage's own below-the-fold
// next/dynamic sections. CartDrawer stays eager: it's opened from the header's cart icon, which
// gets used on close to every page view, so deferring it would trade a real, common interaction's
// responsiveness for a saving that rarely pays off.
const SearchOverlay = nextDynamic(() => import("@/components/storefront/search-overlay").then((m) => m.SearchOverlay));
const QuickViewModal = nextDynamic(() => import("@/components/storefront/quick-view-modal").then((m) => m.QuickViewModal));
const CompareBar = nextDynamic(() => import("@/components/storefront/compare-bar").then((m) => m.CompareBar));
const LiveChatWidget = nextDynamic(() =>
  import("@/components/storefront/live-chat-widget").then((m) => m.LiveChatWidget),
);

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
