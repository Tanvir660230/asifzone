import { HomepagePreviewFrame } from "@/components/admin/studio/homepage-preview-frame";
import { StoreFooter, StoreHeader } from "@/components/storefront/store-chrome";
import {
  getActiveBanners,
  getActivePaymentMethodsSafe,
  getActiveSocialLinksSafe,
  getActiveFlashSale,
  getCategoryTreeSafe,
  getSiteSettingsSafe,
} from "@/lib/api/storefront";
import { storeLayout } from "@/lib/theme-layout";

/** The Storefront Studio's preview: the store's real header and footer around the homepage sections, which the Studio
 * posts from its unsaved draft (components/admin/studio/homepage-preview-frame.tsx). No shopper-facing extras (chat,
 * bag drawer, bottom bar) — they would only cover the page being designed. */
export default async function HomepagePreviewFramePage() {
  const [{ tree }, { settings }, { links }, { methods }, banners, flashSale] = await Promise.all([
    getCategoryTreeSafe(),
    getSiteSettingsSafe(),
    getActiveSocialLinksSafe(),
    getActivePaymentMethodsSafe(),
    getActiveBanners("HERO_CAROUSEL").then((r) => r.banners).catch(() => []),
    getActiveFlashSale().then((r) => r.flashSale).catch(() => null),
  ]);

  return (
    <div className="relative flex min-h-screen flex-col bg-canvas font-sans text-fg">
      <StoreHeader categories={tree} settings={settings} />
      <main className="flex-1">
        <HomepagePreviewFrame
          storeName={settings.storeName}
          tagline={settings.tagline}
          tree={tree}
          banners={banners}
          flashSale={flashSale}
          layout={storeLayout()}
        />
      </main>
      <StoreFooter categories={tree} settings={settings} socialLinks={links} paymentMethods={methods} />
    </div>
  );
}
