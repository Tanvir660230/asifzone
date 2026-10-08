"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import type { Order } from "@clothing-brand/shared";
import { AccountTitle, GroupedList, ListRow, OrderThumb } from "@/components/account/account-ui";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/tabs";
import { AccountPageSkeleton } from "@/components/account/account-skeleton";
import { listMyOrders } from "@/lib/api/customers";
import { formatPrice, formatStoreDate, orderStatusBadgeClass, orderStatusLabel } from "@/lib/format";

const PAGE_SIZE = 20;
const OPEN: Order["status"][] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"];

type Filter = "all" | "open" | "done";

function itemsTitle(order: Order): string {
  const first = order.items[0]?.productNameSnapshot;
  if (!first) return order.orderNumber;
  return order.items.length > 1 ? `${first} and ${order.items.length - 1} more` : first;
}

export default function AccountOrdersPage() {
  // The filter lives in the URL (?show=open|done) so a filtered list can be linked to and survives Back.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const show = searchParams.get("show");
  const filter: Filter = show === "open" || show === "done" ? show : "all";
  const setFilter = (next: Filter) => router.replace(next === "all" ? pathname : `${pathname}?show=${next}`, { scroll: false });
  const query = useInfiniteQuery({
    queryKey: ["my-orders", "infinite"],
    queryFn: ({ pageParam }) => listMyOrders({ page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });

  if (query.isPending) return <AccountPageSkeleton />;

  const orders = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  const shown = orders.filter((o) => (filter === "all" ? true : filter === "open" ? OPEN.includes(o.status) : !OPEN.includes(o.status)));

  return (
    <div>
      <AccountTitle
        title="Orders"
        description={total > 0 ? `${total} ${total === 1 ? "order" : "orders"} so far. Open one to track it, change it or ask for a return.` : "Track and review everything you've ordered."}
        action={
          total > 0 && (
            <SegmentedControl<Filter>
              aria-label="Show orders"
              size="md"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "open", label: "In progress" },
                { value: "done", label: "Completed" },
              ]}
            />
          )
        }
      />

      {query.isError ? (
        <ErrorState variant="bordered" title="Your orders didn't load" onRetry={() => query.refetch()} />
      ) : total === 0 ? (
        <EmptyState
          variant="bordered"
          icon={Package}
          title="No orders yet"
          description="Once you place an order, you can follow it here."
          action={
            <Link href="/search" className={buttonVariants({ size: "sm" })}>
              Start shopping
            </Link>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          variant="bordered"
          icon={Package}
          title={filter === "open" ? "Nothing on its way right now" : "No completed orders yet"}
          description={query.hasNextPage ? "Older orders may match — load more below." : undefined}
        />
      ) : (
        <GroupedList data-testid="orders-list">
          {shown.map((order) => (
            <ListRow
              key={order.id}
              href={`/account/orders/${order.id}`}
              leading={<OrderThumb imageUrl={order.previewImageUrl ?? null} alt="" className="h-14 w-14 rounded-xl sm:h-16 sm:w-16" sizes="64px" />}
              title={itemsTitle(order)}
              subtitle={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge className={orderStatusBadgeClass(order.status)}>{orderStatusLabel(order.status)}</Badge>
                  <span className="font-medium tabular-nums text-fg sm:hidden">{formatPrice(order.total)}</span>
                  <span className="w-full sm:w-auto">
                    {order.orderNumber}, {formatStoreDate(order.createdAt, { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </span>
              }
              trailing={<span className="hidden font-medium tabular-nums text-fg sm:inline">{formatPrice(order.total)}</span>}
            />
          ))}
        </GroupedList>
      )}

      {query.hasNextPage && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>
            Show older orders
          </Button>
        </div>
      )}
    </div>
  );
}
