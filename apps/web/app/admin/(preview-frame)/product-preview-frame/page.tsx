import { storePolicy } from "@clothing-brand/shared";
import { LivePreviewFrame } from "@/components/admin/product-builder/live-preview-frame";
import { getSiteSettingsSafe } from "@/lib/api/storefront";

export default async function ProductPreviewFramePage() {
  // The preview shows the store's real policy lines, exactly as the live product page will.
  const { settings } = await getSiteSettingsSafe();
  return <LivePreviewFrame policy={storePolicy(settings)} />;
}
