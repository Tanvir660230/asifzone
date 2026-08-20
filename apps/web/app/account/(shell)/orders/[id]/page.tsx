"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, RotateCcw, PackageSearch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { BackLink } from "@/components/ui/back-link";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { toast } from "@/components/ui/toast";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { AccountEmptyState } from "@/components/account/account-empty-state";
import { getMyOrder } from "@/lib/api/customers";
import { createReturnRequest } from "@/lib/api/return-requests";
import { getProductBySlug, listStorefrontProducts } from "@/lib/api/storefront";
import { useCartStore } from "@/store/cart";
import { formatPrice, orderStatusBadgeClass, orderStatusLabel } from "@/lib/format";
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
  const exchangeVariantOptions = (exchangeProductData?.product.variants ?? []).filter(
    (v) => v.id !== exchangeItem?.variantId && v.stock > 0,
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
        <BackLink href="/account/orders" label="Back to Orders" />
        <AccountEmptyState
          icon={PackageSearch}
          title="Order not found"
          description="This order doesn't exist, or isn't linked to your account."
          action={
            <Link href="/account/orders">
              <Button size="sm">Back to Orders</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-7 w-40 rounded bg-ink-100" />
            <div className="h-3 w-32 rounded bg-ink-100" />
          </div>
          <div className="h-8 w-24 rounded bg-ink-100" />
        </div>
        <div className="h-32 rounded-lg border border-ink-100 bg-ink-50" />
        <div className="h-40 rounded-lg border border-ink-100 bg-ink-50" />
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

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: "Account", href: "/account" }, { label: "Orders", href: "/account/orders" }, { label: order.orderNumber }]} />
        <BackLink href="/account/orders" label="Back to Orders" />
      </div>
      <AccountPageHeader
        title={order.orderNumber}
        description={`Placed ${new Date(order.createdAt).toLocaleString()}`}
        action={
          <div className="flex items-center gap-3">
            <Link href={`/account/orders/${id}/invoice`} target="_blank">
              <Button variant="outline" size="sm">
                <Printer size={14} /> Invoice
              </Button>
            </Link>
            <Button variant="brass" size="sm" onClick={handleReorder}>
              <RotateCcw size={14} /> Reorder
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Status</CardTitle>
          <Badge className={orderStatusBadgeClass(order.status)}>{orderStatusLabel(order.status)}</Badge>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 border-l border-ink-100 pl-4">
            {order.statusHistory.map((entry, i) => (
              <li
                key={entry.id}
                className="relative text-sm"
                aria-current={i === order.statusHistory.length - 1 ? "step" : undefined}
              >
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brass-400" />
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink-900">{orderStatusLabel(entry.status)}</span>
                  <span className="text-xs text-ink-400">{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
                {entry.note && <p className="mt-0.5 text-ink-600">{entry.note}</p>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-ink-900">
                    {item.productNameSnapshot} ({item.sizeSnapshot}/{item.colorSnapshot}) × {item.quantity}
                  </p>
                  {!item.live && <p className="text-xs text-ink-400">No longer available</p>}
                </div>
                <span className="text-ink-600">{formatPrice(Number(item.priceSnapshot) * item.quantity)}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 ml-auto max-w-xs space-y-1 border-t border-ink-100 pt-4 text-sm">
            <div className="flex justify-between text-ink-600">
              <span>Subtotal</span>
              <span>{formatPrice(order.subtotal)}</span>
            </div>
            {Number(order.discount) > 0 && (
              <div className="flex justify-between text-success-600">
                <span>Discount</span>
                <span>−{formatPrice(order.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-ink-600">
              <span>Shipping</span>
              <span>{formatPrice(order.shippingFee)}</span>
            </div>
            <div className="flex justify-between border-t border-ink-100 pt-1 text-base text-ink-900">
              <span>Total</span>
              <span>{formatPrice(order.total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {(latestReturnRequest || canRequestNew) && (
        <Card>
          <CardHeader>
            <CardTitle>Returns &amp; Exchanges</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {latestReturnRequest && (
              <div className="text-sm text-ink-700">
                <p>
                  {latestReturnRequest.type === "EXCHANGE" ? "Exchange request" : "Return request"}:{" "}
                  <span className="font-medium text-ink-900">{latestReturnRequest.status}</span>
                </p>
                {latestReturnRequest.type === "EXCHANGE" && latestReturnRequest.originalSizeSnapshot && (
                  <p className="mt-0.5 text-ink-500">
                    {latestReturnRequest.originalSizeSnapshot}/{latestReturnRequest.originalColorSnapshot} →{" "}
                    {latestReturnRequest.requestedSizeSnapshot}/{latestReturnRequest.requestedColorSnapshot}
                  </p>
                )}
                <p className="mt-0.5 text-ink-500">Reason: {latestReturnRequest.reason}</p>
                {latestReturnRequest.status === "APPROVED" && latestReturnRequest.type === "RETURN" && (
                  <p className="mt-0.5 text-ink-500">
                    Refund status follows the order status above — currently{" "}
                    <span className="font-medium">{orderStatusLabel(order.status)}</span>.
                  </p>
                )}
                {latestReturnRequest.status === "APPROVED" && latestReturnRequest.type === "EXCHANGE" && (
                  <p className="mt-0.5 text-ink-500">
                    {latestReturnRequest.exchangeOrder ? (
                      <>
                        Your replacement is on order{" "}
                        <Link
                          href={`/account/orders/${latestReturnRequest.exchangeOrder.id}`}
                          className="font-medium text-brass-600 hover:underline"
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
                    variant="brass"
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
                        {item.productNameSnapshot} ({item.sizeSnapshot}/{item.colorSnapshot})
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
                                <span className="shrink-0 pl-2 text-ink-500">{formatPrice(p.basePrice)}</span>
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
                          {v.size}/{v.color}
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
                    variant="brass"
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
