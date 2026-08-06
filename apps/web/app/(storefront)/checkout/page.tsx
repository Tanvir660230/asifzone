"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import {
  checkoutSchema,
  BD_DIVISIONS,
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

  // A "Buy Now" express item is meant to be one-shot — clear it on the way out (whether the order
  // succeeded or the shopper just navigated away) so a later normal-cart checkout visit isn't hijacked.
  useEffect(() => () => clearExpressItem(), [clearExpressItem]);

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
    defaultValues: { paymentMethod: "COD", shippingDivision: BD_DIVISIONS[0] },
  });

  const shippingDivision = watch("shippingDivision") || BD_DIVISIONS[0];
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

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_360px]">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div>
            <h2 className="mb-3 font-display text-lg text-ink-900">Contact</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="customerName">Full name</Label>
                <Input id="customerName" autoComplete="name" {...register("customerName")} />
                {errors.customerName && <p className="mt-1 text-xs text-danger-600">{errors.customerName.message}</p>}
              </div>
              <div>
                <Label htmlFor="customerPhone">Phone</Label>
                <Input id="customerPhone" placeholder="01XXXXXXXXX" autoComplete="tel" {...register("customerPhone")} />
                {errors.customerPhone && <p className="mt-1 text-xs text-danger-600">{errors.customerPhone.message}</p>}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="customerEmail">Email (optional)</Label>
                <Input id="customerEmail" type="email" autoComplete="email" {...register("customerEmail")} />
              </div>
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg text-ink-900">Shipping address</h2>
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
                <Input id="shippingDistrict" autoComplete="address-level2" {...register("shippingDistrict")} />
                {errors.shippingDistrict && <p className="mt-1 text-xs text-danger-600">{errors.shippingDistrict.message}</p>}
              </div>
              <div>
                <Label htmlFor="shippingArea">Area / Thana</Label>
                <Input id="shippingArea" autoComplete="address-level3" {...register("shippingArea")} />
                {errors.shippingArea && <p className="mt-1 text-xs text-danger-600">{errors.shippingArea.message}</p>}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="shippingAddressLine">House / Road / Details</Label>
                <Textarea id="shippingAddressLine" rows={2} autoComplete="street-address" {...register("shippingAddressLine")} />
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

          <div>
            <h2 className="mb-3 font-display text-lg text-ink-900">Payment method</h2>
            <div className="space-y-2">
              <label className="flex items-center gap-3 border border-ink-200 p-3 text-sm has-[:checked]:border-ink-900">
                <input type="radio" value="COD" {...register("paymentMethod")} defaultChecked />
                Cash on Delivery
              </label>
              <label className="flex items-center gap-3 border border-ink-200 p-3 text-sm has-[:checked]:border-ink-900">
                <input type="radio" value="SSLCOMMERZ" {...register("paymentMethod")} />
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

        <aside className="h-fit border border-ink-100 bg-cream-50 p-5">
          <h2 className="mb-4 font-display text-lg text-ink-900">Order Summary</h2>
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
            <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-brass-300 bg-brass-50 p-3 text-xs text-ink-800">
              <span>
                Use <span className="font-medium">{bestCoupon.code}</span> — save {formatPrice(bestCoupon.discount)}
              </span>
              <Button type="button" variant="brass" size="sm" onClick={handleApplySuggestedCoupon}>
                Apply
              </Button>
            </div>
          )}

          <div className="mt-4 flex gap-2">
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

          <div className="mt-4 space-y-1.5 border-t border-ink-100 pt-4 text-sm">
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
              <span>Shipping</span>
              <span>{formatPrice(shippingFee)}</span>
            </div>
            <p className="text-xs text-ink-400">
              Estimated delivery: {formatDateShort(deliveryEstimate.minDate)} – {formatDateShort(deliveryEstimate.maxDate)}
            </p>
            <div className="flex justify-between border-t border-ink-100 pt-1.5 text-base text-ink-900">
              <span>Total</span>
              <span>{formatPrice(total)}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
