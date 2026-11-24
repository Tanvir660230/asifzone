"use client";

import { useEffect, useRef } from "react";
import { isBdMobileLocal, normalizeBdPhone, type CheckoutLeadSource } from "@clothing-brand/shared";
import { captureCheckoutLead } from "@/lib/api/checkout-leads";
import { getSessionId } from "@/lib/analytics";

interface LeadFields {
  phone: string | undefined;
  name?: string;
  email?: string | null;
  shippingDistrict?: string;
  shippingArea?: string;
  shippingAddressLine?: string;
}

const DEBOUNCE_MS = 1500;

/**
 * Incomplete orders (docs/INCOMPLETE_ORDERS.md): once the phone number is a valid Bangladeshi mobile, what the shopper
 * has typed and the cart are saved (debounced, and again whenever they change), so staff can call if no order follows.
 * Nothing is sent before the phone is valid, nor after the order is placed (`enabled` false).
 */
export function useLeadCapture(fields: LeadFields, items: Array<{ variantId: string; quantity: number }>, source: CheckoutLeadSource, opts: { enabled: boolean; landingSlug?: string }) {
  const last = useRef<string>("");
  const phone = fields.phone ? normalizeBdPhone(fields.phone) : "";
  const valid = isBdMobileLocal(phone);
  const payload = valid && items.length > 0 && opts.enabled
    ? {
        phone,
        name: fields.name?.trim() || undefined,
        email: fields.email?.trim() || undefined,
        shippingDistrict: fields.shippingDistrict || undefined,
        shippingArea: fields.shippingArea || undefined,
        shippingAddressLine: fields.shippingAddressLine?.trim() || undefined,
        items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
        source,
        landingSlug: opts.landingSlug,
      }
    : null;
  const key = payload ? JSON.stringify(payload) : "";

  useEffect(() => {
    if (!payload || key === last.current) return;
    const timer = window.setTimeout(() => {
      last.current = key;
      captureCheckoutLead({ ...payload, sessionId: getSessionId() || undefined });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // `key` captures every field of `payload`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
