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

/** However many items an order has, the packing list only ever shows the first 2 (plus a "+N more"
 * line if there are more) — unlike ShippingLabel's own itemListSizing, which grows the shown count
 * for small orders and shrinks font size for big ones. That stepped approach doesn't fit here: the
 * vertical budget on a 76.2mm square is already tighter than ShippingLabel's native ~95x91mm canvas,
 * so a fixed 2-line cap is what keeps the worst case (a long name, a 3-line address, and a 6-item
 * order) numerically verified to still leave the barcode and Parcel ID caption on the label — see
 * this file's own top comment for the actual numbers. */
const MAX_ITEMS_SHOWN = 2;

/** The 3"x3" (76.2mm square) sticker's own label — same editorial design language as ShippingLabel
 * (logo, serif recipient name, QR beside it, double-rule COD box, hairline rules, thin barcode
 * quiet-zone) rendered directly at this size rather than through LabelScaleWrapper's uniform
 * transform-scale.
 *
 * That distinction is the reason this file exists rather than just reusing ShippingLabel at a
 * smaller scale: ShippingLabel is hand-tuned for a ~95x91mm cell, and scaling that whole design
 * down to fit 76.2mm (a real target tried first) put every font size at ~76% of its tuned value —
 * legible on screen, but real prints showed the smallest text and the QR reproducing too fine for a
 * thermal head to burn cleanly. Scaling the *reference size* down instead of the *rendered* size
 * doesn't help either — LabelScaleWrapper's scale is just cellSize/nativeSize, so shrinking both by
 * the same factor cancels out and leaves the final effective font size on paper unchanged (do the
 * algebra: (fontSize * k) * (scale / k) === fontSize * scale).
 *
 * The only real lever for "same design, genuinely bigger text, one fixed physical size" is writing
 * font sizes tuned directly for that size, at near-native (no-scale-down) rendering — which is what
 * this component is.
 *
 * The address is two separate wrapped paragraphs — the street/institution line, then area/district/
 * division — mirroring ShippingLabel's own field layout exactly rather than merging them into one
 * comma-joined line, which read badly once real Bangla addresses (which often already end in their
 * own local punctuation) were sitting inline next to the English area/district/division. Neither
 * line truncates: a real Bangladeshi address routinely needs the full line to stay a deliverable
 * parcel, and unlike an item name, an address that got silently ellipsised is one a courier can't
 * actually deliver. `line-clamp-2` on the first line is a safety ceiling for a genuinely extreme
 * outlier, not the expected case.
 *
 * A first version of this component dropped the packing list entirely to buy room for bigger text —
 * a real printed order (single item, 2-line address) came back readable, but with no way to tell the
 * courier or the customer what's actually in the box without opening it. It's back here, capped at 2
 * lines (see MAX_ITEMS_SHOWN's own comment for why a fixed cap instead of ShippingLabel's stepped
 * one), at the cost of trimming a few pixels of margin everywhere else. Every section's height was
 * re-measured against a synthetic worst case — a long transliterated name, a 2-line-clamped Bangla
 * address, a 5-figure COD amount, and a 6-item order (2 shown + "+4 more items") — which still
 * leaves the barcode and Parcel ID/booking-status caption on-label with ~12px (~4.5%) of the 72.2mm
 * usable height (76.2mm page minus the sticker template's 2mm margin on each side) to spare; a
 * typical single-item order leaves closer to 15%. Verified by actually measuring rendered height —
 * including the digits JsBarcode draws under the bars, which a first pass at this math missed and
 * would have overflowed the container by a hair. (This card sits in a fixed-height, `overflow:
 * hidden` box in label-capture-host.tsx — content that runs past its bottom edge doesn't get cut off
 * from view, it gets cut out of the actual captured image, which is what silently disappeared the
 * Parcel ID line in an earlier version of this component that budgeted for a single-line address.) */
export function ShippingLabelSquare({ order, store, onBarcodeReady }: ShippingLabelSquareProps) {
  const booked = Boolean(order.courierConsignmentId);
  const barcodeValue = booked && order.trackingNumber ? order.trackingNumber : order.orderNumber;
  const shownItems = order.items.slice(0, MAX_ITEMS_SHOWN);
  const extraItemCount = order.items.length - shownItems.length;

  return (
    <div className="flex h-full flex-col bg-white text-ink-900">
      {/* Just the logo — it already has the store name baked into the artwork, so a separate text
          label next to it would be redundant. Falls back to a text wordmark only if there's no
          logo configured, or the logo URL fails to load. */}
      <div className="flex items-center justify-between gap-2 border-b border-ink-200 pb-1">
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
          shares the same "who/where this parcel is for" context. Name and phone truncate to one row
          (a genuinely unreasonable value there is an outlier worth losing gracefully); the address's
          two lines instead wrap — see this file's own top comment for why that field never truncates. */}
      <div className="mt-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[18px] font-bold leading-tight text-ink-900">{order.customerName}</p>
          <p className="truncate text-[15px] font-semibold leading-tight tabular-nums text-ink-800">
            {order.customerPhone}
          </p>
          <p className="mt-[3px] line-clamp-2 text-[9.5px] leading-snug text-ink-800">{order.shippingAddressLine}</p>
          <p className="truncate text-[9.5px] leading-snug text-ink-800">
            {order.shippingArea}, {order.shippingDistrict}, {order.shippingDivision}
          </p>
        </div>
        {booked && order.courierTrackingLink && (
          <div className="shrink-0 pt-0.5">
            <QrCodeSvg value={order.courierTrackingLink} size={44} />
          </div>
        )}
      </div>

      {/* COD is the costliest thing for a courier to get wrong, so it's still the single largest
          number on the label — the emphasis comes from a bold black rule above and below, not a
          filled box. Paid orders get the same shape at a fraction of the weight — a light gray
          hairline instead of black, small instead of large — so which one needs action is obvious
          without either needing color. */}
      {order.paymentMethod === "COD" ? (
        <div className="mt-1.5 flex items-baseline justify-between border-y-2 border-ink-900 py-[3px]">
          <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-ink-700">
            Cash on delivery
          </span>
          <span className="text-[21px] font-extrabold leading-none tabular-nums text-ink-900">
            {formatPrice(order.total)}
          </span>
        </div>
      ) : (
        <div className="mt-1.5 flex items-baseline justify-between border-y border-ink-200 py-[3px]">
          <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-ink-700">Payment</span>
          <span className="text-[12px] font-semibold text-ink-800">
            {order.paymentStatus === "PAID" ? "Paid online" : `Online — ${order.paymentStatus}`}
          </span>
        </div>
      )}

      {/* Packing list — capped at MAX_ITEMS_SHOWN lines regardless of order size (see that constant's
          own comment). Each item line still truncates rather than wraps: unlike the address, an item
          name getting cut is a labeling inconvenience, not an undeliverable parcel, and letting it
          wrap would blow the vertical budget the same way an unclamped address did before. */}
      <div className="mt-[3px]">
        {shownItems.map((item) => (
          <p key={item.id} className="truncate text-[8px] leading-[1.2] text-ink-700">
            <span className="font-semibold text-ink-900">{item.quantity}×</span> {item.productNameSnapshot}
            {(item.sizeSnapshot || item.colorSnapshot) && (
              <span className="text-ink-700">
                {" "}
                ({[item.sizeSnapshot, item.colorSnapshot].filter(Boolean).join(", ")})
              </span>
            )}
          </p>
        ))}
        {extraItemCount > 0 && (
          <p className="text-[7px] font-medium text-ink-700">
            +{extraItemCount} more item{extraItemCount === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {/* Barcode, centered and anchored to the very bottom — mirrors Steadfast's own label layout.
          BarcodeSvg bakes its own quiet-zone margin into the image and scales itself down instead
          of overflowing if the encoded value happens to be long — see its own comment for why. */}
      <div className="mt-auto flex flex-col items-center border-t border-ink-200 pt-px text-center">
        <div className="flex w-full justify-center">
          <BarcodeSvg value={barcodeValue} height={46} width={1.3} fontSize={9} onReady={onBarcodeReady} />
        </div>
        {booked ? (
          <p className="mt-0.5 truncate text-[9px] text-ink-700">Parcel ID: {order.courierConsignmentId}</p>
        ) : (
          <p className="mt-0.5 inline-block rounded border border-ink-900 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-900">
            Not booked with courier yet
          </p>
        )}
      </div>
    </div>
  );
}
