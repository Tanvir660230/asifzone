import { HomepagePreviewFrame } from "@/components/admin/studio/homepage-preview-frame";
import {
  getActiveBanners,
  getActivePaymentMethodsSafe,
  getActiveSocialLinksSafe,
  getActiveFlashSale,
  getCategoryTreeSafe,
  getSiteSettingsSafe,
} from "@/lib/api/storefront";
import { storeLayout } from "@/lib/theme-layout";

/** The Storefront Studio's preview: the store's real header, footer and announcement bar around the homepage sections,
 * all drawn from the Studio's unsaved draft (components/admin/studio/homepage-preview-frame.tsx). No shopper-facing
 * extras (chat, bag drawer, bottom bar) — they would only cover the page being designed. */
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
    <div className="relative bg-canvas font-sans text-fg">
      <HomepagePreviewFrame
        settings={settings}
        socialLinks={links}
        paymentMethods={methods}
        tree={tree}
        banners={banners}
        flashSale={flashSale}
        layout={storeLayout()}
      />
    </div>
  );
}
