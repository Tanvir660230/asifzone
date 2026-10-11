"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ProductGrid } from "@/components/storefront/product-grid";
import { StorefrontPage, StorefrontPageHeader } from "@/components/storefront/storefront-page";
import { ProductGridSkeleton } from "@/components/storefront/skeletons/product-grid-skeleton";
import { listWishlist } from "@/lib/api/wishlist";
import { fetchProductsByIds } from "@/lib/api/storefront";
import { useWishlistStore } from "@/store/wishlist";
import { useOptionalCustomer } from "@/hooks/use-current-customer";

// Guest-accessible, same as /cart — a signed-out shopper's wishlist lives in useWishlistStore
// (localStorage) rather than requiring login. A logged-in customer's wishlist is server-backed as
// before; the two views share this one page instead of the account-shell wishlist page guests used
// to get redirected away from. A logged-in customer is sent on to /account/saved.
export default function WishlistPage() {
  const { data: customerData } = useOptionalCustomer();
  const isLoggedIn = Boolean(customerData?.customer);
  const router = useRouter();

  // A signed-in customer's wishlist lives in the account (/account/saved, docs/ACCOUNT_HOME.md).
  useEffect(() => {
    if (isLoggedIn) router.replace("/account/saved");
  }, [isLoggedIn, router]);

  // The local store hydrates from localStorage after mount — render nothing store-derived until
  // then, same guard the cart page uses, to avoid a flash of "empty wishlist".
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const localIds = useWishlistStore((s) => s.productIds);

  const { data: serverData, isLoading: serverLoading } = useQuery({
    queryKey: ["wishlist"],
    queryFn: listWishlist,
    enabled: isLoggedIn,
  });

  const { data: guestData, isLoading: guestLoading } = useQuery({
    queryKey: ["wishlist-guest-products", localIds],
    queryFn: () => fetchProductsByIds(localIds),
    enabled: mounted && !isLoggedIn && localIds.length > 0,
  });

  const isLoading = isLoggedIn ? serverLoading : mounted && localIds.length > 0 && guestLoading;
  const products = isLoggedIn ? (serverData?.items.map((item) => item.product) ?? []) : (guestData?.items ?? []);

  const description =
    mounted && localIds.length > 0 ? (
      <>
        Saved on this device.{" "}
        <Link href={`/account/login?next=${encodeURIComponent("/wishlist")}`} className="font-medium text-fg underline underline-offset-2 hover:text-ink-700">
          Sign in
        </Link>{" "}
        to keep it on every device.
      </>
    ) : undefined;

  return (
    <StorefrontPage>
      <StorefrontPageHeader breadcrumb={[{ name: "Wishlist" }]} title="Wishlist" description={isLoggedIn ? undefined : description} />
      {/* A signed-in customer is on their way to /account/saved: nothing to show here meanwhile. */}
      {!isLoggedIn && (
        <>
          {(!mounted || isLoading) && localIds.length > 0 && <ProductGridSkeleton count={Math.min(localIds.length, 4)} />}
          {mounted && !isLoading && products.length === 0 && (
            <p className="text-ink-500">
              Nothing saved yet.{" "}
              <Link href="/search" className="font-medium text-fg underline underline-offset-2 hover:text-ink-700">
                Browse the collection
              </Link>{" "}
              and tap the heart on anything you like.
            </p>
          )}
          {mounted && !isLoading && products.length > 0 && <ProductGrid products={products} />}
        </>
      )}
    </StorefrontPage>
  );
}
