"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { checkoutDistrict, zoneChoiceNeeded, type CheckoutInput, type QuoteDto, type QuoteRequestInput } from "@clothing-brand/shared";
import { useQuote } from "@/hooks/use-quote";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getQuote } from "@/lib/api/quote";
import { createOrder } from "@/lib/api/orders";
import { ApiError } from "@/lib/api-client";
import { getSessionId } from "@/lib/analytics";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { pixelAddPaymentInfo, pixelIdentify, type PixelLineItem } from "@/lib/pixels";
import { sessionSet } from "@/lib/safe-storage";
import { saveDelivery } from "@/lib/saved-delivery";

/** The one-step order's words, in the page's own language. */
export interface CodOrderCopy {
  pickZone: string;
  chargeChanged: string;
  priceChanged: string;
  failed: string;
}

export interface CodOrderValues {
  customerName: string;
  customerPhone: string;
  altPhone?: string;
  shippingDistrict: string;
  shippingArea: string;
  shippingAddressLine: string;
}

interface UseCodOrderParams {
  /** The one line being ordered; null until a buyable variant is chosen. */
  item: { variantId: string; quantity: number } | null;
  /** The delivery fields as typed (the address is re-read after a pause in typing). */
  district: string;
  addressLine: string;
  /** Idempotency scope: "landing" or "quick-order". */
  scope: string;
  copy: CodOrderCopy;
  pixelItems: () => PixelLineItem[];
  /** Where to scroll when the inside/outside-Dhaka choice is missing. */
  zoneElementId: string;
}

/**
 * A one-step Cash on Delivery order — the landing page's form and the product page's quick order sheet. Every amount
 * comes from the server quote; nothing is priced here. The district picked, else the one written in the address, else
 * the default delivery charge: the server prices the same way, so the delivery charge shown is the one charged.
 */
export function useCodOrder({ item, district, addressLine: addressTyped, scope, copy, pixelItems, zoneElementId }: UseCodOrderParams) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // ঢাকার ভেতরে / বাইরে — asked only when the address names no place and it changes the delivery charge.
  const [zoneKey, setZoneKeyState] = useState("");
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Set once an order went through: the confirmation page is loading, and nothing on this form may place another. */
  const placedRef = useRef<string | null>(null);

  const addressLine = useDebouncedValue(addressTyped ?? "", 400);
  const place = checkoutDistrict({ shippingDistrict: district, shippingAddressLine: addressLine });

  const quoteRequest: QuoteRequestInput | null = item
    ? { items: [item], shippingDivision: place.division || undefined, shippingDistrict: place.district || undefined, unknownUsesDefault: true, shippingZoneKey: place.unknown && zoneKey ? zoneKey : undefined }
    : null;
  const { data: quote, isFetching: quoting, refetch: refetchQuote } = useQuote(quoteRequest);
  const shipping = quote?.shipping;
  const zoneNeeded = place.unknown && zoneChoiceNeeded(quote?.zoneChoices);
  const zoneOpen = zoneNeeded && !zoneKey;
  const quotedTotal = quote && shipping?.resolved && !zoneOpen ? Number(quote.total) : null;

  function setZoneKey(k: string) {
    setZoneKeyState(k);
    setZoneError(null);
  }

  /** Places the order and opens its confirmation; on failure the reason is in `submitError`. */
  async function submit(values: CodOrderValues, extra: Partial<CheckoutInput> = {}) {
    setSubmitError(null);
    if (!item) return;
    if (placedRef.current) return placedRef.current;
    const at = checkoutDistrict(values);
    if (at.unknown && zoneNeeded && !zoneKey) {
      setZoneError(copy.pickZone);
      document.getElementById(zoneElementId)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    // The quote on screen follows the address after a pause in typing; an order sent inside that pause (a fast tap,
    // phone autofill) would carry a district the shown quote wasn't priced for, and the server would refuse it as
    // QUOTE_CHANGED. Price the address being sent now instead: go ahead when the total is no higher than what the
    // shopper saw, otherwise show the new total first.
    let quoteToken = quote?.token;
    if (at.district !== place.district || at.division !== place.division || !quote || quoting) {
      const request: QuoteRequestInput = {
        items: [item],
        shippingDivision: at.division || undefined,
        shippingDistrict: at.district || undefined,
        unknownUsesDefault: true,
        shippingZoneKey: at.unknown && zoneKey ? zoneKey : undefined,
      };
      try {
        const fresh = await queryClient.fetchQuery({ queryKey: ["quote", request], queryFn: async () => (await getQuote(request)).quote, staleTime: 15_000 });
        if (quotedTotal !== null && Number(fresh.total) > quotedTotal) {
          setSubmitError(copy.chargeChanged);
          return;
        }
        quoteToken = fresh.token;
      } catch {
        // Couldn't re-price: send with the quote on screen; the server still refuses a stale one with the new total.
      }
    }
    const payload: CheckoutInput = {
      items: [item],
      customerName: values.customerName,
      customerPhone: values.customerPhone,
      altPhone: values.altPhone || null,
      customerEmail: null,
      shippingDivision: at.division as CheckoutInput["shippingDivision"],
      shippingDistrict: at.district,
      shippingArea: values.shippingArea,
      shippingAddressLine: values.shippingAddressLine,
      shippingZoneKey: at.unknown && zoneKey ? zoneKey : undefined,
      paymentMethod: "COD",
      notes: null,
      sessionId: getSessionId() || undefined,
      quoteToken,
      ...extra,
    };
    try {
      const { order } = await createOrder(payload, idempotencyKeyFor(scope, payload));
      settleIdempotencyKey(scope);
      placedRef.current = order!.orderNumber;
      sessionSet("lastOrderPhone", values.customerPhone);
      saveDelivery({ name: values.customerName, phone: values.customerPhone, district: values.shippingDistrict || null, area: values.shippingArea || null, addressLine: values.shippingAddressLine });
      pixelIdentify({ phone: values.customerPhone, fullName: values.customerName, city: at.district || undefined, state: at.division || undefined });
      pixelAddPaymentInfo(pixelItems(), "COD");
      router.push(`/order-confirmation/${order!.orderNumber}`);
      return order!.orderNumber;
    } catch (err) {
      const details = err instanceof ApiError ? (err.details as { code?: string; quote?: QuoteDto } | undefined) : undefined;
      if (details?.code === "QUOTE_CHANGED") {
        if (details.quote && quoteRequest) queryClient.setQueryData(["quote", quoteRequest], details.quote);
        else void refetchQuote();
        setSubmitError(copy.priceChanged);
        return;
      }
      setSubmitError(err instanceof ApiError ? err.message : copy.failed);
    }
  }

  return { addressLine, place, quote, quoting, shipping, zoneNeeded, zoneOpen, zoneKey, setZoneKey, zoneError, quotedTotal, submit, submitError, setSubmitError };
}
