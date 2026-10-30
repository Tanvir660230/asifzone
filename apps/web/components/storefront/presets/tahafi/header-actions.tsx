"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Search, ShoppingBag, User } from "lucide-react";
import { useCartCount } from "@/store/cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { useSearchOverlayStore } from "@/store/search-overlay";
import { bagLabel } from "../../count-badge";

const ICON_BUTTON =
  "relative flex h-10 w-10 items-center justify-center rounded-full text-fg transition-colors duration-200 ease-smooth hover:bg-ink-900/[0.06]";

/** The persisted bag count, known only after mount (the server renders the bag without one). */
export function useShownBagCount() {
  const count = useCartCount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? count : 0;
}

/** The olive count on the bag. */
export function BagCount({ count, className = "-right-0.5 -top-0.5" }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span aria-hidden="true" className={`absolute ${className} flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-sale-500 px-1 text-[0.6875rem] font-semibold tabular-nums text-white`}>
      {count}
    </span>
  );
}

/** The header's right side on wide screens: a search field that opens the search sheet, light/dark, the account and the bag. */
export function TahafiHeaderActions({ modeToggle }: { modeToggle?: ReactNode }) {
  const openSearch = useSearchOverlayStore((s) => s.open);
  const openBag = useCartDrawerStore((s) => s.open);
  const count = useShownBagCount();

  return (
    <div className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={openSearch}
        className="mr-1.5 flex h-10 w-56 items-center gap-2 rounded-full bg-ink-900/[0.06] px-4 text-left text-sm text-fg-muted transition-colors duration-200 ease-smooth hover:bg-ink-900/[0.09] xl:w-64"
      >
        <Search size={17} aria-hidden="true" />
        Search jackets, panjabi…
      </button>
      {modeToggle}
      <Link href="/account" aria-label="Your account" className={ICON_BUTTON}>
        <User size={20} aria-hidden="true" />
      </Link>
      <button type="button" onClick={openBag} aria-label={bagLabel("Bag", count)} className={ICON_BUTTON}>
        <ShoppingBag size={20} aria-hidden="true" />
        <BagCount count={count} />
      </button>
    </div>
  );
}

/** The phone header's search button (the dock has one too; this keeps it at the top of the page, where people look). */
export function TahafiSearchButton({ className }: { className: string }) {
  const openSearch = useSearchOverlayStore((s) => s.open);
  return (
    <button type="button" onClick={openSearch} aria-label="Search" className={className}>
      <Search size={20} aria-hidden="true" />
    </button>
  );
}
