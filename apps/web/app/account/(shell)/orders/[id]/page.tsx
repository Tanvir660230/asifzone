"use client";

import { formatVariantLabel, formatVariantSuffix } from "@clothing-brand/shared";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Printer, RotateCcw, PackageSearch, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { BackLink } from "@/components/ui/back-link";
import { toast } from "@/components/ui/toast";
import { OrderThumb } from "@/components/account/account-ui";
import { ORDER_PROGRESS_STEPS, RETURN_STATUS_LABEL, orderHeadline, orderProgressIndex } from "@/lib/account";
import { cn } from "@/lib/utils";
import { AccountEmptyState } from "@/components/account/account-empty-state";
import { OrderSelfService } from "@/components/account/order-self-service";
import { getMyOrder } from "@/lib/api/customers";
import { createReturnRequest } from "@/lib/api/return-requests";
import { getProductBySlug, listStorefrontProducts } from "@/lib/api/storefront";
import { useCartStore } from "@/store/cart";
import { formatPrice, formatStoreDateTime, orderStatusLabel } from "@/lib/format";
import { productDisplayPrice } from "@/lib/pricing-display";
import { variantAvailabilityOf } from "@/lib/availability-display";
import { ApiError } from "@/lib/api-client";

const RETURN_REASONS = [
  "Wrong item received",
  "Item damaged or defective",
  "Item doesn't fit",
  "No longer needed",
  "Other",
];

const EXCHANGE_REASONS = ["Wrong size", "Wrong color", "Prefer a different size", "Other"];

export default function AccountOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const addItem = useCartStore((s) => s.addItem);

  const [formMode, setFormMode] = useState<"return" | "exchange" | null>(null);
  const [reason, setReason] = useState(RETURN_REASONS[0]!);
  const [note, setNote] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [exchangeItemId, setExchangeItemId] = useState("");
  const [exchangeVariantId, setExchangeVariantId] = useState("");
  // Overrides which product's variants the size/color picker below shows — null means "the item's
  // own product" (the common case: same item, different size/color). Set once the customer picks a
  // result from the cross-product search, so an exchange isn't limited to the original product.
  const [exchangeProductOverrideSlug, setExchangeProductOverrideSlug] = useState<string | null>(null);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");

  const { data, isLoading, isError } = useQuery({ queryKey: ["my-order", id], queryFn: () => getMyOrder(id) });

  const exchangeItem = data?.order.items.find((item) => item.id === exchangeItemId) ?? null;
  const exchangeProductSlug = exchangeProductOverrideSlug ?? exchangeItem?.live?.productSlug ?? null;
  const { data: exchangeProductData, isLoading: exchangeProductLoading } = useQuery({
    queryKey: ["product-slug", exchangeProductSlug],
    queryFn: () => getProductBySlug(exchangeProductSlug!),
    enabled: formMode === "exchange" && Boolean(exchangeProductSlug),
  });
  // In stock, and not literally the same variant the customer already has — that's it. No longer
  // restricted to the original item's own product, so a completely different product is a valid
  // exchange target too (createExchangeOrder on the API side bills any price difference as COD).
  const exchangeProduct = exchangeProductData?.product;
  const exchangeVariantOptions = (exchangeProduct?.variants ?? []).filter(
    // Server-derived availability (D5: an untracked product's variants are always sellable).
    (v) => v.id !== exchangeItem?.variantId && Boolean(exchangeProduct && variantAvailabilityOf(exchangeProduct, v.id)?.sellable),
  );

  const productSearchEnabled = formMode === "exchange" && showProductSearch && productSearchQuery.trim().length >= 2;
  const { data: productSearchResults, isLoading: productSearchLoading } = useQuery({
    queryKey: ["exchange-product-search", productSearchQuery],
    queryFn: () => listStorefrontProducts({ search: productSearchQuery.trim(), pageSize: 8 }),
    enabled: productSearchEnabled,
  });

  const requestMutation = useMutation({
    mutationFn: () =>
      createReturnRequest(
        formMode === "exchange"
          ? {
              orderId: id,
              type: "EXCHANGE",
              reason,
              note: note || null,
              orderItemId: exchangeItemId,
              requestedVariantId: exchangeVariantId,
            }
          : { orderId: id, type: "RETURN", reason, note: note || null },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-order", id] });
      const wasExchange = formMode === "exchange";
      setFormMode(null);
      setNote("");
      setExchangeItemId("");
      setExchangeVariantId("");
      setExchangeProductOverrideSlug(null);
      setShowProductSearch(false);
      setProductSearchQuery("");
      toast.success(wasExchange ? "Exchange request submitted" : "Return request submitted");
    },
    onError: (err) => setRequestError(err instanceof ApiError ? err.message : "Could not submit request"),
  });

  if (isError) {
    return (
      <div className="space-y-6">
        <BackLink href="/account/orders" label="All orders" />
        <AccountEmptyState
          icon={PackageSearch}
          title="Order not found"
          description="This order doesn't exist, or isn't linked to your account."
          action={
            <Link href="/account/orders" className={buttonVariants({ size: "sm" })}>
              See all orders
            </Link>
          }
        />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-8" aria-busy="true" aria-label="Loading order">
        <Skeleton className="h-4 w-24 rounded" />
        <Skeleton className="h-12 w-72 max-w-full rounded-lg" />
        <Skeleton className="h-48 rounded-3xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const { order } = data;
  const latestReturnRequest = order.returnRequests?.[0];
  const canRequestNew =
    order.status === "DELIVERED" && !order.returnRequests?.some((r) => r.status === "PENDING" || r.status === "APPROVED");
  // Exchange needs to know the product's other sizes/colors — an item whose product/variant was
  // since deleted (no `live` info) has nowhere to source that list from.
  const itemsEligibleForExchange = order.items.filter((item) => item.live);

  function openReturnForm() {
    setFormMode("return");
    setReason(RETURN_REASONS[0]!);
    setRequestError(null);
  }

  function openExchangeForm() {
    setFormMode("exchange");
    setReason(EXCHANGE_REASONS[0]!);
    setExchangeItemId(itemsEligibleForExchange[0]?.id ?? "");
    setExchangeVariantId("");
    setExchangeProductOverrideSlug(null);
    setShowProductSearch(false);
    setProductSearchQuery("");
    setRequestError(null);
  }

  function closeForm() {
    setFormMode(null);
    setNote("");
    setRequestError(null);
  }

  function handleReorder() {
    const available = order.items.filter((item) => item.live);
    const skipped = order.items.length - available.length;

    for (const item of available) {
      const live = item.live!;
      addItem(
        {
          variantId: item.variantId,
          productId: live.productId,
          productSlug: live.productSlug,
          productName: live.productName,
          sku: item.skuSnapshot,
          size: item.sizeSnapshot,
          color: item.colorSnapshot,
          price: live.price,
          imageUrl: live.imageUrl,
          maxStock: live.maxStock,
        },
        Math.min(item.quantity, live.maxStock),
      );
    }

    if (available.length === 0) {
      toast.error("None of these items are available to reorder right now");
      return;
    }
    toast.success(skipped > 0 ? `Added ${available.length} item(s) — ${skipped} no longer available` : "Added to cart");
    router.push("/cart");
  }

  const { title: statusTitle, detail: statusDetail } = orderHeadline(order.status);
  const progressIndex = orderProgressIndex(order.status);

  return (
    <div className="space-y-8">
      <div>
        <BackLink href="/account/orders" label="All orders" />
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-display-md tracking-tight text-fg sm:text-display-lg">Order {order.orderNumber}</h1>
            <p className="mt-2 text-base text-fg-muted">Placed {formatStoreDateTime(order.createdAt)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/account/orders/${id}/invoice`} target="_blank" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Printer size={14} aria-hidden="true" /> Invoice
            </Link>
            <Button size="sm" onClick={handleReorder}>
              <RotateCcw size={14} aria-hidden="true" /> Buy again
            </Button>
          </div>
        </div>
      </div>

      <section aria-labelledby="order-status-title" className="rounded-3xl bg-surface p-6 shadow-sm ring-1 ring-inset ring-line-subtle sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-xl">
            <h2 id="order-status-title" className="font-display text-[1.75rem] leading-tight tracking-tight text-fg">
              {statusTitle}
            </h2>
            {statusDetail && <p className="mt-1.5 text-[15px] text-ink-600">{statusDetail}</p>}
          </div>
          {order.courierTrackingLink && order.status === "SHIPPED" && (
            <a href={order.courierTrackingLink} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <Truck size={14} aria-hidden="true" /> Track parcel
            </a>
          )}
        </div>

        {progressIndex !== null && (
          <ol className="mt-8 grid grid-cols-5 gap-2" aria-label="Order progress">
            {ORDER_PROGRESS_STEPS.map((step, i) => {
              const done = i <= progressIndex;
              return (
                <li key={step.status} aria-current={i === progressIndex ? "step" : undefined} className="min-w-0">
                  <div className={cn("h-1 rounded-full", done ? "bg-accent" : "bg-line")} />
                  <p
                    className={cn(
                      "mt-2 text-xs sm:truncate sm:text-[13px]",
                      i === progressIndex ? "whitespace-nowrap font-semibold text-fg" : done ? "text-fg" : "text-fg-subtle",
                      // Phones show only the current step's label; the bars carry the rest.
                      i !== progressIndex && "invisible sm:visible",
                    )}
                  >
                    {step.label}
                  </p>
                </li>
              );
            })}
          </ol>
        )}

        <details className="group mt-8 border-t border-line-subtle pt-5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
            Full history
            <ChevronDown size={16} className="text-fg-muted transition-transform duration-base ease-smooth group-open:rotate-180" aria-hidden="true" />
          </summary>
          <ol className="mt-4 space-y-4 border-l border-line pl-5">
            {order.statusHistory.map((entry, i) => (
              <li key={entry.id} className="relative text-sm" aria-current={i === order.statusHistory.length - 1 ? "step" : undefined}>
                <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-accent ring-4 ring-surface" aria-hidden="true" />
                <p className="font-medium text-fg">{orderStatusLabel(entry.status)}</p>
                <p className="text-xs text-fg-muted">{formatStoreDateTime(entry.createdAt)}</p>
                {entry.note && <p className="mt-1 text-ink-600">{entry.note}</p>}
              </li>
            ))}
          </ol>
        </details>
      </section>

      <OrderSelfService order={order} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="items-title">
          <h2 id="items-title" className="mb-3.5 px-1 text-lg font-semibold tracking-tight text-fg sm:text-xl">
            {order.items.length === 1 ? "1 item" : `${order.items.length} items`}
          </h2>
          <ul className="divide-y divide-line-subtle overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-inset ring-line-subtle">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-center gap-4 px-4 py-4 sm:px-5">
                <OrderThumb imageUrl={item.live?.imageUrl ?? null} alt="" className="h-20 w-16 rounded-xl" sizes="64px" />
                <div className="min-w-0 flex-1">
                  {item.live ? (
                    <Link href={`/product/${item.live.productSlug}`} className="font-medium text-fg hover:underline hover:underline-offset-2">
                      {item.productNameSnapshot}
                    </Link>
                  ) : (
                    <p className="font-medium text-fg">{item.productNameSnapshot}</p>
                  )}
                  <p className="mt-0.5 text-sm text-fg-muted">
                    {formatVariantLabel(item.sizeSnapshot, item.colorSnapshot)}
                    {item.quantity > 1 && `, ${item.quantity} pieces`}
                  </p>
                  {!item.live && <p className="mt-0.5 text-xs text-fg-subtle">No longer available</p>}
                </div>
                <span className="shrink-0 tabular-nums text-fg">{formatPrice(Number(item.priceSnapshot) * item.quantity)}</span>
              </li>
            ))}
          </ul>
        </section>

        <aside className="space-y-8 lg:pt-11">
          <section aria-label="Payment summary" className="rounded-2xl bg-surface p-5 text-sm shadow-sm ring-1 ring-inset ring-line-subtle">
            <dl className="space-y-2">
              <div className="flex justify-between text-ink-600">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">{formatPrice(order.subtotal)}</dd>
              </div>
              {Number(order.discount) > 0 && (
                <div className="flex justify-between text-success-700">
                  <dt>Discount</dt>
                  <dd className="tabular-nums">−{formatPrice(order.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between text-ink-600">
                <dt>Delivery</dt>
                <dd className="tabular-nums">{Number(order.shippingFee) > 0 ? formatPrice(order.shippingFee) : "Free"}</dd>
              </div>
              <div className="flex justify-between border-t border-line-subtle pt-3 text-base font-semibold text-fg">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatPrice(order.total)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-fg-muted">{order.paymentMethod === "COD" ? "Cash on delivery" : "Paid online"}</p>
          </section>

          <section aria-labelledby="ship-to-title" className="rounded-2xl bg-surface p-5 text-sm shadow-sm ring-1 ring-inset ring-line-subtle">
            <h2 id="ship-to-title" className="font-medium text-fg">
              Delivering to
            </h2>
            <p className="mt-1.5 leading-relaxed text-ink-600">
              {order.customerName}, {order.customerPhone}
              <br />
              {order.shippingAddressLine}, {order.shippingArea}, {order.shippingDistrict}
            </p>
          </section>
        </aside>
      </div>

      {(latestReturnRequest || canRequestNew) && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Return or exchange</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {latestReturnRequest && (
              <div className="text-sm text-ink-700">
                <p>
                  {latestReturnRequest.type === "EXCHANGE" ? "Exchange request" : "Return request"}:{" "}
                  <span className="font-medium text-ink-900">{RETURN_STATUS_LABEL[latestReturnRequest.status] ?? latestReturnRequest.status}</span>
                </p>
                {latestReturnRequest.type === "EXCHANGE" && latestReturnRequest.originalSizeSnapshot && (
                  <p className="mt-0.5 text-ink-500">
                    {latestReturnRequest.originalSizeSnapshot}/{latestReturnRequest.originalColorSnapshot} →{" "}
                    {latestReturnRequest.requestedSizeSnapshot}/{latestReturnRequest.requestedColorSnapshot}
                  </p>
                )}
                <p className="mt-0.5 text-ink-500">Reason: {latestReturnRequest.reason}</p>
                {latestReturnRequest.status === "APPROVED" && latestReturnRequest.compensation === "STORE_CREDIT" && Number(latestReturnRequest.compensationAmount ?? 0) > 0 ? (
                  <p className="mt-1 font-medium text-success-700" data-testid="return-outcome">
                    {formatPrice(Number(latestReturnRequest.compensationAmount))} was added to your{" "}
                    <Link href="/account/store-balance" className="underline underline-offset-2">
                      Store Balance
                    </Link>
                    .
                  </p>
                ) : latestReturnRequest.status === "APPROVED" && latestReturnRequest.compensation === "REFUND" && Number(latestReturnRequest.compensationAmount ?? 0) > 0 ? (
                  <p className="mt-1 font-medium text-ink-800" data-testid="return-outcome">
                    A refund of {formatPrice(Number(latestReturnRequest.compensationAmount))} is on its way to you.
                  </p>
                ) : (
                  latestReturnRequest.status === "APPROVED" &&
                  latestReturnRequest.type === "RETURN" && (
                    <p className="mt-0.5 text-ink-500">
                      Refund status follows the order status above — currently <span className="font-medium">{orderStatusLabel(order.status)}</span>.
                    </p>
                  )
                )}
                {latestReturnRequest.status === "APPROVED" && latestReturnRequest.type === "EXCHANGE" && (
                  <p className="mt-0.5 text-ink-500">
                    {latestReturnRequest.exchangeOrder ? (
                      <>
                        Your replacement is on order{" "}
                        <Link
                          href={`/account/orders/${latestReturnRequest.exchangeOrder.id}`}
                          className="font-medium text-fg underline underline-offset-2 hover:text-ink-700"
                        >
                          {latestReturnRequest.exchangeOrder.orderNumber}
                        </Link>
                        .
                      </>
                    ) : (
                      "Approved — your replacement order is being set up."
                    )}
                  </p>
                )}
                {latestReturnRequest.status === "REJECTED" && latestReturnRequest.adminNote && (
                  <p className="mt-0.5 text-ink-500">Note: {latestReturnRequest.adminNote}</p>
                )}
              </div>
            )}

            {canRequestNew && !formMode && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={openReturnForm}>
                  Request Return
                </Button>
                {itemsEligibleForExchange.length > 0 && (
                  <Button variant="outline" size="sm" onClick={openExchangeForm}>
                    Request Exchange
                  </Button>
                )}
              </div>
            )}

            {canRequestNew && formMode === "return" && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="reason">Reason</Label>
                  <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                    {RETURN_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="note">Note (optional)</Label>
                  <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                {requestError && <p className="text-xs text-danger-600">{requestError}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={closeForm}>
                    Cancel
                  </Button>
                  <Button
                   
                    size="sm"
                    disabled={requestMutation.isPending}
                    onClick={() => {
                      setRequestError(null);
                      requestMutation.mutate();
                    }}
                  >
                    {requestMutation.isPending ? "Submitting…" : "Submit request"}
                  </Button>
                </div>
              </div>
            )}

            {canRequestNew && formMode === "exchange" && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="exchangeItem">Item to exchange</Label>
                  <Select
                    id="exchangeItem"
                    value={exchangeItemId}
                    onChange={(e) => {
                      setExchangeItemId(e.target.value);
                      setExchangeVariantId("");
                      setExchangeProductOverrideSlug(null);
                      setShowProductSearch(false);
                      setProductSearchQuery("");
                    }}
                  >
                    {itemsEligibleForExchange.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.productNameSnapshot}{formatVariantSuffix(item.sizeSnapshot, item.colorSnapshot)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="exchangeVariant">
                      Exchange for {exchangeProductOverrideSlug ? `— ${exchangeProductData?.product.name ?? "…"}` : ""}
                    </Label>
                    <button
                      type="button"
                      className="text-xs font-medium text-info-600 hover:underline"
                      onClick={() => {
                        setShowProductSearch((v) => !v);
                        setProductSearchQuery("");
                      }}
                    >
                      {showProductSearch ? "Cancel" : exchangeProductOverrideSlug ? "Change product" : "Exchange for a different product"}
                    </button>
                  </div>

                  {showProductSearch ? (
                    <div className="mt-1 space-y-2">
                      <Input
                        placeholder="Search products…"
                        value={productSearchQuery}
                        onChange={(e) => setProductSearchQuery(e.target.value)}
                        autoFocus
                      />
                      {productSearchEnabled && (
                        <div className="max-h-56 overflow-y-auto rounded-md border border-ink-200">
                          {productSearchLoading ? (
                            <p className="p-3 text-sm text-ink-400">Searching…</p>
                          ) : !productSearchResults || productSearchResults.items.length === 0 ? (
                            <p className="p-3 text-sm text-ink-400">No products found.</p>
                          ) : (
                            productSearchResults.items.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-ink-50"
                                onClick={() => {
                                  setExchangeProductOverrideSlug(p.slug);
                                  setExchangeVariantId("");
                                  setShowProductSearch(false);
                                  setProductSearchQuery("");
                                }}
                              >
                                <span className="truncate">{p.name}</span>
                                <span className="shrink-0 pl-2 text-ink-500">{formatPrice(productDisplayPrice(p).price)}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <Select
                      id="exchangeVariant"
                      value={exchangeVariantId}
                      onChange={(e) => setExchangeVariantId(e.target.value)}
                      disabled={exchangeProductLoading || exchangeVariantOptions.length === 0}
                    >
                      <option value="">
                        {exchangeProductLoading
                          ? "Loading options…"
                          : exchangeVariantOptions.length === 0
                            ? "No sizes/colors currently in stock"
                            : "Select a size/color"}
                      </option>
                      {exchangeVariantOptions.map((v) => (
                        <option key={v.id} value={v.id}>
                          {formatVariantLabel(v.size, v.color, "/")}
                        </option>
                      ))}
                    </Select>
                  )}
                  {exchangeProductOverrideSlug && (
                    <p className="mt-1 text-xs text-ink-400">
                      If this costs more than your original item, the difference is collected as Cash on Delivery on the replacement.
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="exchangeReason">Reason</Label>
                  <Select id="exchangeReason" value={reason} onChange={(e) => setReason(e.target.value)}>
                    {EXCHANGE_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="exchangeNote">Note (optional)</Label>
                  <Textarea id="exchangeNote" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                {requestError && <p className="text-xs text-danger-600">{requestError}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={closeForm}>
                    Cancel
                  </Button>
                  <Button
                   
                    size="sm"
                    disabled={requestMutation.isPending || !exchangeItemId || !exchangeVariantId}
                    onClick={() => {
                      setRequestError(null);
                      requestMutation.mutate();
                    }}
                  >
                    {requestMutation.isPending ? "Submitting…" : "Submit request"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
