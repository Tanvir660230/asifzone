"use client";

import { useEffect } from "react";
import { addRecentlyViewed } from "@/lib/recently-viewed";
import { logProductView } from "@/lib/api/storefront";
import { pixelViewContent } from "@/lib/meta-pixel";

interface TrackProductViewProps {
  productId: string;
  productName: string;
  categoryId: string;
  price: number;
}

/** Renders nothing — on mount, records this view to the visitor's local "recently viewed" list,
 * beacons a real, anonymous view-count log to the server (powers "N people viewed today"), and
 * fires the Meta Pixel ViewContent event. */
export function TrackProductView({ productId, productName, categoryId, price }: TrackProductViewProps) {
  useEffect(() => {
    addRecentlyViewed({ productId, categoryId, price });
    logProductView(productId);
    pixelViewContent({ contentId: productId, contentName: productName, value: price });
  }, [productId, productName, categoryId, price]);

  return null;
}
