"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Loader2, Lock, Minus, Plus, X } from "lucide-react";
import { NO_SIZE_VALUE, bdPhoneSchema } from "@clothing-brand/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AltPhoneField } from "@/components/storefront/alt-phone-field";
import { DeliveryPlaceField } from "@/components/storefront/delivery-place-field";
import { DeliveryZoneChoice } from "@/components/storefront/delivery-zone-choice";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import { useCodOrder, type CodOrderCopy } from "@/hooks/use-cod-order";
import { useLeadCapture } from "@/hooks/use-lead-capture";
import { trackFunnelEvent } from "@/lib/analytics";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { pixelInitiateCheckout, type PixelLineItem } from "@/lib/pixels";
import { readSavedDelivery, type SavedDelivery } from "@/lib/saved-delivery";
import { useExpressCheckoutStore } from "@/store/express-checkout";
import { useQuickOrderStore } from "@/store/quick-order";
import type { CartItem } from "@/store/cart";

const formSchema = z.object({
  customerName: z.string().trim().min(2, "Please enter your name").max(200),
  customerPhone: bdPhoneSchema("Enter an 11-digit mobile number, e.g. 01712345678"),
  altPhone: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), bdPhoneSchema("Enter an 11-digit number, or leave it blank").optional()),
  shippingDistrict: z.string(),
  shippingArea: z.string(),
  shippingAddressLine: z.string().trim().min(4, "Write your house, road and area so the rider can find you").max(500, "Keep the address under 500 characters"),
});
type FormValues = z.infer<typeof formSchema>;

const COPY: CodOrderCopy = {
  pickZone: "Choose inside or outside Dhaka for the delivery charge.",
  chargeChanged: "The delivery charge changed for this address. Check the new total and place the order again.",
  priceChanged: "The price changed a moment ago. Check the new total and place the order again.",
  failed: "The order couldn't be sent. Check your connection and try again.",
};

interface QuickOrderSheetProps {
  codEnabled: boolean;
  /** The store's two delivery charges, shown until the address tells which one applies. */
  shippingFeeDhaka: string | number;
  shippingFeeOutsideDhaka: string | number;
  currency?: string;
}

/**
 * The product page's one-step order: Buy Now opens this sheet over the page (a bottom sheet on phones, a centred card on
 * larger screens) with the chosen item, and the shopper orders Cash on Delivery with just name, phone and address — the
 * same pipeline as the landing page (server quote, stale-price guard, idempotency key). A coupon or online payment is
 * one tap away on the full checkout page, which still holds the same item.
 */
export function QuickOrderSheet({ codEnabled, shippingFeeDhaka, shippingFeeOutsideDhaka, currency }: QuickOrderSheetProps) {
  const setAvailable = useQuickOrderStore((s) => s.setAvailable);
  const open = useQuickOrderStore((s) => s.open);
  const close = useQuickOrderStore((s) => s.close);
  const item = useExpressCheckoutStore((s) => s.item);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Only a store taking Cash on Delivery takes the one-step order; otherwise Buy Now keeps going to checkout.
  useEffect(() => {
    setAvailable(codEnabled);
    return () => setAvailable(false);
  }, [codEnabled, setAvailable]);

  if (!mounted || !open || !item) return null;
  return createPortal(
    <SheetPanel item={item} onClose={close} fees={{ insideDhaka: formatPrice(shippingFeeDhaka, currency), outsideDhaka: formatPrice(shippingFeeOutsideDhaka, currency) }} currency={currency} />,
    document.body,
  );
}

function SheetPanel({ item, onClose, fees, currency }: { item: CartItem; onClose: () => void; fees: { insideDhaka: string; outsideDhaka: string }; currency?: string }) {
  const titleId = useId();
  const setExpressItem = useExpressCheckoutStore((s) => s.setItem);
  const money = (v: string | number) => formatPrice(v, currency);
  const qty = Math.max(1, Math.min(item.quantity, item.maxStock || 1));
  const setQty = (q: number) => setExpressItem({ ...item, quantity: Math.max(1, Math.min(q, item.maxStock || 1)) });

  // Scroll lock that restores exactly what was there (an overlay underneath, such as quick view, may have set it).
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const stableClose = useCallback(() => onCloseRef.current(), []);
  const panelRef = useFocusTrap<HTMLDivElement>({ active: true, onEscape: stableClose, lockScroll: false });
  useSheetDrag(panelRef, stableClose, true);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: { shippingDistrict: "", shippingArea: "" } });
  const district = watch("shippingDistrict");
  const area = watch("shippingArea");

  const pixelItems = (): PixelLineItem[] => [{ id: item.variantId, name: item.productName, quantity: qty, price: item.price }];
  const { addressLine, quote, quoting, shipping, zoneNeeded, zoneOpen, zoneKey, setZoneKey, zoneError, submit, submitError } = useCodOrder({
    item: { variantId: item.variantId, quantity: qty },
    district,
    addressLine: watch("shippingAddressLine") ?? "",
    scope: "quick-order",
    copy: COPY,
    pixelItems,
    zoneElementId: "qo-zone",
  });

  // Incomplete orders: a valid number and the item are saved, so the shop can call if the order isn't placed.
  useLeadCapture(
    { phone: watch("customerPhone"), name: watch("customerName"), shippingDistrict: district, shippingArea: area, shippingAddressLine: watch("shippingAddressLine") },
    [{ variantId: item.variantId, quantity: qty }],
    "CHECKOUT",
    { enabled: true },
  );

  // Opening the sheet is this page's "checkout started": InitiateCheckout once per opening.
  useEffect(() => {
    pixelInitiateCheckout(pixelItems());
    trackFunnelEvent("CHECKOUT_STARTED", { productId: item.productId, variantId: item.variantId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same phone, same browser: the last delivery details are offered back (never looked up by phone number).
  const [saved, setSaved] = useState<SavedDelivery | null>(null);
  useEffect(() => setSaved(readSavedDelivery()), []);
  function applySaved() {
    if (!saved) return;
    setValue("customerName", saved.name, { shouldValidate: true });
    setValue("customerPhone", saved.phone, { shouldValidate: true });
    setValue("shippingDistrict", saved.district ?? "");
    setValue("shippingArea", saved.area ?? "");
    setValue("shippingAddressLine", saved.addressLine, { shouldValidate: true });
    setSaved(null);
  }

  const onSubmit = handleSubmit((values) => submit(values));
  const subtotal = quote ? Number(quote.subtotal) : item.price * qty;
  const totalKnown = Boolean(quote && shipping?.resolved && !zoneOpen);
  const variantLine = [item.size && item.size !== NO_SIZE_VALUE ? item.size : null, item.color || null].filter(Boolean).join(" · ");
  const fieldError = (id: string, message?: string) =>
    message ? (
      <p id={`${id}-error`} className="ui-field-error">
        {message}
      </p>
    ) : null;

  return (
    <div className="ui-sheet-overlay fixed inset-0 z-[70] flex items-end justify-center bg-ink-950/40 backdrop-blur-sm animate-fade-in md:items-center md:p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="quick-order"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="ui-sheet max-h-[92vh] w-full overflow-y-auto overscroll-contain bg-surface pb-[env(safe-area-inset-bottom)] shadow-floatLg md:max-w-lg md:rounded-2xl md:pb-0 md:animate-modal-in"
      >
        <span className="ui-sheet-grabber" aria-hidden />
        <div data-sheet-handle className="flex items-start gap-3 border-b border-line px-5 py-4">
          {item.imageUrl && (
            <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
              <Image src={resolveImageUrl(item.imageUrl)} alt="" fill sizes="56px" className="object-cover" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-base text-fg">
              Quick order
            </h2>
            <p className="truncate text-sm text-fg-muted">{item.productName}</p>
            {variantLine && <p className="truncate text-xs text-fg-muted">{variantLine}</p>}
          </div>
          <button type="button" onClick={onClose} className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors duration-base ease-smooth hover:bg-surface-muted hover:text-fg" aria-label="Close">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={onSubmit} noValidate className="space-y-5 px-5 py-5" data-testid="quick-order-form">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-semibold text-fg">Quantity</p>
            <div className="flex items-center rounded-[var(--control-radius)] border border-line bg-surface">
              <button type="button" className="flex h-11 w-11 items-center justify-center text-fg disabled:opacity-30" onClick={() => setQty(qty - 1)} disabled={qty <= 1} aria-label="Decrease quantity">
                <Minus size={16} aria-hidden="true" />
              </button>
              <span className="w-9 text-center text-base font-semibold tabular-nums" aria-live="polite" data-testid="quick-order-qty">
                {qty}
              </span>
              <button type="button" className="flex h-11 w-11 items-center justify-center text-fg disabled:opacity-30" onClick={() => setQty(qty + 1)} disabled={qty >= item.maxStock} aria-label="Increase quantity">
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          {saved && (
            <div className="rounded-xl border border-line bg-surface-muted p-4" data-testid="quick-order-saved">
              <p className="text-sm font-semibold text-fg">Deliver to your last address?</p>
              <p className="mt-1 text-sm text-fg-muted">
                {saved.name}, <span className="tabular-nums">{saved.phone}</span>
                <br />
                {[saved.addressLine, saved.area, saved.district].filter(Boolean).join(", ")}
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={applySaved} className="min-h-11 flex-1 rounded-[var(--control-radius)] bg-ink-900 px-4 text-sm font-semibold text-cream-50">
                  Yes, use it
                </button>
                <button type="button" onClick={() => setSaved(null)} className="min-h-11 rounded-[var(--control-radius)] border border-line bg-surface px-4 text-sm font-semibold text-fg">
                  No
                </button>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="qo-name">Full name</Label>
            <Input id="qo-name" className="h-12 text-base" autoComplete="name" aria-invalid={!!errors.customerName} aria-describedby={errors.customerName ? "qo-name-error" : undefined} {...register("customerName")} />
            {fieldError("qo-name", errors.customerName?.message)}
          </div>
          <div>
            <Label htmlFor="qo-phone">Mobile number</Label>
            <Input
              id="qo-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="01XXXXXXXXX"
              className="h-12 text-base tabular-nums"
              aria-invalid={!!errors.customerPhone}
              aria-describedby={errors.customerPhone ? "qo-phone-error" : "qo-phone-hint"}
              {...register("customerPhone")}
            />
            {errors.customerPhone ? (
              fieldError("qo-phone", errors.customerPhone.message)
            ) : (
              <p id="qo-phone-hint" className="mt-1 text-xs text-fg-muted">
                We call this number to confirm your order.
              </p>
            )}
            <AltPhoneField id="qo-alt-phone" lang="en" className="mt-2" error={errors.altPhone?.message} inputProps={register("altPhone")} />
          </div>
          <div>
            <Label htmlFor="qo-address">Full address</Label>
            <Textarea
              id="qo-address"
              rows={2}
              autoComplete="street-address"
              placeholder="House/flat, road, area, thana, district"
              className="text-base"
              aria-invalid={!!errors.shippingAddressLine}
              aria-describedby={errors.shippingAddressLine ? "qo-address-error" : undefined}
              {...register("shippingAddressLine")}
            />
            {fieldError("qo-address", errors.shippingAddressLine?.message)}
          </div>
          <DeliveryPlaceField
            id="qo-area"
            lang="en"
            addressLine={addressLine}
            district={district}
            area={area}
            onChange={(p) => {
              setValue("shippingDistrict", p.district, { shouldValidate: true });
              setValue("shippingArea", p.area, { shouldValidate: true });
            }}
          />
          {zoneNeeded && addressLine.trim().length >= 4 && quote?.zoneChoices && (
            <DeliveryZoneChoice id="qo-zone" lang="en" choices={quote.zoneChoices} value={zoneKey} onChange={setZoneKey} error={zoneError} />
          )}

          <dl className="space-y-1.5 rounded-xl bg-surface-muted p-4 text-sm" data-testid="quick-order-summary">
            <div className="flex justify-between gap-4">
              <dt className="text-fg-muted">Subtotal</dt>
              <dd className="tabular-nums text-fg">{money(subtotal)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-fg-muted">Delivery</dt>
              <dd className="text-right tabular-nums text-fg">
                {/* "Inside or outside Dhaka?" only once an address is written and names no place; before that, both charges. */}
                {zoneOpen && addressLine.trim().length >= 4 ? (
                  <span className="text-fg-muted">Choose inside or outside Dhaka</span>
                ) : shipping?.resolved && !zoneOpen ? (
                  shipping.waived ? (
                    <span className="font-semibold text-success-700">Free</span>
                  ) : (
                    money(shipping.charged)
                  )
                ) : (
                  <span className="text-fg-muted">
                    Dhaka {fees.insideDhaka} · Elsewhere {fees.outsideDhaka}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 pt-2 text-fg">
              <dt className="text-base font-semibold">Total</dt>
              {totalKnown && quote ? (
                <dd className={quoting ? "text-lg font-bold tabular-nums opacity-50 transition-opacity" : "text-lg font-bold tabular-nums transition-opacity"} data-testid="quick-order-total">
                  {money(quote.total)}
                </dd>
              ) : (
                <dd className="text-sm tabular-nums text-fg-muted">{money(subtotal)} + delivery</dd>
              )}
            </div>
          </dl>

          {submitError && (
            <p role="alert" className="rounded-xl bg-danger-50 p-4 text-sm text-danger-700">
              {submitError}
            </p>
          )}

          <div className="space-y-3">
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="quick-order-submit"
              className="glossy flex h-14 w-full items-center justify-center gap-2 rounded-[var(--control-radius)] bg-accent text-base font-bold text-accent-fg shadow-float transition-[transform,background-color] duration-base ease-smooth hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={20} className="animate-spin" aria-hidden="true" />
                  Placing your order
                </>
              ) : (
                <>Place order{totalKnown && quote ? ` · ${money(quote.total)}` : ""}</>
              )}
            </button>
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-fg-muted">
              <Lock size={13} className="shrink-0" aria-hidden="true" />
              Cash on delivery. Pay when the parcel arrives.
            </p>
            <Link href="/checkout" onClick={onClose} className="flex min-h-11 items-center justify-center gap-1 text-sm font-medium text-fg underline-offset-4 hover:underline" data-testid="quick-order-full-checkout">
              Have a coupon? Use full checkout
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
