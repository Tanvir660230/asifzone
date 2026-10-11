"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ACCOUNT_SUMMARY_KEY, getMyAccountSummary, getMyStoreCredit, listAddresses, listMyOrders, listMyPointsLedger } from "@/lib/api/customers";
import { listWishlist } from "@/lib/api/wishlist";
import { listActiveCoupons } from "@/lib/api/coupons";
import { listMyReturnRequests } from "@/lib/api/return-requests";

/** The orders list's first page — the same key, fetcher and page size as app/account/(shell)/orders/page.tsx. */
export const MY_ORDERS_PAGE_SIZE = 20;

/**
 * Loads every account section's data once the account opens (while the browser is idle), under the same query keys the
 * pages read — so moving between the tabs shows each section straight away instead of a loading state. Data a page has
 * already loaded is left alone (prefetch only fills what's missing or stale). Renders nothing.
 */
export function AccountPrefetch() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const run = () => {
      const quiet = (p: Promise<unknown>) => p.catch(() => undefined);
      quiet(queryClient.prefetchQuery({ queryKey: ACCOUNT_SUMMARY_KEY, queryFn: getMyAccountSummary }));
      quiet(
        queryClient.prefetchInfiniteQuery({
          queryKey: ["my-orders", "infinite"],
          queryFn: ({ pageParam }) => listMyOrders({ page: pageParam, pageSize: MY_ORDERS_PAGE_SIZE }),
          initialPageParam: 1,
        }),
      );
      quiet(queryClient.prefetchQuery({ queryKey: ["my-addresses"], queryFn: listAddresses }));
      quiet(queryClient.prefetchQuery({ queryKey: ["wishlist"], queryFn: listWishlist }));
      quiet(queryClient.prefetchQuery({ queryKey: ["my-store-credit"], queryFn: getMyStoreCredit }));
      quiet(queryClient.prefetchQuery({ queryKey: ["active-coupons"], queryFn: () => listActiveCoupons() }));
      quiet(queryClient.prefetchQuery({ queryKey: ["my-return-requests"], queryFn: () => listMyReturnRequests() }));
      quiet(queryClient.prefetchQuery({ queryKey: ["my-points"], queryFn: () => listMyPointsLedger() }));
    };
    // After the page in view has what it needs: idle time if the browser offers it, else shortly after.
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(run, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [queryClient]);

  return null;
}
