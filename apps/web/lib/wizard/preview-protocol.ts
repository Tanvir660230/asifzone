import type { Product } from "@clothing-brand/shared";

export type PreviewMode = "product" | "listing" | "search" | "social" | "serp";
export type PreviewDevice = "desktop" | "tablet" | "mobile";

/** Real viewport widths, not a scaled screenshot: the frame renders at this width so the storefront's own
 * breakpoints (sm/lg) respond exactly as they do on that device, and the pane then scales the frame to fit. */
export const PREVIEW_DEVICE_WIDTH: Record<PreviewDevice, number> = { desktop: 1280, tablet: 834, mobile: 390 };

export const PREVIEW_FRAME_PATH = "/admin/product-preview-frame";

/** Wizard → frame: the product as it would render right now (unsaved values included) and which surface to show. */
export interface PreviewUpdateMessage {
  type: "pim-preview:update";
  mode: PreviewMode;
  product: Product;
}

/** Frame → wizard: the frame's listener is attached, so send the current state (avoids a race on first load). */
export interface PreviewReadyMessage {
  type: "pim-preview:ready";
}
