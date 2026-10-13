import { Suspense, type ReactNode } from "react";
import nextDynamic from "next/dynamic";
import { StoreFooter, StoreHeader } from "@/components/storefront/store-chrome";
import { AnnouncementBar } from "@/components/storefront/announcement-bar";
import { CartDrawer } from "@/components/storefront/cart-drawer";
import { AddedToBag } from "@/components/storefront/added-to-bag";
import { CartReminderBanner } from "@/components/storefront/cart-reminder-banner";
import { StickyCartBar } from "@/components/storefront/sticky-cart-bar";
import { StickyBottomBarSpacer } from "@/components/storefront/sticky-bottom-bar-spacer";
import { ContactWidget } from "@/components/storefront/contact-widget";
import { AppShellWorker } from "@/components/storefront/app-shell-worker";
import { NavigationProgress } from "@/components/storefront/navigation-progress";
import { MobileBottomNav } from "@/components/storefront/mobile-bottom-nav";
import { PageTransition } from "@/components/storefront/page-transition";
import { SkipToContentLink } from "@/components/storefront/skip-to-content-link";
import { Toaster } from "@/components/ui/toast";
import { storeLayout } from "@/lib/theme-layout";
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
  // The mihrab preset carries search, bag and menu in its header on phones: no bottom tab bar.
  const tabBar = storeLayout() === "classic";

  return (
    <div className="flex min-h-screen flex-col">
      <SkipToContentLink />
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <AnnouncementBar announcement={settings.storefrontDesign?.announcement} />
      <StoreHeader categories={tree} settings={settings} />
      {/* At least a viewport tall: the footer starts below the fold on first paint, so content that streams in (a route's
          loading state) or appears after hydration (cart/checkout read the persisted cart) never pushes it out of view —
          that push was a 0.2–0.6 layout shift on home, cart and checkout. */}
      <main id="main-content" className="min-h-[100svh] flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
      <StoreFooter categories={tree} settings={settings} socialLinks={links} paymentMethods={methods} />
      <StickyBottomBarSpacer />
      <SearchOverlay />
      <CartDrawer />
      <AddedToBag />
      <CartReminderBanner />
      <StickyCartBar />
      <ContactWidget socialLinks={links} settings={settings} />
      {tabBar && <MobileBottomNav />}
      <LiveChatWidget settings={settings} />
      <QuickViewModal />
      <CompareBar />
      <Toaster />
      <AppShellWorker />
    </div>
  );
}
