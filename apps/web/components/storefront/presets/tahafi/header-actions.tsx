"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCartCount } from "@/store/cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { useSearchOverlayStore } from "@/store/search-overlay";
import { bagLabel } from "../../count-badge";
import { TAHAFI_NAV_LINK } from "./styles";

/** The header's right side on wide screens: words, not icons — search, the shopper's own pages, and the bag with its count. */
export function TahafiHeaderActions() {
  const openSearch = useSearchOverlayStore((s) => s.open);
  const openBag = useCartDrawerStore((s) => s.open);
  const count = useCartCount();
  // The persisted count is only known after mount; the server renders the bag without one.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const shown = mounted ? count : 0;

  return (
    <nav aria-label="Your account" className="flex items-center justify-end gap-7">
      <button type="button" onClick={openSearch} className={TAHAFI_NAV_LINK}>
        Search
      </button>
      <Link href="/track-order" className={TAHAFI_NAV_LINK}>
        Track order
      </Link>
      <Link href="/account" className={TAHAFI_NAV_LINK}>
        Account
      </Link>
      <button type="button" onClick={openBag} aria-label={bagLabel("Bag", shown)} className={TAHAFI_NAV_LINK}>
        Bag{shown > 0 && <span className="ml-1 tabular-nums">({shown})</span>}
      </button>
    </nav>
  );
}
