declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

function fbq(...args: unknown[]): void {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq(...args);
}

/** Client-side-navigation pageviews — the base pixel snippet only fires its own PageView once,
 * on first script load, so every route change after that needs an explicit call. */
export function pixelPageView(): void {
  fbq("track", "PageView");
}

export function pixelViewContent(params: { contentId: string; contentName: string; value: number }): void {
  fbq("track", "ViewContent", {
    content_ids: [params.contentId],
    content_name: params.contentName,
    content_type: "product",
    value: params.value,
    currency: "BDT",
  });
}

export function pixelAddToCart(params: { contentId: string; contentName: string; value: number; quantity: number }): void {
  fbq("track", "AddToCart", {
    content_ids: [params.contentId],
    content_name: params.contentName,
    content_type: "product",
    contents: [{ id: params.contentId, quantity: params.quantity }],
    value: params.value * params.quantity,
    currency: "BDT",
  });
}

export function pixelInitiateCheckout(params: { contentIds: string[]; value: number; numItems: number }): void {
  fbq("track", "InitiateCheckout", {
    content_ids: params.contentIds,
    content_type: "product",
    value: params.value,
    num_items: params.numItems,
    currency: "BDT",
  });
}

export function pixelPurchase(params: { contentIds: string[]; value: number; numItems: number }): void {
  fbq("track", "Purchase", {
    content_ids: params.contentIds,
    content_type: "product",
    value: params.value,
    num_items: params.numItems,
    currency: "BDT",
  });
}
