"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Search, User, MapPin, Package, X, CheckCircle2 } from "lucide-react";
import {
  adminCreateOrderSchema,
  BD_ALL_DISTRICTS,
  BD_DIVISION_BY_DISTRICT,
  BD_AREAS_BY_DISTRICT,
  BD_ALL_AREA_OPTIONS,
  parseAreaDistrictOption,
  type AdminCreateOrderInput,
  type Product,
  type ProductVariant,
  type AdminCustomerListItem,
} from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/admin/page-header";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import * as productsApi from "@/lib/api/products";
import * as adminCustomersApi from "@/lib/api/admin-customers";
import { validateCoupon, type CouponPreview } from "@/lib/api/coupons";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const formSchema = adminCreateOrderSchema.omit({ items: true, couponCode: true, customerId: true, markPaid: true });
type FormValues = ReturnType<typeof formSchema.parse>;

interface CartLine {
  variantId: string;
  productName: string;
  size: string;
  color: string;
  price: number;
  stock: number;
  quantity: number;
}

export default function NewOrderPage() {
  const router = useRouter();

  // --- link to an existing customer (optional) — clearing it falls back to the same phone/email
  // guest-matching the storefront checkout uses, so a repeat customer still gets recognized even
  // if staff never bother searching for them. ---
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [linkedCustomerName, setLinkedCustomerName] = useState<string | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const debouncedCustomerQuery = useDebouncedValue(customerQuery, 300);
  const [customerResults, setCustomerResults] = useState<AdminCustomerListItem[]>([]);

  // --- product/variant picker ---
  const [productQuery, setProductQuery] = useState("");
  const debouncedProductQuery = useDebouncedValue(productQuery, 300);
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [items, setItems] = useState<CartLine[]>([]);

  // --- coupon (optional, same validation the storefront uses) ---
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<CouponPreview | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);

  const [markPaid, setMarkPaid] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      paymentMethod: "COD",
      shippingDivision: "" as FormValues["shippingDivision"],
      shippingDistrict: "",
      shippingArea: "",
    },
  });

  const shippingDistrict = watch("shippingDistrict");
  const shippingArea = watch("shippingArea");
  // Until a district is chosen, offer every area/thana in the country (as "Area — District") so
  // staff can find a customer's thana directly without knowing which district it's in.
  const areaOptions: readonly string[] = shippingDistrict
    ? (BD_AREAS_BY_DISTRICT[shippingDistrict] ?? [])
    : BD_ALL_AREA_OPTIONS;

  function handleAreaChange(value: string) {
    const parsed = parseAreaDistrictOption(value);
    if (parsed) {
      setValue("shippingDistrict", parsed.district, { shouldValidate: true });
      setValue("shippingArea", parsed.area, { shouldValidate: true });
    } else {
      setValue("shippingArea", value, { shouldValidate: true });
    }
  }

  // Division is derived from the chosen district rather than picked separately — it's only needed
  // internally for the Dhaka/outside-Dhaka shipping-fee split, matching the storefront checkout.
  useEffect(() => {
    setValue("shippingDivision", (BD_DIVISION_BY_DISTRICT[shippingDistrict] ?? "") as FormValues["shippingDivision"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shippingDistrict]);
  // Only relevant once a district is actually picked: with no district, areaOptions is the
  // country-wide combo list, which a plain area value would never match.
  useEffect(() => {
    if (!shippingDistrict) return;
    if (shippingArea && !areaOptions.includes(shippingArea)) setValue("shippingArea", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shippingDistrict]);

  useEffect(() => {
    if (!debouncedCustomerQuery.trim()) {
      setCustomerResults([]);
      return;
    }
    let active = true;
    adminCustomersApi
      .listCustomers({ search: debouncedCustomerQuery, pageSize: 6 })
      .then((res) => active && setCustomerResults(res.items))
      .catch(() => active && setCustomerResults([]));
    return () => {
      active = false;
    };
  }, [debouncedCustomerQuery]);

  useEffect(() => {
    if (!debouncedProductQuery.trim()) {
      setProductResults([]);
      return;
    }
    let active = true;
    productsApi
      .listProducts({ search: debouncedProductQuery, pageSize: 6 })
      .then((res) => active && setProductResults(res.items))
      .catch(() => active && setProductResults([]));
    return () => {
      active = false;
    };
  }, [debouncedProductQuery]);

  function pickCustomer(c: AdminCustomerListItem) {
    setCustomerId(c.id);
    setLinkedCustomerName(c.name);
    setValue("customerName", c.name);
    if (c.phone) setValue("customerPhone", c.phone);
    setValue("customerEmail", c.email);
    setCustomerQuery("");
    setCustomerResults([]);
  }

  function unlinkCustomer() {
    setCustomerId(null);
    setLinkedCustomerName(null);
  }

  function addVariant(product: Product, variant: ProductVariant) {
    if (variant.stock <= 0) return;
    const price = Number(product.activeFlashSale?.flashPrice ?? variant.price ?? product.basePrice);
    setItems((prev) => {
      const existing = prev.find((i) => i.variantId === variant.id);
      if (existing) {
        return prev.map((i) =>
          i.variantId === variant.id ? { ...i, quantity: Math.min(i.quantity + 1, variant.stock) } : i,
        );
      }
      return [
        ...prev,
        {
          variantId: variant.id,
          productName: product.name,
          size: variant.sizeLabel ?? variant.size,
          color: variant.color,
          price,
          stock: variant.stock,
          quantity: 1,
        },
      ];
    });
    setProductQuery("");
    setProductResults([]);
    setExpandedProductId(null);
  }

  function updateQuantity(variantId: string, quantity: number) {
    setItems((prev) =>
      prev.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.max(1, Math.min(quantity, i.stock)) } : i)),
    );
  }

  function removeItem(variantId: string) {
    setItems((prev) => prev.filter((i) => i.variantId !== variantId));
  }

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const couponDiscount = coupon?.discount ?? 0;
  const estimatedTotal = Math.max(0, subtotal - couponDiscount);

  async function handleApplyCoupon() {
    if (!couponInput.trim() || subtotal <= 0) return;
    setCouponChecking(true);
    setCouponError(null);
    try {
      const result = await validateCoupon(couponInput.trim(), subtotal);
      setCoupon(result);
    } catch (err) {
      setCoupon(null);
      setCouponError(err instanceof ApiError ? err.message : "Could not apply coupon");
    } finally {
      setCouponChecking(false);
    }
  }

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    if (items.length === 0) {
      setSubmitError("Add at least one item to the order");
      return;
    }
    const payload: AdminCreateOrderInput = {
      ...values,
      customerId: customerId ?? undefined,
      couponCode: coupon?.code,
      markPaid,
      items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    };
    try {
      const { order } = await adminOrdersApi.createManualOrder(payload);
      router.push(`/admin/orders/${order.id}`);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Could not create order");
    }
  }

  return (
    <div>
      <PageHeader
        title="Create Order"
        description="For phone, Facebook or walk-in orders — stock and pricing sync the same way a storefront checkout does."
        action={
          <Link href="/admin/orders">
            <Button variant="outline">
              <ArrowLeft size={16} /> Back to Orders
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px] lg:gap-8">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 lg:order-1">
          {/* Customer */}
          <div className="rounded-lg border border-ink-100 bg-cream-50 p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <User size={16} className="text-ink-400" />
              <h2 className="font-display text-lg text-ink-900">Customer</h2>
            </div>

            {linkedCustomerName ? (
              <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-success-200 bg-success-50 px-3 py-2 text-sm">
                <span className="flex items-center gap-1.5 text-success-700">
                  <CheckCircle2 size={14} /> Linked to existing customer — {linkedCustomerName}
                </span>
                <button type="button" onClick={unlinkCustomer} className="text-ink-400 hover:text-ink-700">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative mb-4">
                <Label htmlFor="customerSearch">Search existing customer (optional)</Label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                  <Input
                    id="customerSearch"
                    placeholder="Search by name, phone or email…"
                    value={customerQuery}
                    onChange={(e) => setCustomerQuery(e.target.value)}
                    className="pl-8"
                  />
                </div>
                {customerResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-ink-200 bg-cream-50 shadow-lg">
                    {customerResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => pickCustomer(c)}
                        className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-ink-50"
                      >
                        <span className="font-medium text-ink-900">{c.name}</span>
                        <span className="text-xs text-ink-400">
                          {c.phone ?? "—"} {c.email ? `· ${c.email}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="customerName">Full name</Label>
                <Input
                  id="customerName"
                  aria-invalid={!!errors.customerName}
                  {...register("customerName")}
                />
                {errors.customerName && <p className="mt-1 text-xs text-danger-600">{errors.customerName.message}</p>}
              </div>
              <div>
                <Label htmlFor="customerPhone">Phone</Label>
                <Input
                  id="customerPhone"
                  placeholder="01XXXXXXXXX"
                  aria-invalid={!!errors.customerPhone}
                  {...register("customerPhone")}
                />
                {errors.customerPhone && <p className="mt-1 text-xs text-danger-600">{errors.customerPhone.message}</p>}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="customerEmail">Email (optional)</Label>
                <Input id="customerEmail" type="email" {...register("customerEmail")} />
              </div>
            </div>
          </div>

          {/* Shipping */}
          <div className="rounded-lg border border-ink-100 bg-cream-50 p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <MapPin size={16} className="text-ink-400" />
              <h2 className="font-display text-lg text-ink-900">Delivery address</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="shippingDistrict">District</Label>
                <SearchableSelect
                  id="shippingDistrict"
                  aria-invalid={!!errors.shippingDistrict}
                  value={shippingDistrict}
                  onChange={(v) => setValue("shippingDistrict", v, { shouldValidate: true })}
                  options={BD_ALL_DISTRICTS}
                  placeholder="Search district..."
                />
                {errors.shippingDistrict && (
                  <p className="mt-1 text-xs text-danger-600">{errors.shippingDistrict.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="shippingArea">Area / Thana</Label>
                <SearchableSelect
                  id="shippingArea"
                  aria-invalid={!!errors.shippingArea}
                  value={shippingArea}
                  onChange={handleAreaChange}
                  options={areaOptions}
                  placeholder={shippingDistrict ? "Search area/thana..." : "Search area/thana (any district)..."}
                />
                {errors.shippingArea && <p className="mt-1 text-xs text-danger-600">{errors.shippingArea.message}</p>}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="shippingAddressLine">House / Road / Details</Label>
                <Textarea
                  id="shippingAddressLine"
                  rows={2}
                  aria-invalid={!!errors.shippingAddressLine}
                  {...register("shippingAddressLine")}
                />
                {errors.shippingAddressLine && (
                  <p className="mt-1 text-xs text-danger-600">{errors.shippingAddressLine.message}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="notes">Order notes (optional)</Label>
                <Textarea id="notes" rows={2} {...register("notes")} />
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="rounded-lg border border-ink-100 bg-cream-50 p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <Package size={16} className="text-ink-400" />
              <h2 className="font-display text-lg text-ink-900">Items</h2>
            </div>

            <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <Input
                placeholder="Search products by name or SKU…"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                className="pl-8"
              />
              {productResults.length > 0 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-ink-200 bg-cream-50 shadow-lg">
                  {productResults.map((p) => (
                    <div key={p.id} className="border-b border-ink-100 last:border-b-0">
                      <button
                        type="button"
                        onClick={() => setExpandedProductId((id) => (id === p.id ? null : p.id))}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-ink-50"
                      >
                        <span className="font-medium text-ink-900">{p.name}</span>
                        <span className="text-xs text-ink-400">
                          {p.activeFlashSale ? formatPrice(p.activeFlashSale.flashPrice) : formatPrice(p.basePrice)}
                        </span>
                      </button>
                      {expandedProductId === p.id && (
                        <div className="space-y-1 bg-ink-50/60 px-3 py-2">
                          {p.variants.map((v) => {
                            const price = Number(p.activeFlashSale?.flashPrice ?? v.price ?? p.basePrice);
                            return (
                              <button
                                key={v.id}
                                type="button"
                                disabled={v.stock <= 0}
                                onClick={() => addVariant(p, v)}
                                className={cn(
                                  "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                                  v.stock <= 0 ? "cursor-not-allowed text-ink-300" : "text-ink-600 hover:bg-ink-100",
                                )}
                              >
                                <span>
                                  {v.sizeLabel ?? v.size} / {v.color}{" "}
                                  <span className="text-ink-400">
                                    — {v.stock > 0 ? `${v.stock} in stock` : "out of stock"}
                                  </span>
                                </span>
                                <span className="font-medium">{formatPrice(price)}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-ink-200 py-6 text-center text-sm text-ink-400">
                No items added yet — search a product above.
              </p>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <div
                    key={item.variantId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{item.productName}</p>
                      <p className="text-xs text-ink-400">
                        {item.size} / {item.color} · {formatPrice(item.price)} each
                      </p>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={item.stock}
                      value={item.quantity}
                      onChange={(e) => updateQuantity(item.variantId, Number(e.target.value) || 1)}
                      className="h-8 w-16 text-center"
                    />
                    <span className="w-20 shrink-0 text-right text-sm font-medium text-ink-900">
                      {formatPrice(item.price * item.quantity)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(item.variantId)}
                      className="shrink-0 text-ink-400 hover:text-danger-600"
                      aria-label={`Remove ${item.productName}`}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {submitError && <p className="text-sm text-danger-600">{submitError}</p>}

          <Button type="submit" variant="brass" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Creating order…" : `Create Order — ${formatPrice(estimatedTotal)}`}
          </Button>
        </form>

        {/* Summary */}
        <aside className="h-fit lg:sticky lg:top-24 lg:order-2">
          <div className="space-y-4 rounded-lg border border-ink-100 bg-cream-50 p-5">
            <h2 className="font-display text-lg text-ink-900">Order Summary</h2>

            <div className="space-y-2 text-sm">
              {items.length === 0 && <p className="text-ink-400">No items yet</p>}
              {items.map((item) => (
                <div key={item.variantId} className="flex justify-between text-ink-600">
                  <span className="truncate pr-2">
                    {item.productName} × {item.quantity}
                  </span>
                  <span className="shrink-0">{formatPrice(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>

            <div>
              <div className="flex gap-2">
                <Input
                  placeholder="Coupon code"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  className="h-9"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleApplyCoupon}
                  disabled={couponChecking || subtotal <= 0}
                >
                  Apply
                </Button>
              </div>
              {couponError && <p className="mt-1 text-xs text-danger-600">{couponError}</p>}
              {coupon && <p className="mt-1 text-xs text-success-600">Coupon &ldquo;{coupon.code}&rdquo; applied</p>}
            </div>

            <div className="space-y-1.5 border-t border-ink-100 pt-4 text-sm">
              <div className="flex justify-between text-ink-600">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              {couponDiscount > 0 && (
                <div className="flex justify-between text-success-600">
                  <span>Coupon discount</span>
                  <span>−{formatPrice(couponDiscount)}</span>
                </div>
              )}
              <p className="text-xs text-ink-400">
                Shipping fee is added automatically based on the delivery division once the order is created.
              </p>
              <div className="flex justify-between border-t border-ink-100 pt-1.5 text-base text-ink-900">
                <span>Total (before shipping)</span>
                <span className="font-medium">{formatPrice(estimatedTotal)}</span>
              </div>
            </div>

            <label className="flex items-center gap-2 border-t border-ink-100 pt-4 text-sm text-ink-700">
              <Checkbox checked={markPaid} onChange={(e) => setMarkPaid(e.target.checked)} />
              Already paid (cash in hand / bKash / Nagad)
            </label>
            <p className="text-xs text-ink-400">
              Payment method: Cash on Delivery. Leave unchecked to keep this order Unpaid until collected.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
