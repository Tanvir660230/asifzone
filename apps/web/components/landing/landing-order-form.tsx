"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Check, Loader2, Lock, Minus, Plus } from "lucide-react";
import {
  BD_ALL_AREA_OPTIONS,
  BD_ALL_DISTRICTS,
  BD_AREAS_BY_DISTRICT,
  BD_DIVISION_BY_DISTRICT,
  NO_SIZE_VALUE,
  bdPhoneSchema,
  isAvailable,
  maxSellableQuantity,
  parseAreaDistrictOption,
  type CheckoutInput,
  type Product,
  type QuoteDto,
  type QuoteRequestInput,
} from "@clothing-brand/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { useVariantOptions, stockLine } from "@/components/storefront/variant-option-pickers";
import { useQuote } from "@/hooks/use-quote";
import { createOrder } from "@/lib/api/orders";
import { ApiError } from "@/lib/api-client";
import { getSessionId } from "@/lib/analytics";
import { formatPrice } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { resolveImageUrl } from "@/lib/image-url";
import { pixelAddPaymentInfo, pixelInitiateCheckout, type PixelLineItem } from "@/lib/pixels";
import { variantDisplayPrice } from "@/lib/pricing-display";
import { cn, isPaleColor } from "@/lib/utils";

// The landing page's own field messages, in Bangla; the server still validates the same fields with checkoutSchema.
const formSchema = z.object({
  customerName: z.string().trim().min(2, "আপনার নাম লিখুন").max(200),
  customerPhone: bdPhoneSchema("সঠিক মোবাইল নম্বর দিন, যেমন 01712345678"),
  shippingDistrict: z.string().min(1, "জেলা বেছে নিন"),
  shippingArea: z.string().min(1, "এলাকা বা থানা বেছে নিন"),
  shippingAddressLine: z.string().trim().min(4, "বাসা, রোড ও এলাকার বিস্তারিত লিখুন").max(500, "ঠিকানা ৫০০ অক্ষরের মধ্যে লিখুন"),
});
type FormValues = z.infer<typeof formSchema>;

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const bn = (n: number) => String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]!);
const isBangla = (s: string) => /[ঀ-৿]/.test(s);

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

  // The type's own labels when it names them in Bangla; otherwise the plain Bangla words.
  const sizeLabel = isBangla(options.sizeLabel) ? options.sizeLabel : "সাইজ";
  const colorLabel = isBangla(options.colorLabel) ? options.colorLabel : "কালার";

  const sellable = (s: string | null, c: string | null) =>
    product.variants.some((v) => (s === null || v.size === s) && (c === null || v.color === c) && isAvailable(product.trackInventory, v.stock));

  const variant = options.resolve(size, color);
  const maxQty = variant ? maxSellableQuantity(product.trackInventory, variant.stock) : 0;
  const qty = Math.max(1, Math.min(quantity, maxQty || 1));
  const soldOut = Boolean(variant) && maxQty === 0;
  const shown = variantDisplayPrice(product, variant?.id);
  const stock = variant && !soldOut ? stockLine(product.trackInventory, variant.stock, product.lowStockThreshold) : null;
  const colorImageId = color ? product.variants.find((v) => v.color === color && v.imageId)?.imageId : undefined;
  const summaryImage = product.images.find((i) => i.id === (variant?.imageId ?? colorImageId)) ?? product.images[0];

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

  const quoteRequest: QuoteRequestInput | null =
    variant && !soldOut ? { items: [{ variantId: variant.id, quantity: qty }], shippingDivision: division || undefined, shippingDistrict: district || undefined } : null;
  const { data: quote, isFetching: quoting, refetch: refetchQuote } = useQuote(quoteRequest);
  const shipping = quote?.shipping;
  // Savings against the product's own compare-at price, as the server resolved both prices.
  const unitWas = shown.was !== null && Number(shown.was) > Number(shown.price) ? Number(shown.was) : null;
  const savings = unitWas !== null ? (unitWas - Number(shown.price)) * qty : 0;

  // InitiateCheckout once, when the shopper starts on the form: the landing page's equivalent of opening checkout.
  const started = useRef(false);
  const pixelItems = (): PixelLineItem[] => (variant ? [{ id: variant.id, name: product.name, quantity: qty, price: Number(shown.price) }] : []);
  function onStart() {
    if (started.current || !variant) return;
    started.current = true;
    pixelInitiateCheckout(pixelItems());
  }

  function pickSize(s: string) {
    setSize(s);
    setOptionError(null);
  }
  function pickColor(c: string) {
    setColor(c);
    setOptionError(null);
  }

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    if (!variant) {
      setOptionError(options.showSizes && !size ? `${sizeLabel} বেছে নিন` : `${colorLabel} বেছে নিন`);
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
        setSubmitError("দাম পরিবর্তন হয়েছে। নতুন মোট দেখে আবার অর্ডার করুন।");
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
      <p className="rounded-xl bg-surface-muted p-5 text-base text-fg-muted" lang="bn">
        এই মুহূর্তে অর্ডার নেওয়া বন্ধ আছে। একটু পরে আবার চেষ্টা করুন।
      </p>
    );
  }

  const chip =
    "flex min-h-11 min-w-11 items-center justify-center rounded-[var(--chip-radius)] border px-4 text-sm font-medium transition-[border-color,background-color,color] duration-base ease-smooth active:scale-[0.97]";
  const chipState = (selected: boolean, ok: boolean) =>
    selected ? "border-ink-900 bg-ink-900 text-cream-50" : ok ? "border-line bg-surface text-fg hover:border-ink-900" : "cursor-not-allowed border-dashed border-line text-fg-muted line-through";

  return (
    <form onSubmit={handleSubmit(onSubmit)} onFocusCapture={onStart} noValidate className="space-y-7" lang="bn" data-testid="landing-order-form">
      {(options.showSizes || options.showColors) && (
        <div id="landing-options" className="scroll-mt-24 space-y-5">
          {options.showSizes && (
            <fieldset>
              <legend className="mb-2.5 text-sm font-semibold text-fg">
                {sizeLabel}
                {size && size !== NO_SIZE_VALUE && <span className="ml-2 font-normal text-fg-muted">{size}</span>}
              </legend>
              <div className="flex flex-wrap gap-2">
                {options.sizes.map((s) => {
                  const ok = sellable(s, null);
                  const label = product.variants.find((v) => v.size === s)?.sizeLabel;
                  return (
                    <button key={s} type="button" onClick={() => pickSize(s)} disabled={!ok} aria-pressed={size === s} aria-label={ok ? s : `${s}, স্টকে নেই`} className={cn(chip, chipState(size === s, ok))}>
                      {label ? `${s} (${label})` : s}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {options.showColors && (
            <fieldset>
              <legend className="mb-2.5 text-sm font-semibold text-fg">
                {colorLabel}
                {color && <span className="ml-2 font-normal text-fg-muted">{color}</span>}
              </legend>
              <div className="flex flex-wrap gap-2.5">
                {options.colors.map((c) => {
                  const ok = sellable(size, c);
                  const hex = product.variants.find((v) => v.color === c)?.colorHex;
                  const selected = color === c;
                  return hex ? (
                    <button
                      key={c}
                      type="button"
                      onClick={() => pickColor(c)}
                      disabled={!ok}
                      aria-pressed={selected}
                      aria-label={ok ? c : `${c}, স্টকে নেই`}
                      title={c}
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-[var(--swatch-radius)] border-2 transition-shadow duration-base",
                        selected ? "border-surface ring-2 ring-ink-900" : isPaleColor(hex) ? "border-line-strong" : "border-transparent",
                        !ok && "cursor-not-allowed opacity-35",
                      )}
                      style={{ backgroundColor: hex }}
                    >
                      {selected && <Check size={18} strokeWidth={3} className={isPaleColor(hex) ? "text-ink-900" : "text-white"} aria-hidden="true" />}
                    </button>
                  ) : (
                    <button key={c} type="button" onClick={() => pickColor(c)} disabled={!ok} aria-pressed={selected} className={cn(chip, chipState(selected, ok))}>
                      {c}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          {optionError && (
            <p role="alert" className="ui-field-error">
              {optionError}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-fg">পরিমাণ</p>
          {stock && stock.tone !== "muted" && (
            <p className={cn("mt-0.5 text-xs font-medium", stock.tone === "urgent" ? "text-danger-600" : "text-sale-600")} data-testid="landing-stock">
              {stock.tone === "urgent" ? "আর মাত্র কয়েকটি বাকি" : "স্টক সীমিত"}
            </p>
          )}
          {soldOut && <p className="mt-0.5 text-xs font-medium text-danger-600">এই অপশনটি স্টকে নেই</p>}
        </div>
        <div className="flex items-center rounded-[var(--control-radius)] border border-line bg-surface">
          <button type="button" className="flex h-11 w-11 items-center justify-center text-fg disabled:opacity-30" onClick={() => setQuantity(Math.max(1, qty - 1))} disabled={qty <= 1} aria-label="পরিমাণ কমান">
            <Minus size={16} aria-hidden="true" />
          </button>
          <span className="w-9 text-center text-base font-semibold tabular-nums" aria-live="polite" data-testid="landing-qty">
            {bn(qty)}
          </span>
          <button type="button" className="flex h-11 w-11 items-center justify-center text-fg disabled:opacity-30" onClick={() => setQuantity(qty + 1)} disabled={!variant || qty >= maxQty} aria-label="পরিমাণ বাড়ান">
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="lp-name">আপনার নাম</Label>
            <Input id="lp-name" className="h-12 text-base" autoComplete="name" aria-invalid={!!errors.customerName} aria-describedby={errors.customerName ? "lp-name-error" : undefined} {...register("customerName")} />
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
              className="h-12 text-base tabular-nums"
              aria-invalid={!!errors.customerPhone}
              aria-describedby={errors.customerPhone ? "lp-phone-error" : undefined}
              {...register("customerPhone")}
            />
            {fieldError("lp-phone", errors.customerPhone?.message)}
          </div>
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
              placeholder="জেলা খুঁজুন"
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
              placeholder="থানা খুঁজুন"
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
            className="text-base"
            aria-invalid={!!errors.shippingAddressLine}
            aria-describedby={errors.shippingAddressLine ? "lp-address-error" : undefined}
            {...register("shippingAddressLine")}
          />
          {fieldError("lp-address", errors.shippingAddressLine?.message)}
        </div>
      </div>

      <div className="rounded-xl bg-surface-muted p-4" data-testid="landing-summary">
        <div className="flex items-center gap-3 border-b border-line pb-3">
          {summaryImage && (
            <span className="relative h-14 w-12 shrink-0 overflow-hidden rounded-md bg-surface">
              <Image src={resolveImageUrl(summaryImage.url)} alt="" fill sizes="48px" className="object-cover" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-fg" lang="en">
              {product.name}
            </span>
            <span className="block text-xs text-fg-muted">
              {[size && size !== NO_SIZE_VALUE ? size : null, color].filter(Boolean).join(", ") || "অপশন বেছে নিন"} × {bn(qty)}
            </span>
          </span>
        </div>
        <dl className="space-y-1.5 pt-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">পণ্যের দাম</dt>
            <dd className="tabular-nums text-fg">{formatPrice(quote ? quote.subtotal : Number(shown.price) * qty)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">ডেলিভারি চার্জ</dt>
            <dd className="tabular-nums text-fg">
              {!shipping?.resolved ? <span className="text-fg-muted">জেলা বেছে নিন</span> : shipping.waived ? <span className="font-semibold text-success-700">ফ্রি</span> : formatPrice(shipping.charged)}
            </dd>
          </div>
          {savings > 0 && (
            <div className="flex justify-between gap-4 text-success-700">
              <dt>আপনি বাঁচাচ্ছেন</dt>
              <dd className="font-medium tabular-nums">{formatPrice(savings)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4 pt-2 text-fg">
            <dt className="text-base font-semibold">সর্বমোট</dt>
            <dd className={cn("text-xl font-bold tabular-nums transition-opacity duration-base", quoting && "opacity-50")} data-testid="landing-total">
              {quote && shipping?.resolved ? formatPrice(quote.total) : "-"}
            </dd>
          </div>
        </dl>
      </div>

      {submitError && (
        <p role="alert" className="rounded-xl bg-danger-50 p-4 text-sm text-danger-700">
          {submitError}
        </p>
      )}

      <div className="space-y-3">
        <button
          type="submit"
          disabled={isSubmitting || soldOut}
          data-testid="landing-submit"
          className="glossy flex h-14 w-full items-center justify-center gap-2 rounded-[var(--control-radius)] bg-accent text-lg font-bold text-accent-fg shadow-float transition-[transform,background-color] duration-base ease-smooth hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <Loader2 size={20} className="animate-spin" aria-hidden="true" />
              অর্ডার হচ্ছে
            </>
          ) : (
            "অর্ডার কনফার্ম করুন"
          )}
        </button>
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-fg-muted">
          <Lock size={13} className="shrink-0" aria-hidden="true" />
          এখন কোনো টাকা লাগবে না। পণ্য হাতে পেয়ে মূল্য দিন।
        </p>
      </div>
    </form>
  );
}
