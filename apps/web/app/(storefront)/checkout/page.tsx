"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, User, MapPin, Banknote, Smartphone } from "lucide-react";
import {
  checkoutSchema,
  BD_DIVISIONS,
  BD_DISTRICTS_BY_DIVISION,
  SHIPPING_FEE_DHAKA_FALLBACK,
  SHIPPING_FEE_OUTSIDE_DHAKA_FALLBACK,
  estimateDelivery,
  type BundleCartPreview,
  type CheckoutInput,
} from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCartStore } from "@/store/cart";
import { useExpressCheckoutStore } from "@/store/express-checkout";
import { formatPrice, formatDateShort } from "@/lib/format";
import { createOrder } from "@/lib/api/orders";
import { getSessionId } from "@/lib/analytics";
import { validateCoupon, getBestCoupon, type CouponPreview } from "@/lib/api/coupons";
import { previewBundle } from "@/lib/api/bundles";
import { listAddresses } from "@/lib/api/customers";
import { getSettings } from "@/lib/api/settings";
import { useOptionalCustomer } from "@/hooks/use-current-customer";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const checkoutFormSchema = checkoutSchema.omit({ items: true, couponCode: true });
type CheckoutFormValues = ReturnType<typeof checkoutFormSchema.parse>;

export default function CheckoutPage() {
  const router = useRouter();
  const cartItems = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clear);
  const expressItem = useExpressCheckoutStore((s) => s.item);
  const clearExpressItem = useExpressCheckoutStore((s) => s.clear);
  const isExpress = expressItem !== null;
  const items = isExpress ? [expressItem] : cartItems;
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  // A "Buy Now" express item is meant to be one-shot. It's cleared explicitly on successful order
  // below, and the cart page clears any leftover one when the shopper visits their full cart —
  // deliberately NOT a "clear on unmount" effect here: that pattern fires immediately on mount too
  // under React 18 Strict Mode's dev-only double-invoke (mount → cleanup → mount), which wiped the
  // item out right after "Buy Now" set it, making checkout look like an empty cart every time.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<CouponPreview | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);
  const [bestCoupon, setBestCoupon] = useState<CouponPreview | null>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bundlePreview, setBundlePreview] = useState<BundleCartPreview | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Bundle discounts are auto-detected from cart contents (no code to enter, unlike coupons) — this
  // is a preview only, the authoritative amount is recomputed server-side when the order is created.
  useEffect(() => {
    if (!mounted || items.length === 0) {
      setBundlePreview(null);
      return;
    }
    previewBundle(items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })))
      .then(setBundlePreview)
      .catch(() => setBundlePreview(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, items.length]);

  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: getSettings, staleTime: 5 * 60 * 1000 });

  const { data: customerData } = useOptionalCustomer();
  const customer = customerData?.customer;
  const { data: addressData } = useQuery({
    queryKey: ["my-addresses"],
    queryFn: listAddresses,
    enabled: Boolean(customer),
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutFormSchema),
    defaultValues: {
      paymentMethod: "COD",
      shippingDivision: BD_DIVISIONS[0],
      shippingDistrict: BD_DISTRICTS_BY_DIVISION[BD_DIVISIONS[0]][0],
    },
  });

  const shippingDivision = watch("shippingDivision") || BD_DIVISIONS[0];
  const shippingDistrict = watch("shippingDistrict");
  const districtOptions: readonly string[] = BD_DISTRICTS_BY_DIVISION[shippingDivision] ?? [];

  // Courier-style cascading picker: the district list narrows to the selected division, so if the
  // shopper (or a saved address) switches division, drop any district that no longer belongs to it.
  useEffect(() => {
    const firstDistrict = districtOptions[0];
    if (firstDistrict && !districtOptions.includes(shippingDistrict)) {
      setValue("shippingDistrict", firstDistrict);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shippingDivision]);

  const shippingFee = settingsData
    ? Number(
        shippingDivision === "Dhaka" ? settingsData.settings.shippingFeeDhaka : settingsData.settings.shippingFeeOutsideDhaka,
      )
    : shippingDivision === "Dhaka"
      ? SHIPPING_FEE_DHAKA_FALLBACK
      : SHIPPING_FEE_OUTSIDE_DHAKA_FALLBACK;
  const deliveryEstimate = estimateDelivery(shippingDivision);

  useEffect(() => {
    if (!customer) return;
    reset((current) => ({
      ...current,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone ?? current.customerPhone,
    }));
    // Only re-run when the logged-in customer identity changes, not on every form edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id]);

  function handleUseSavedAddress(addressId: string) {
    const address = addressData?.addresses.find((a) => a.id === addressId);
    if (!address) return;
    setValue("customerName", address.fullName);
    setValue("customerPhone", address.phone);
    setValue("shippingDivision", address.division as CheckoutFormValues["shippingDivision"]);
    setValue("shippingDistrict", address.district);
    setValue("shippingArea", address.area);
    setValue("shippingAddressLine", address.addressLine);
  }

  // Auto-fill: pre-select the customer's default saved address instead of requiring a manual pick.
  useEffect(() => {
    if (!addressData || selectedAddressId) return;
    const defaultAddress = addressData.addresses.find((a) => a.isDefault);
    if (defaultAddress) {
      handleUseSavedAddress(defaultAddress.id);
      setSelectedAddressId(defaultAddress.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressData]);

  // Suggests the best coupon the shopper already qualifies for, so they don't need to know a code.
  useEffect(() => {
    if (!mounted || items.length === 0 || coupon) {
      setBestCoupon(null);
      return;
    }
    getBestCoupon(subtotal)
      .then(({ result }) => setBestCoupon(result))
      .catch(() => setBestCoupon(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, items.length, subtotal, coupon]);

  function handleApplySuggestedCoupon() {
    if (!bestCoupon) return;
    setCoupon(bestCoupon);
    setCouponInput(bestCoupon.code);
    setBestCoupon(null);
  }

  async function handleApplyCoupon() {
    if (!couponInput.trim()) return;
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

  async function onSubmit(values: CheckoutFormValues) {
    setSubmitError(null);
    const payload: CheckoutInput = {
      ...values,
      couponCode: coupon?.code,
      items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      sessionId: getSessionId() || undefined,
    };

    try {
      const { order, gatewayUrl } = await createOrder(payload);
      sessionStorage.setItem("lastOrderPhone", values.customerPhone);
      if (gatewayUrl) {
        window.location.href = gatewayUrl;
        return;
      }
      if (isExpress) clearExpressItem();
      else clearCart();
      router.push(`/order-confirmation/${order.orderNumber}`);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Could not place order, please try again");
    }
  }

  if (!mounted) return null;

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="font-display text-2xl text-ink-900">Your cart is empty</h1>
      </div>
    );
  }

  const couponDiscount = coupon?.discount ?? 0;
  const bundleDiscount = bundlePreview?.eligible?.discount ?? 0;
  const discount = couponDiscount + bundleDiscount;
  const total = Math.max(0, subtotal - discount) + shippingFee;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className={cn("font-display text-2xl text-ink-900", isExpress ? "mb-1" : "mb-8")}>Checkout</h1>
      {isExpress && <p className="mb-7 text-sm text-ink-500">Buying 1 item — your cart is untouched.</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px] lg:gap-10">
        {/* Mobile: the price is what a shopper wants to see before typing anything, so the summary
            renders first (collapsed, total visible) and the form follows. Desktop has room for both
            side by side, so it reverts to a sticky sidebar and the form leads. */}
        <aside className="order-1 h-fit lg:sticky lg:top-24 lg:order-2">
          <div className="rounded-lg border border-ink-100 bg-cream-50">
            <button
              type="button"
              onClick={() => setSummaryOpen((v) => !v)}
              className="flex w-full items-center justify-between p-5 text-left lg:cursor-default"
            >
              <span className="font-display text-lg text-ink-900">
                Order Summary <span className="font-sans text-sm font-normal text-ink-400">({items.length} item{items.length > 1 ? "s" : ""})</span>
              </span>
              <span className="flex items-center gap-2 lg:hidden">
                <span className="text-sm font-medium text-ink-900">{formatPrice(total)}</span>
                <ChevronDown size={16} className={cn("text-ink-400 transition-transform duration-200", summaryOpen && "rotate-180")} />
              </span>
            </button>

            <div className={cn("space-y-4 px-5 pb-5", summaryOpen ? "block" : "hidden", "lg:block")}>
              <div className="space-y-2 text-sm">
                {items.map((item) => (
                  <div key={item.variantId} className="flex justify-between text-ink-600">
                    <span>
                      {item.productName} × {item.quantity}
                    </span>
                    <span>{formatPrice(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>

              {bestCoupon && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-brass-300 bg-brass-50 p-3 text-xs text-ink-800">
                  <span>
                    Use <span className="font-medium">{bestCoupon.code}</span> — save {formatPrice(bestCoupon.discount)}
                  </span>
                  <Button type="button" variant="brass" size="sm" onClick={handleApplySuggestedCoupon}>
                    Apply
                  </Button>
                </div>
              )}

              <div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Coupon code"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                    className="h-9"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={handleApplyCoupon} disabled={couponChecking}>
                    Apply
                  </Button>
                </div>
                {couponError && <p className="mt-1 text-xs text-danger-600">{couponError}</p>}
                {coupon && <p className="mt-1 text-xs text-success-600">Coupon &ldquo;{coupon.code}&rdquo; applied</p>}
                {bundlePreview?.eligible && (
                  <p className="mt-1 text-xs text-success-600">
                    {bundlePreview.eligible.bundle.name} bundle discount applied
                  </p>
                )}
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
                {bundleDiscount > 0 && (
                  <div className="flex justify-between text-success-600">
                    <span>Bundle discount</span>
                    <span>−{formatPrice(bundleDiscount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-ink-600">
                  <span>Shipping ({shippingDivision === "Dhaka" ? "Dhaka" : "Outside Dhaka"})</span>
                  <span>{formatPrice(shippingFee)}</span>
                </div>
                <p className="text-xs text-ink-400">
                  Estimated delivery: {formatDateShort(deliveryEstimate.minDate)} – {formatDateShort(deliveryEstimate.maxDate)}
                </p>
                <div className="flex justify-between border-t border-ink-100 pt-1.5 text-base text-ink-900">
                  <span>Total</span>
                  <span className="font-medium">{formatPrice(total)}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <form onSubmit={handleSubmit(onSubmit)} className="order-2 space-y-5 lg:order-1">
          <div className="rounded-lg border border-ink-100 bg-cream-50 p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-medium text-cream-50">
                1
              </span>
              <User size={16} className="text-ink-400" />
              <h2 className="font-display text-lg text-ink-900">Contact information</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="customerName">Full name</Label>
                <Input
                  id="customerName"
                  autoComplete="name"
                  aria-invalid={!!errors.customerName}
                  aria-describedby={errors.customerName ? "customerName-error" : undefined}
                  {...register("customerName")}
                />
                {errors.customerName && (
                  <p id="customerName-error" className="mt-1 text-xs text-danger-600">
                    {errors.customerName.message}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="customerPhone">Phone</Label>
                <Input
                  id="customerPhone"
                  placeholder="01XXXXXXXXX"
                  autoComplete="tel"
                  aria-invalid={!!errors.customerPhone}
                  aria-describedby={errors.customerPhone ? "customerPhone-error" : undefined}
                  {...register("customerPhone")}
                />
                {errors.customerPhone && (
                  <p id="customerPhone-error" className="mt-1 text-xs text-danger-600">
                    {errors.customerPhone.message}
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="customerEmail">Email (optional)</Label>
                <Input id="customerEmail" type="email" autoComplete="email" {...register("customerEmail")} />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-ink-100 bg-cream-50 p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-medium text-cream-50">
                2
              </span>
              <MapPin size={16} className="text-ink-400" />
              <h2 className="font-display text-lg text-ink-900">Delivery address</h2>
            </div>
            {addressData && addressData.addresses.length > 0 && (
              <div className="mb-4">
                <Label htmlFor="savedAddress">Use a saved address</Label>
                <Select
                  id="savedAddress"
                  value={selectedAddressId}
                  onChange={(e) => {
                    setSelectedAddressId(e.target.value);
                    if (e.target.value) handleUseSavedAddress(e.target.value);
                  }}
                >
                  <option value="">Enter manually…</option>
                  {addressData.addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label || a.fullName} — {a.area}, {a.district}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="shippingDivision">Division</Label>
                <Select id="shippingDivision" autoComplete="address-level1" {...register("shippingDivision")}>
                  {BD_DIVISIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="shippingDistrict">District</Label>
                <Select
                  id="shippingDistrict"
                  autoComplete="address-level2"
                  aria-invalid={!!errors.shippingDistrict}
                  aria-describedby={errors.shippingDistrict ? "shippingDistrict-error" : undefined}
                  {...register("shippingDistrict")}
                >
                  {districtOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
                {errors.shippingDistrict && (
                  <p id="shippingDistrict-error" className="mt-1 text-xs text-danger-600">
                    {errors.shippingDistrict.message}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="shippingArea">Area / Thana</Label>
                <Input
                  id="shippingArea"
                  placeholder="e.g. Gulshan, Dhanmondi"
                  autoComplete="address-level3"
                  aria-invalid={!!errors.shippingArea}
                  aria-describedby={errors.shippingArea ? "shippingArea-error" : undefined}
                  {...register("shippingArea")}
                />
                {errors.shippingArea && (
                  <p id="shippingArea-error" className="mt-1 text-xs text-danger-600">
                    {errors.shippingArea.message}
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="shippingAddressLine">House / Road / Details</Label>
                <Textarea
                  id="shippingAddressLine"
                  rows={2}
                  autoComplete="street-address"
                  aria-invalid={!!errors.shippingAddressLine}
                  aria-describedby={errors.shippingAddressLine ? "shippingAddressLine-error" : undefined}
                  {...register("shippingAddressLine")}
                />
                {errors.shippingAddressLine && (
                  <p id="shippingAddressLine-error" className="mt-1 text-xs text-danger-600">
                    {errors.shippingAddressLine.message}
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="notes">Order notes (optional)</Label>
                <Textarea id="notes" rows={2} {...register("notes")} />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-ink-100 bg-cream-50 p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-medium text-cream-50">
                3
              </span>
              <Banknote size={16} className="text-ink-400" />
              <h2 className="font-display text-lg text-ink-900">Payment method</h2>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-3 rounded-lg border border-ink-200 p-3 text-sm transition-colors duration-150 ease-smooth has-[:checked]:border-brass-500 has-[:checked]:bg-brass-50/50">
                <input type="radio" value="COD" className="accent-brass-500" {...register("paymentMethod")} defaultChecked />
                <Banknote size={16} className="text-ink-400" />
                Cash on Delivery
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-ink-200 p-3 text-sm transition-colors duration-150 ease-smooth has-[:checked]:border-brass-500 has-[:checked]:bg-brass-50/50">
                <input type="radio" value="SSLCOMMERZ" className="accent-brass-500" {...register("paymentMethod")} />
                <Smartphone size={16} className="text-ink-400" />
                <span>
                  Digital Payment
                  <span className="block text-xs text-ink-400">bKash, Nagad &amp; Card</span>
                </span>
              </label>
            </div>
          </div>

          {submitError && <p className="text-sm text-danger-600">{submitError}</p>}

          <Button type="submit" variant="brass" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Placing order…" : `Place Order — ${formatPrice(total)}`}
          </Button>
        </form>
      </div>
    </div>
  );
}
