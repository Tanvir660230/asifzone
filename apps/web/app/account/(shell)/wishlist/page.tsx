"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ProductGrid } from "@/components/storefront/product-grid";
import { listWishlist } from "@/lib/api/wishlist";

export default function AccountWishlistPage() {
  const { data, isLoading } = useQuery({ queryKey: ["wishlist"], queryFn: listWishlist });

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl text-ink-900">Wishlist</h1>

      {isLoading && <p className="text-ink-400">Loading…</p>}
      {!isLoading && data?.items.length === 0 && (
        <p className="text-ink-400">
          Nothing saved yet —{" "}
          <Link href="/search" className="text-brass-600 underline hover:text-brass-500">
            browse the collection
          </Link>{" "}
          and tap the heart on anything you like.
        </p>
      )}

      {data && data.items.length > 0 && <ProductGrid products={data.items.map((item) => item.product)} />}
    </div>
  );
}
