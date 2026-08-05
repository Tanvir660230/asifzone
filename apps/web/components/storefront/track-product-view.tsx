"use client";

import { useEffect } from "react";
import { addRecentlyViewed } from "@/lib/recently-viewed";
import { logProductView } from "@/lib/api/storefront";

interface TrackProductViewProps {
  productId: string;
  categoryId: string;
  price: number;
}

/** Renders nothing — on mount, records this view to the visitor's local "recently viewed" list
 * and beacons a real, anonymous view-count log to the server (powers "N people viewed today"). */
export function TrackProductView({ productId, categoryId, price }: TrackProductViewProps) {
  useEffect(() => {
    addRecentlyViewed({ productId, categoryId, price });
    logProductView(productId);
  }, [productId, categoryId, price]);

  return null;
}
