"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { ProductGrid } from "@/components/storefront/product-grid";
import { ProductGridSkeleton } from "@/components/storefront/skeletons/product-grid-skeleton";
import { AccountTitle } from "@/components/account/account-ui";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { listWishlist } from "@/lib/api/wishlist";

/** The signed-in wishlist, inside the account (docs/ACCOUNT_HOME.md). Guests keep the device wishlist at /wishlist. */
export default function AccountSavedPage() {
  const { data, isPending, isError, refetch } = useQuery({ queryKey: ["wishlist"], queryFn: listWishlist });
  const products = data?.items.map((item) => item.product) ?? [];

  return (
    <div>
      <AccountTitle
        title="Saved for later"
        description={products.length > 0 ? `${products.length} ${products.length === 1 ? "item" : "items"} saved.` : "Tap the heart on anything you like to keep it here."}
      />
      {isPending ? (
        <ProductGridSkeleton count={4} />
      ) : isError ? (
        <ErrorState variant="bordered" title="Your saved items didn't load" onRetry={() => refetch()} />
      ) : products.length === 0 ? (
        <EmptyState
          variant="bordered"
          icon={Heart}
          title="Nothing saved yet"
          description="Browse the collection and tap the heart on anything you'd like to come back to."
          action={
            <Link href="/search" className={buttonVariants({ size: "sm" })}>
              Browse the collection
            </Link>
          }
        />
      ) : (
        <ProductGrid products={products} />
      )}
    </div>
  );
}
