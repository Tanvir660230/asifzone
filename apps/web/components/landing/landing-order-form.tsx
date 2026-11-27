"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, Loader2, Lock, Minus, Plus, Ruler } from "lucide-react";
import {
  NO_SIZE_VALUE,
  bdPhoneSchema,
  maxSellableQuantity,
  type Product,
  type PublicProductFamily,
  variantShipsFree,
  type SizeAssist,
} from "@clothing-brand/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { DeliveryPlaceField } from "@/components/storefront/delivery-place-field";
import { AltPhoneField } from "@/components/storefront/alt-phone-field";
import { DeliveryZoneChoice } from "@/components/storefront/delivery-zone-choice";
import { Textarea } from "@/components/ui/textarea";
import { stockLine, type VariantOptions } from "@/components/storefront/variant-option-pickers";
import { SizeFinder } from "@/components/storefront/size-finder";
import type { FitAnswers } from "@/lib/fit-memory";
import { colorImage, useLandingSelection } from "./landing-selection";
import { PHOTO_TILE_WIDTH, PhotoTileBody } from "@/components/storefront/photo-tile";
import { ProductFamilyPicker } from "@/components/storefront/product-family-picker";
import { familyTiles } from "@/lib/product-family";
import { landingPagePath } from "@/lib/landing";
import { trackFunnelEvent } from "@/lib/analytics";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { pixelFunnel, pixelInitiateCheckout, type PixelLineItem } from "@/lib/pixels";
import { variantDisplayPrice } from "@/lib/pricing-display";
import { cn, isPaleColor } from "@/lib/utils";
import { useLeadCapture } from "@/hooks/use-lead-capture";
import { useCodOrder, type CodOrderCopy } from "@/hooks/use-cod-order";
import { readSavedDelivery, type SavedDelivery } from "@/lib/saved-delivery";

// The landing page's own field messages, in Bangla; the server still validates the same fields with checkoutSchema.
const formSchema = z.object({
  customerName: z.string().trim().min(2, "আপনার নাম লিখুন").max(200),
  customerPhone: bdPhoneSchema("১১ সংখ্যার সঠিক মোবাইল নম্বর দিন, যেমন 01712345678"),
  /** A second number for the courier — optional; blank means none. */
  altPhone: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), bdPhoneSchema("১১ সংখ্যার সঠিক নম্বর দিন, অথবা ঘরটা খালি রাখুন").optional()),
  // District and thana are optional (owner 2026-11-24): shoppers who skipped them could not order. The district is
  // then read from the address (checkoutDistrict), else the default delivery charge applies.
  shippingDistrict: z.string(),
  shippingArea: z.string(),
  shippingAddressLine: z.string().trim().min(4, "বাসা, রোড ও এলাকার নাম লিখুন, যাতে ডেলিভারিম্যান সহজে খুঁজে পান").max(500, "ঠিকানা ৫০০ অক্ষরের মধ্যে লিখুন"),
});
type FormValues = z.infer<typeof formSchema>;

const LANDING_ORDER_COPY: CodOrderCopy = {
  pickZone: "ডেলিভারি চার্জের জন্য ঢাকার ভেতরে না বাইরে, বেছে নিন।",
  chargeChanged: "ঠিকানা অনুযায়ী ডেলিভারি চার্জ বদলেছে। নতুন মোট দেখে আবার অর্ডার করুন।",
  priceChanged: "এর মধ্যে দাম পরিবর্তন হয়েছে। নতুন মোট দেখে আবার অর্ডার করুন।",
  failed: "অর্ডারটি পাঠানো যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।",
};

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const bn = (n: number) => String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]!);
const isBangla = (s: string) => /[ঀ-৿]/.test(s);

/**
 * The one-page order form of a product landing page (/lp/[slug]): option, quantity, name, phone and address, then a
 * Cash on Delivery order through the same pipeline as checkout (server quote, stale-price guard, idempotency key). Every
 * amount shown comes from the server quote; nothing is priced here.
 *
 * Pressing order without a size (or colour) opens a small popup with just that choice; picking it carries straight on
 * with the order, so the shopper never has to find what they missed.
 *
 * The colour and size live in LandingSelectionProvider, so the gallery and the colour showcase follow the same choice.
 */
export function LandingOrderForm({
  codEnabled,
  ctaText,
  families = [],
  deliveryFees,
}: {
  codEnabled: boolean;
  ctaText?: string;
  families?: PublicProductFamily[];
  /** The store's two delivery charges, formatted ("৳60"), shown before the address is written so the total is never a
   * surprise. Omitted → the old "shown once you give the address" line. */
  deliveryFees?: { insideDhaka: string; outsideDhaka: string };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { product, options, size, color, setSize, setColor, sellable, quantity, setQuantity, setQuotedTotal } = useLandingSelection();
  const [pickerOpen, setPickerOpen] = useState(false);

  // The type's own labels when it names them in Bangla; otherwise the plain Bangla words.
  const sizeLabel = isBangla(options.sizeLabel) ? options.sizeLabel : "সাইজ";
  const colorLabel = isBangla(options.colorLabel) ? options.colorLabel : "কালার";
  const missing = [options.showSizes && !size ? sizeLabel : null, options.showColors && !color ? colorLabel : null].filter(Boolean).join(" ও ");

  const variant = options.resolve(size, color);
  const maxQty = variant ? maxSellableQuantity(product.trackInventory, variant.stock) : 0;
  const qty = Math.max(1, Math.min(quantity, maxQty || 1));
  const soldOut = Boolean(variant) && maxQty === 0;
  const shown = variantDisplayPrice(product, variant?.id);
  // Free delivery is the product's (or the chosen variant's) own setting, so it can be said before the district is known.
  const shipsFree = variant
    ? variantShipsFree(product.freeDelivery, variant.freeDelivery)
    : product.variants.length > 0 && product.variants.every((v) => variantShipsFree(product.freeDelivery, v.freeDelivery));
  const stock = variant && !soldOut ? stockLine(product.trackInventory, variant.stock, product.lowStockThreshold) : null;
  const summaryImage = product.images.find((i) => i.id === variant?.imageId) ?? (color ? colorImage(product, color) : null) ?? product.images[0];

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: { shippingDistrict: "", shippingArea: "" } });

  const district = watch("shippingDistrict");
  const area = watch("shippingArea");
  // Incomplete orders: a valid number and the chosen item are saved, so the shop can call if the order isn't placed.
  useLeadCapture(
    { phone: watch("customerPhone"), name: watch("customerName"), shippingDistrict: district, shippingArea: area, shippingAddressLine: watch("shippingAddressLine") },
    variant && !soldOut ? [{ variantId: variant.id, quantity: qty }] : [],
    "LANDING",
    { enabled: true, landingSlug: product.slug },
  );
  const pixelItems = (): PixelLineItem[] => (variant ? [{ id: variant.id, name: product.name, quantity: qty, price: Number(shown.price) }] : []);
  const { addressLine, quote, quoting, shipping, zoneNeeded, zoneOpen, zoneKey, setZoneKey, zoneError, quotedTotal, submit, submitError } = useCodOrder({
    item: variant && !soldOut ? { variantId: variant.id, quantity: qty } : null,
    district,
    addressLine: watch("shippingAddressLine") ?? "",
    scope: "landing",
    copy: LANDING_ORDER_COPY,
    pixelItems,
    zoneElementId: "lp-zone",
  });
  // The sticky bar shows the same total as the summary, once the server has quoted it with delivery.
  useEffect(() => setQuotedTotal(quotedTotal), [quotedTotal, setQuotedTotal]);

  // The size finder's answers, kept with the order (recommended vs chosen) when the shopper used it.
  const [assist, setAssist] = useState<{ answers: FitAnswers; recommended: string } | null>(null);
  const fit = product.resolved?.sizeGuide?.chart?.fit?.enabled ? product.resolved.sizeGuide.chart.fit : null;
  const fitChart = product.resolved?.sizeGuide?.chart ?? undefined;
  function pickSize(s: string) {
    setSize(s);
    pixelFunnel("SelectSize", product.id, { size: s });
  }
  function pickColor(c: string) {
    setColor(c);
    pixelFunnel("SelectColor", product.id, { color: c });
  }
  const finder =
    fit && options.showSizes ? (
      <SizeFinder
        fit={fit}
        chart={fitChart}
        offered={options.sizes}
        sellable={(s) => sellable(s, color)}
        onSelect={pickSize}
        copy="bn"
        trigger="card"
        onOpen={() => {
          pixelFunnel("StartSizeAssistant", product.id);
          trackFunnelEvent("SIZE_ASSIST_OPENED", { productId: product.id });
        }}
        onAnswers={(answers, recommended) => {
          setAssist({ answers, recommended });
          pixelFunnel("CompleteSizeAssistant", product.id, { size: recommended });
          trackFunnelEvent("SIZE_ASSIST_COMPLETED", { productId: product.id });
        }}
      />
    ) : null;

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

  // AddShippingInfo once the address is written (after a pause in typing), once per product per session.
  useEffect(() => {
    if (addressLine.trim().length < 8 || !variant) return;
    pixelFunnel("AddShippingInfo", product.id);
    trackFunnelEvent("SHIPPING_INFO_ADDED", { productId: product.id, variantId: variant.id });
  }, [addressLine, variant, product.id]);
  // Savings against the product's own compare-at price, as the server resolved both prices.
  const unitWas = shown.was !== null && Number(shown.was) > Number(shown.price) ? Number(shown.was) : null;
  const savings = unitWas !== null ? (unitWas - Number(shown.price)) * qty : 0;

  // InitiateCheckout once, when the shopper starts on the form: the landing page's equivalent of opening checkout.
  const started = useRef(false);
  function onStart() {
    if (started.current || !variant) return;
    started.current = true;
    pixelInitiateCheckout(pixelItems());
    trackFunnelEvent("CHECKOUT_STARTED", { productId: product.id, variantId: variant.id });
  }

  // The popup's "continue": close it and carry on with the order (the form's own checks then run as usual).
  function continueFromPicker() {
    setPickerOpen(false);
    requestAnimationFrame(() => formRef.current?.requestSubmit());
  }

  async function placeOrder(values: FormValues) {
    if (!variant) return setPickerOpen(true);
    if (soldOut) return;
    await submit(values, { sizeAssist: assist && variant.size && variant.size !== NO_SIZE_VALUE ? sizeAssistFor(assist, variant.size) : undefined });
  }

  // A missing size or colour comes first, whatever else is still empty: it is the one thing the form can't guess.
  const onSubmit = handleSubmit(placeOrder, () => {
    if (!variant) setPickerOpen(true);
  });

  const fieldError = (id: string, message?: string) =>
    message ? (
      <p id={`${id}-error`} className="ui-field-error">
        {message}
      </p>
    ) : null;

  if (!codEnabled) {
    return (
      <p className="rounded-xl bg-surface-muted p-5 text-base text-fg-muted" lang="bn">
        এই মুহূর্তে অনলাইন অর্ডার বন্ধ আছে। কিছুক্ষণ পর আবার চেষ্টা করুন, অথবা আমাদের ফোন করুন।
      </p>
    );
  }

  const pickers = (
    <OptionPickers
      product={product}
      options={options}
      sizeLabel={sizeLabel}
      colorLabel={colorLabel}
      size={size}
      color={color}
      sellable={sellable}
      onSize={pickSize}
      onColor={pickColor}
      finder={finder}
      picked={assist && size === assist.recommended ? size : null}
      families={families}
    />
  );

  return (
    <form ref={formRef} onSubmit={onSubmit} onFocusCapture={onStart} noValidate className="space-y-7" lang="bn" data-testid="landing-order-form">
      {(options.showSizes || options.showColors) && <div id="landing-options">{pickers}</div>}

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-fg">পরিমাণ</p>
          {stock && stock.tone !== "ok" && (
            <p className={cn("mt-0.5 text-xs font-medium", stock.tone === "urgent" ? "text-danger-600" : "text-sale-600")} data-testid="landing-stock">
              {stock.tone === "urgent" ? "আর মাত্র কয়েকটি আছে" : "স্টক সীমিত, দ্রুত অর্ডার করুন"}
            </p>
          )}
          {soldOut && <p className="mt-0.5 text-xs font-medium text-danger-600">এটি এখন স্টকে নেই, অন্য সাইজ বা কালার দেখুন</p>}
        </div>
        <div className="flex items-center rounded-[var(--control-radius)] border border-line bg-surface">
          <button type="button" className="flex h-11 w-11 items-center justify-center text-fg disabled:opacity-30" onClick={() => setQuantity(Math.max(1, qty - 1))} disabled={qty <= 1} aria-label="একটি কমান">
            <Minus size={16} aria-hidden="true" />
          </button>
          <span className="w-9 text-center text-base font-semibold tabular-nums" aria-live="polite" data-testid="landing-qty">
            {bn(qty)}
          </span>
          <button type="button" className="flex h-11 w-11 items-center justify-center text-fg disabled:opacity-30" onClick={() => setQuantity(qty + 1)} disabled={!variant || qty >= maxQty} aria-label="আরও একটি নিন">
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {saved && (
          <div className="rounded-xl border border-line bg-surface-muted p-4" data-testid="landing-saved-delivery">
            <p className="text-sm font-semibold text-fg">আপনার আগের ঠিকানা ব্যবহার করবেন?</p>
            <p className="mt-1 text-sm text-fg-muted">
              {saved.name}, <span className="tabular-nums">{saved.phone}</span>
              <br />
              {[saved.addressLine, saved.area, saved.district].filter(Boolean).join(", ")}
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={applySaved} className="min-h-11 flex-1 rounded-[var(--control-radius)] bg-ink-900 px-4 text-sm font-semibold text-cream-50" data-testid="landing-use-saved">
                হ্যাঁ, ব্যবহার করুন
              </button>
              <button type="button" onClick={() => setSaved(null)} className="min-h-11 rounded-[var(--control-radius)] border border-line bg-surface px-4 text-sm font-semibold text-fg">
                না
              </button>
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="lp-name">আপনার নাম</Label>
            <Input
              id="lp-name"
              className="h-12 text-base"
              autoComplete="name"
              placeholder="যেমন: রাকিব হাসান"
              aria-invalid={!!errors.customerName}
              aria-describedby={errors.customerName ? "lp-name-error" : undefined}
              {...register("customerName")}
            />
            {fieldError("lp-name", errors.customerName?.message)}
          </div>
          <div>
            <Label htmlFor="lp-phone">মোবাইল নম্বর</Label>
            <Input
              id="lp-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="01XXXXXXXXX"
              className="h-12 text-base tabular-nums"
              aria-invalid={!!errors.customerPhone}
              aria-describedby={errors.customerPhone ? "lp-phone-error" : "lp-phone-hint"}
              {...register("customerPhone")}
            />
            {errors.customerPhone ? (
              fieldError("lp-phone", errors.customerPhone.message)
            ) : (
              <p id="lp-phone-hint" className="mt-1 text-xs text-fg-muted">
                এই নম্বরে ফোন করে অর্ডার কনফার্ম করা হবে। অর্ডার শেষ না হলে সাহায্যের জন্য আমরা এই তথ্য রাখি।
              </p>
            )}
            <AltPhoneField id="lp-alt-phone" lang="bn" className="mt-2" error={errors.altPhone?.message} inputProps={register("altPhone")} />
          </div>
        </div>
        {/* Address first, the way people write it; the place box below reads the thana out of it. */}
        <div>
          <Label htmlFor="lp-address">পূর্ণ ঠিকানা</Label>
          <Textarea
            id="lp-address"
            rows={2}
            autoComplete="street-address"
            placeholder="বাসা/ফ্ল্যাট নম্বর, রোড, এলাকা, থানা, জেলা"
            className="text-base"
            aria-invalid={!!errors.shippingAddressLine}
            aria-describedby={errors.shippingAddressLine ? "lp-address-error" : undefined}
            {...register("shippingAddressLine")}
          />
          {fieldError("lp-address", errors.shippingAddressLine?.message)}
        </div>
        <DeliveryPlaceField
          id="lp-area"
          lang="bn"
          addressLine={addressLine}
          district={district}
          area={area}
          onChange={(p) => {
            setValue("shippingDistrict", p.district, { shouldValidate: true });
            setValue("shippingArea", p.area, { shouldValidate: true });
          }}
        />
        {zoneNeeded && addressLine.trim().length >= 4 && quote?.zoneChoices && (
          <DeliveryZoneChoice
            id="lp-zone"
            lang="bn"
            choices={quote.zoneChoices}
            value={zoneKey}
            onChange={setZoneKey}
            error={zoneError}
          />
        )}
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
              {[color && `${colorLabel}: ${color}`, size && size !== NO_SIZE_VALUE ? `${sizeLabel}: ${size}` : null, `পরিমাণ: ${bn(qty)}`].filter(Boolean).join(" · ") || `${missing} বেছে নিন`}
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
              {/* "Inside or outside Dhaka?" only once an address is written and names no place; before that, both charges. */}
              {zoneOpen && addressLine.trim().length >= 4 ? <span className="text-fg-muted">ঢাকার ভেতরে না বাইরে বাছুন</span> : !shipping?.resolved || zoneOpen ? (shipsFree && !zoneOpen ? (
                <span className="font-semibold text-success-700">ফ্রি</span>
              ) : deliveryFees ? (
                // Both charges before the address is written: the shopper knows the total from the first look.
                <span className="text-fg-muted" data-testid="landing-fees">
                  ঢাকায় {deliveryFees.insideDhaka} · বাইরে {deliveryFees.outsideDhaka}
                </span>
              ) : (
                <span className="text-fg-muted">ঠিকানা দিলে দেখাবে</span>
              )) : shipping.waived ? <span className="font-semibold text-success-700">ফ্রি</span> : formatPrice(shipping.charged)}
            </dd>
          </div>
          {savings > 0 && (
            <div className="flex justify-between gap-4 text-success-700">
              <dt>আপনার সাশ্রয়</dt>
              <dd className="font-medium tabular-nums">{formatPrice(savings)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4 pt-2 text-fg">
            <dt className="text-base font-semibold">সর্বমোট</dt>
            {quote && shipping?.resolved && !zoneOpen ? (
              <dd className={cn("text-xl font-bold tabular-nums transition-opacity duration-base", quoting && "opacity-50")} data-testid="landing-total">
                {formatPrice(quote.total)}
              </dd>
            ) : (
              // Until the district is known: the products' price and that delivery comes on top — not a bare dash.
              <dd className="text-sm tabular-nums text-fg-muted">
                {formatPrice(quote ? quote.subtotal : Number(shown.price) * qty)}
                  {!shipsFree && " + ডেলিভারি"}
              </dd>
            )}
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
              অর্ডার পাঠানো হচ্ছে
            </>
          ) : (
            ctaText || "অর্ডার কনফার্ম করুন"
          )}
        </button>
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-fg-muted">
          <Lock size={13} className="shrink-0" aria-hidden="true" />
          এখন কোনো টাকা দিতে হবে না। পণ্য হাতে পেয়ে মূল্য পরিশোধ করবেন।
        </p>
      </div>

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={`${missing || sizeLabel} বেছে নিন`}
        description="অর্ডার করতে আপনার পছন্দেরটি বেছে নিন।"
        widthClassName="max-w-md"
      >
        <div lang="bn" data-testid="landing-option-popup">
          {pickers}
          <button
            type="button"
            onClick={continueFromPicker}
            disabled={!variant || soldOut}
            className="glossy mt-6 flex h-12 w-full items-center justify-center rounded-[var(--control-radius)] bg-accent text-base font-bold text-accent-fg disabled:opacity-40"
          >
            {variant && !soldOut ? "এগিয়ে যান" : `${missing || sizeLabel} বেছে নিন`}
          </button>
        </div>
      </Modal>
    </form>
  );
}

/** Size chips and colour swatches, in Bangla; sold-out choices stay visible but crossed out and disabled. */
function OptionPickers({
  product,
  options,
  sizeLabel,
  colorLabel,
  size,
  color,
  sellable,
  onSize,
  onColor,
  finder,
  picked,
  families = [],
}: {
  product: Product;
  options: VariantOptions;
  sizeLabel: string;
  colorLabel: string;
  size: string | null;
  color: string | null;
  sellable: (size: string | null, color: string | null) => boolean;
  onSize: (s: string) => void;
  onColor: (c: string) => void;
  /** The size finder card, under the size chips (only where the size guide has fit rules). */
  finder?: ReactNode;
  /** The size the finder suggested and the shopper kept. */
  picked?: string | null;
  /** The product families this product is in: each colour is its own product, shown as photo tiles (as on the product page). */
  families?: PublicProductFamily[];
}) {
  const chip =
    "flex min-h-11 min-w-11 items-center justify-center rounded-[var(--chip-radius)] border px-4 text-sm font-medium transition-[border-color,background-color,color] duration-base ease-smooth active:scale-[0.97]";
  const chipState = (selected: boolean, ok: boolean) =>
    selected ? "border-ink-900 bg-ink-900 text-cream-50" : ok ? "border-line bg-surface text-fg hover:border-ink-900" : "cursor-not-allowed border-dashed border-line text-fg-muted line-through";
  const anySoldOut = options.sizes.some((s) => !sellable(s, null));
  const [chartOpen, setChartOpen] = useState(false);
  const guide = product.resolved?.sizeGuide;
  const chart = guide?.show && guide.chart && guide.chart.enabled !== false && guide.chart.columns.length > 0 && guide.chart.rows.length > 0 ? guide.chart : null;
  // Every colour has its own photo: the shopper picks the jacket they can see, not a dot of colour.
  const photos = options.showColors ? options.colors.map((c) => colorImage(product, c)) : [];
  const byPhoto = photos.length > 1 && photos.every(Boolean);
  const familyShown = families.some((f) => familyTiles(f, product.id) !== null);

  const colorPicker = options.showColors && (
    // min-w-0: a fieldset is min-content wide by default, which would let the photo strip widen the page.
    <fieldset className="min-w-0">
      <legend className="mb-2.5 text-sm font-semibold text-fg">
        {colorLabel}
        {color && <span className="ml-2 font-normal text-fg-muted">{color}</span>}
      </legend>
      {byPhoto ? (
        <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden" data-testid="landing-color-photos">
          {options.colors.map((c, i) => {
            const ok = sellable(size, c);
            const selected = color === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => onColor(c)}
                disabled={!ok}
                aria-pressed={selected}
                aria-label={ok ? c : `${c}, স্টকে নেই`}
                title={c}
                className={cn(PHOTO_TILE_WIDTH, "text-left transition-transform duration-base active:scale-[0.97]", !ok && "cursor-not-allowed")}
              >
                {/* The name under the photo, whole (two lines at most): designs of one colour look alike at this size. */}
                <PhotoTileBody imageUrl={photos[i]!.url} label={c} selected={selected} unavailable={!ok} />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2.5">
          {options.colors.map((c) => {
            const ok = sellable(size, c);
            const hex = product.variants.find((v) => v.color === c)?.colorHex;
            const selected = color === c;
            return hex ? (
              <button
                key={c}
                type="button"
                onClick={() => onColor(c)}
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
              <button key={c} type="button" onClick={() => onColor(c)} disabled={!ok} aria-pressed={selected} className={cn(chip, chipState(selected, ok))}>
                {c}
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );

  return (
    <div className="space-y-5">
      {/* Photos first: the colour is what an ad visitor came for, and the gallery above follows it. When each colour is
          its own product (a family), the family's photo tiles take that place — a tap opens that colour's landing page. */}
      {familyShown &&
        families.map((family) => <ProductFamilyPicker key={family.id} family={family} currentProductId={product.id} hrefFor={(slug) => landingPagePath(slug)} title={colorLabel} />)}
      {byPhoto && colorPicker}
      {options.showSizes && (
        <fieldset>
          <div className="mb-2.5 flex items-baseline justify-between gap-3">
            <legend className="text-sm font-semibold text-fg">
              {sizeLabel}
              {size && size !== NO_SIZE_VALUE && <span className="ml-2 font-normal text-fg-muted">{size}</span>}
            </legend>
            {chart && (
              <button
                type="button"
                onClick={() => setChartOpen((o) => !o)}
                aria-expanded={chartOpen}
                aria-controls="lp-size-chart"
                className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-fg underline underline-offset-4"
              >
                <Ruler size={15} aria-hidden="true" />
                সাইজ চার্ট
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {options.sizes.map((s) => {
              const ok = sellable(s, null);
              const label = product.variants.find((v) => v.size === s)?.sizeLabel;
              return (
                <button key={s} type="button" onClick={() => onSize(s)} disabled={!ok} aria-pressed={size === s} aria-label={ok ? s : `${s}, স্টকে নেই`} className={cn(chip, chipState(size === s, ok))}>
                  {label ? `${s} (${label})` : s}
                </button>
              );
            })}
          </div>
          {anySoldOut && <p className="mt-2 text-xs text-fg-muted">কাটা দাগ দেওয়া সাইজগুলো এখন স্টকে নেই।</p>}
          {picked && (
            <p className="mt-2 text-xs font-medium text-fg" data-testid="landing-size-picked">
              আপনার মাপ অনুযায়ী {picked} বাছা হয়েছে। চাইলে অন্য সাইজও বেছে নিতে পারেন।
            </p>
          )}
          {finder && <div className="mt-3">{finder}</div>}
          {chart && chartOpen && (
            <div id="lp-size-chart" className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface" data-testid="landing-size-chart">
              <table className="w-full text-left text-sm tabular-nums" lang="en">
                <thead>
                  <tr className="text-xs text-fg-muted">
                    {chart.columns.map((col, i) => (
                      <th key={i} scope="col" className="px-3 py-2 font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line border-t border-line">
                  {chart.rows.map((row, r) => (
                    <tr key={r} className={cn(row[0] === size && "bg-surface-muted font-semibold")}>
                      {row.map((cell, c) => (
                        <td key={c} className={cn("px-3 py-2 text-fg", c === 0 && "font-semibold")}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-line px-3 py-2 text-xs text-fg-muted" lang="bn">
                {chart.fit?.enabled ? "এগুলো পোশাকের মাপ, শরীরের নয়। " : ""}মাপ {chart.unit === "cm" ? "সেন্টিমিটারে" : "ইঞ্চিতে"}। দুই সাইজের মাঝামাঝি হলে বড়টা নিন।
                {chart.fit?.enabled && " মেলাতে: আপনার ঠিকঠাক মাপের একটা জ্যাকেট সমান করে রেখে এক বগল থেকে আরেক বগল মেপে দুই দিয়ে গুণ করুন (বুক), আর কাঁধের ওপর থেকে নিচ পর্যন্ত মাপুন (লম্বা)।"}
              </p>
            </div>
          )}
        </fieldset>
      )}
      {!byPhoto && !(familyShown && options.colors.length <= 1) && colorPicker}
    </div>
  );
}

/** The finder snapshot for the order: what it recommended, what was ordered, and whether the shopper kept it. */
function sizeAssistFor(assist: { answers: FitAnswers; recommended: string }, chosen: string): SizeAssist {
  const a = assist.answers;
  return {
    heightIn: a.heightIn,
    weightKg: a.weightKg,
    chestIn: a.chestIn ?? null,
    usualSize: a.usualSize ?? null,
    overLayer: a.overLayer ?? false,
    heightUnit: "ft-in",
    weightUnit: "kg",
    recommended: assist.recommended,
    chosen,
    accepted: chosen === assist.recommended,
  };
}
