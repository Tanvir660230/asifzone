import type { Order, StoreSettings } from "@clothing-brand/shared";
import { formatPrice } from "@/lib/format";
import { StoreLogoImage } from "@/components/store-logo-image";
import { BarcodeSvg } from "./barcode-svg";
import { QrCodeSvg } from "./qr-code-svg";

interface ShippingLabelSquareProps {
  order: Order;
  store: StoreSettings | undefined;
  /** Forwarded to the internal BarcodeSvg — the label-printing capture pipeline uses this to know
   * when it's safe to rasterize this label (JsBarcode draws in an effect, after mount). */
  onBarcodeReady?: () => void;
}

/** The 3"x3" (76.2mm square) sticker's own label — same editorial design language as ShippingLabel
 * (logo, serif recipient name, QR beside it, double-rule COD box, hairline rules, thin barcode
 * quiet-zone) rendered directly at this size rather than through LabelScaleWrapper's uniform
 * transform-scale.
 *
 * That distinction is the reason this file exists rather than just reusing ShippingLabel at a
 * smaller scale: ShippingLabel is hand-tuned for a ~95x91mm cell, and scaling that whole design
 * down to fit 76.2mm (a real target tried first) put every font size at ~76% of its tuned value —
 * legible on screen, but real prints showed the smallest text (the packing list) and the QR
 * reproducing too fine for a thermal head to burn cleanly. Scaling the *reference size* down instead
 * of the *rendered* size doesn't help either — LabelScaleWrapper's scale is just cellSize/nativeSize,
 * so shrinking both by the same factor cancels out and leaves the final effective font size on paper
 * unchanged (do the algebra: (fontSize * k) * (scale / k) === fontSize * scale).
 *
 * The only real lever for "same design, genuinely bigger text, one fixed physical size" is writing
 * font sizes tuned directly for that size, at near-native (no-scale-down) rendering — which is what
 * this component is. The one content difference from ShippingLabel: no packing list. Freeing that
 * vertical row is what pays for every other element being noticeably larger than the scaled-down
 * version was; a courier doesn't need it to deliver, and a warehouse packer already works from the
 * admin order screen, not this sticker (same reasoning ShippingLabelCompact's tiers already use). */
export function ShippingLabelSquare({ order, store, onBarcodeReady }: ShippingLabelSquareProps) {
  const booked = Boolean(order.courierConsignmentId);
  const barcodeValue = booked && order.trackingNumber ? order.trackingNumber : order.orderNumber;

  return (
    <div className="flex h-full flex-col bg-white text-ink-900">
      {/* Just the logo — it already has the store name baked into the artwork, so a separate text
          label next to it would be redundant. Falls back to a text wordmark only if there's no
          logo configured, or the logo URL fails to load. */}
      <div className="flex items-center justify-between gap-2 border-b border-ink-200 pb-1.5">
        {store?.logoUrl ? (
          <StoreLogoImage
            src={store.logoUrl}
            alt={store.storeName}
            className="h-9 w-32 shrink-0"
            fallback={<span className="text-[12px] font-bold uppercase tracking-wide">{store.storeName}</span>}
          />
        ) : (
          <span className="text-[12px] font-bold uppercase tracking-wide">{store?.storeName ?? "Store"}</span>
        )}
        <span className="shrink-0 truncate text-[9px] tracking-wide text-ink-600">{order.orderNumber}</span>
      </div>

      {/* Recipient — the single most important block on the label, set in the brand's own display
          serif rather than a boxed card, so it reads like a boutique packing slip rather than a UI
          component pasted onto paper. The QR sits beside it (not down by the barcode) since it
          shares the same "who/where this parcel is for" context. Every line truncates to one row —
          a long value hits an ellipsis instead of wrapping and pushing everything below it down. */}
      <div className="mt-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[19px] font-bold leading-tight text-ink-900">{order.customerName}</p>
          <p className="truncate text-[16px] font-semibold leading-tight tabular-nums text-ink-800">
            {order.customerPhone}
          </p>
          <p className="mt-1 truncate text-[12px] leading-snug text-ink-800">{order.shippingAddressLine}</p>
          <p className="truncate text-[12px] leading-snug text-ink-800">
            {order.shippingArea}, {order.shippingDistrict}, {order.shippingDivision}
          </p>
        </div>
        {booked && order.courierTrackingLink && (
          <div className="shrink-0 pt-0.5">
            <QrCodeSvg value={order.courierTrackingLink} size={52} />
          </div>
        )}
      </div>

      {/* COD is the costliest thing for a courier to get wrong, so it's still the single largest
          number on the label — the emphasis comes from a bold black rule above and below, not a
          filled box. Paid orders get the same shape at a fraction of the weight — a light gray
          hairline instead of black, small instead of large — so which one needs action is obvious
          without either needing color. */}
      {order.paymentMethod === "COD" ? (
        <div className="mt-2.5 flex items-baseline justify-between border-y-2 border-ink-900 py-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-ink-700">
            Cash on delivery
          </span>
          <span className="text-[23px] font-extrabold leading-none tabular-nums text-ink-900">
            {formatPrice(order.total)}
          </span>
        </div>
      ) : (
        <div className="mt-2.5 flex items-baseline justify-between border-y border-ink-200 py-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-ink-700">Payment</span>
          <span className="text-[12px] font-semibold text-ink-800">
            {order.paymentStatus === "PAID" ? "Paid online" : `Online — ${order.paymentStatus}`}
          </span>
        </div>
      )}

      {/* Barcode, centered and anchored to the very bottom — mirrors Steadfast's own label layout.
          BarcodeSvg bakes its own quiet-zone margin into the image and scales itself down instead
          of overflowing if the encoded value happens to be long — see its own comment for why. */}
      <div className="mt-auto flex flex-col items-center border-t border-ink-200 pt-1.5 text-center">
        <div className="flex w-full justify-center">
          <BarcodeSvg value={barcodeValue} height={48} width={1.3} fontSize={10} onReady={onBarcodeReady} />
        </div>
        {booked ? (
          <p className="mt-1 truncate text-[9px] text-ink-700">Parcel ID: {order.courierConsignmentId}</p>
        ) : (
          <p className="mt-1 inline-block rounded border border-ink-900 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-900">
            Not booked with courier yet
          </p>
        )}
      </div>
    </div>
  );
}
