"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Banknote, Minus, Plus } from "lucide-react";
import {
  BD_ALL_AREA_OPTIONS,
  BD_ALL_DISTRICTS,
  BD_AREAS_BY_DISTRICT,
  BD_DIVISION_BY_DISTRICT,
  bdPhoneSchema,
  maxSellableQuantity,
  parseAreaDistrictOption,
  type CheckoutInput,
  type Product,
  type QuoteDto,
  type QuoteRequestInput,
} from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { VariantOptionPickers, useVariantOptions } from "@/components/storefront/variant-option-pickers";
import { useQuote } from "@/hooks/use-quote";
import { createOrder } from "@/lib/api/orders";
import { ApiError } from "@/lib/api-client";
import { getSessionId } from "@/lib/analytics";
import { formatPrice } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { pixelAddPaymentInfo, pixelInitiateCheckout, type PixelLineItem } from "@/lib/pixels";
import { variantDisplayPrice } from "@/lib/pricing-display";
import { cn } from "@/lib/utils";

// The landing page's own field messages, in Bangla; the server still validates the same fields with checkoutSchema.
const formSchema = z.object({
  customerName: z.string().trim().min(2, "আপনার নাম লিখুন").max(200),
  customerPhone: bdPhoneSchema("সঠিক মোবাইল নম্বর দিন, যেমন 01712345678"),
  shippingDistrict: z.string().min(1, "জেলা বেছে নিন"),
  shippingArea: z.string().min(1, "এলাকা / থানা বেছে নিন"),
  shippingAddressLine: z.string().trim().min(4, "বাসা, রোড ও এলাকার বিস্তারিত লিখুন").max(500, "ঠিকানা ৫০০ অক্ষরের মধ্যে লিখুন"),
});
type FormValues = z.infer<typeof formSchema>;

/**
 * The one-page order form of a product landing page (/lp/[slug]): option, quantity, name, phone and address, then a
 * Cash on Delivery order through the same pipeline as checkout (server quote, stale-price guard, idempotency key). Every
 * amount shown comes from the server quote; nothing is priced here.
 */
export function LandingOrderForm({ product, codEnabled }: { product: Product; codEnabled: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const options = useVariantOptions(product.variants, product.resolved?.variantDimensions);
  const [size, setSize] = useState<string | null>(options.defaultSize);
  const [color, setColor] = useState<string | null>(options.defaultColor);
  const [quantity, setQuantity] = useState(1);
  const [optionError, setOptionError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const variant = options.resolve(size, color);
  const maxQty = variant ? maxSellableQuantity(product.trackInventory, variant.stock) : 0;
  const qty = Math.max(1, Math.min(quantity, maxQty || 1));
  const soldOut = Boolean(variant) && maxQty === 0;
  const shown = variantDisplayPrice(product, variant?.id);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: { shippingDistrict: "", shippingArea: "" } });

  const district = watch("shippingDistrict");
  const area = watch("shippingArea");
  const areaOptions: readonly string[] = district ? (BD_AREAS_BY_DISTRICT[district] ?? []) : BD_ALL_AREA_OPTIONS;
  const division = BD_DIVISION_BY_DISTRICT[district] ?? "";

  function handleArea(value: string) {
    const parsed = parseAreaDistrictOption(value);
    if (parsed) {
      setValue("shippingDistrict", parsed.district, { shouldValidate: true });
      setValue("shippingArea", parsed.area, { shouldValidate: true });
    } else setValue("shippingArea", value, { shouldValidate: true });
  }

  // A district change clears an area that isn't in it.
  useEffect(() => {
    if (district && area && !(BD_AREAS_BY_DISTRICT[district] ?? []).includes(area)) setValue("shippingArea", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district]);

  const quoteRequest: QuoteRequestInput | null = variant && !soldOut
    ? { items: [{ variantId: variant.id, quantity: qty }], shippingDivision: division || undefined, shippingDistrict: district || undefined }
    : null;
  const { data: quote, refetch: refetchQuote } = useQuote(quoteRequest);
  const shipping = quote?.shipping;

  // InitiateCheckout once, when the shopper starts on the form — the landing page's equivalent of opening checkout.
  const started = useRef(false);
  const pixelItems = (): PixelLineItem[] => (variant ? [{ id: variant.id, name: product.name, quantity: qty, price: Number(shown.price) }] : []);
  function onStart() {
    if (started.current || !variant) return;
    started.current = true;
    pixelInitiateCheckout(pixelItems());
  }

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    if (!variant) {
      setOptionError(options.showSizes && !size ? "সাইজ বেছে নিন" : "কালার বেছে নিন");
      document.getElementById("landing-options")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (soldOut) return;
    const payload: CheckoutInput = {
      items: [{ variantId: variant.id, quantity: qty }],
      customerName: values.customerName,
      customerPhone: values.customerPhone,
      customerEmail: null,
      shippingDivision: division as CheckoutInput["shippingDivision"],
      shippingDistrict: values.shippingDistrict,
      shippingArea: values.shippingArea,
      shippingAddressLine: values.shippingAddressLine,
      paymentMethod: "COD",
      notes: null,
      sessionId: getSessionId() || undefined,
      quoteToken: quote?.token,
    };
    try {
      const { order } = await createOrder(payload, idempotencyKeyFor("landing", payload));
      settleIdempotencyKey("landing");
      sessionStorage.setItem("lastOrderPhone", values.customerPhone);
      pixelAddPaymentInfo(pixelItems(), "COD");
      router.push(`/order-confirmation/${order!.orderNumber}`);
    } catch (err) {
      const details = err instanceof ApiError ? (err.details as { code?: string; quote?: QuoteDto } | undefined) : undefined;
      if (details?.code === "QUOTE_CHANGED") {
        if (details.quote && quoteRequest) queryClient.setQueryData(["quote", quoteRequest], details.quote);
        else void refetchQuote();
        setSubmitError("দাম পরিবর্তন হয়েছে — নতুন মোট দেখে আবার অর্ডার করুন।");
        return;
      }
      setSubmitError(err instanceof ApiError ? err.message : "অর্ডার করা যায়নি, আবার চেষ্টা করুন।");
    }
  }

  const fieldError = (id: string, message?: string) =>
    message ? (
      <p id={`${id}-error`} className="ui-field-error">
        {message}
      </p>
    ) : null;

  if (!codEnabled) {
    return (
      <p className="rounded-lg border border-line bg-surface p-4 text-sm text-fg-muted" lang="bn">
        এই মুহূর্তে অর্ডার নেওয়া বন্ধ আছে। একটু পরে আবার চেষ্টা করুন।
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} onFocusCapture={onStart} noValidate className="space-y-6" lang="bn" data-testid="landing-order-form">
      {(options.showSizes || options.showColors) && (
        <div id="landing-options">
          <VariantOptionPickers
            variants={product.variants}
            trackInventory={product.trackInventory}
            options={options}
            selectedSize={size}
            selectedColor={color}
            onSelectSize={(s) => {
              setSize(s);
              setOptionError(null);
            }}
            onSelectColor={(c) => {
              setColor(c);
              setOptionError(null);
            }}
            instanceId="landing"
          />
          {optionError && <p className="ui-field-error">{optionError}</p>}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-fg">পরিমাণ</span>
        <div className="flex items-center rounded-[var(--control-radius)] border border-line">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center text-fg disabled:opacity-40"
            onClick={() => setQuantity(Math.max(1, qty - 1))}
            disabled={qty <= 1}
            aria-label="পরিমাণ কমান"
          >
            <Minus size={16} aria-hidden="true" />
          </button>
          <span className="w-10 text-center text-base font-semibold tabular-nums" aria-live="polite" data-testid="landing-qty">
            {qty}
          </span>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center text-fg disabled:opacity-40"
            onClick={() => setQuantity(qty + 1)}
            disabled={!variant || qty >= maxQty}
            aria-label="পরিমাণ বাড়ান"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      {soldOut && <p className="text-sm font-medium text-danger-600">এই অপশনটি এখন স্টকে নেই — অন্য সাইজ বা কালার বেছে নিন।</p>}

      <div className="grid gap-4">
        <div>
          <Label htmlFor="lp-name">আপনার নাম</Label>
          <Input id="lp-name" autoComplete="name" placeholder="পুরো নাম" aria-invalid={!!errors.customerName} aria-describedby={errors.customerName ? "lp-name-error" : undefined} {...register("customerName")} />
          {fieldError("lp-name", errors.customerName?.message)}
        </div>
        <div>
          <Label htmlFor="lp-phone">মোবাইল নম্বর</Label>
          <Input
            id="lp-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="01XXXXXXXXX"
            aria-invalid={!!errors.customerPhone}
            aria-describedby={errors.customerPhone ? "lp-phone-error" : undefined}
            {...register("customerPhone")}
          />
          {fieldError("lp-phone", errors.customerPhone?.message)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="lp-district">জেলা</Label>
            <SearchableSelect
              id="lp-district"
              autoComplete="address-level2"
              aria-invalid={!!errors.shippingDistrict}
              aria-describedby={errors.shippingDistrict ? "lp-district-error" : undefined}
              value={district}
              onChange={(v) => setValue("shippingDistrict", v, { shouldValidate: true })}
              options={BD_ALL_DISTRICTS}
              placeholder="জেলা খুঁজুন…"
            />
            {fieldError("lp-district", errors.shippingDistrict?.message)}
          </div>
          <div>
            <Label htmlFor="lp-area">এলাকা / থানা</Label>
            <SearchableSelect
              id="lp-area"
              autoComplete="address-level3"
              aria-invalid={!!errors.shippingArea}
              aria-describedby={errors.shippingArea ? "lp-area-error" : undefined}
              value={area}
              onChange={handleArea}
              options={areaOptions}
              placeholder="থানা খুঁজুন…"
            />
            {fieldError("lp-area", errors.shippingArea?.message)}
          </div>
        </div>
        <div>
          <Label htmlFor="lp-address">বাসা / রোড / এলাকার বিস্তারিত</Label>
          <Textarea
            id="lp-address"
            rows={2}
            autoComplete="street-address"
            placeholder="যেমন: বাসা ১২, রোড ৫, সেক্টর ৭"
            aria-invalid={!!errors.shippingAddressLine}
            aria-describedby={errors.shippingAddressLine ? "lp-address-error" : undefined}
            {...register("shippingAddressLine")}
          />
          {fieldError("lp-address", errors.shippingAddressLine?.message)}
        </div>
      </div>

      <dl className="space-y-2 rounded-lg bg-surface-muted p-4 text-sm" data-testid="landing-summary">
        <div className="flex justify-between gap-4">
          <dt className="text-fg-muted">
            পণ্যের দাম{qty > 1 ? ` (${qty}টি)` : ""}
          </dt>
          <dd className="tabular-nums text-fg">{quote ? formatPrice(quote.subtotal) : formatPrice(Number(shown.price) * qty)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-fg-muted">ডেলিভারি চার্জ</dt>
          <dd className="tabular-nums text-fg">
            {!shipping?.resolved ? (
              <span className="text-fg-muted">জেলা বেছে নিলে দেখাবে</span>
            ) : shipping.waived ? (
              <span className="font-medium text-success-700">ফ্রি</span>
            ) : (
              formatPrice(shipping.charged)
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-line pt-2 text-base font-semibold text-fg">
          <dt>মোট</dt>
          <dd className="tabular-nums" data-testid="landing-total">
            {quote && shipping?.resolved ? formatPrice(quote.total) : "—"}
          </dd>
        </div>
      </dl>

      {submitError && (
        <p role="alert" className="rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">
          {submitError}
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" size="lg" className={cn("h-14 w-full text-base")} disabled={isSubmitting || soldOut} data-testid="landing-submit">
          {isSubmitting ? "অর্ডার হচ্ছে…" : "অর্ডার কনফার্ম করুন"}
        </Button>
        <p className="mt-3 flex items-center justify-center gap-2 text-sm text-fg-muted">
          <Banknote size={16} aria-hidden="true" />
          পণ্য হাতে পেয়ে টাকা দিন — ক্যাশ অন ডেলিভারি
        </p>
      </div>
    </form>
  );
}
