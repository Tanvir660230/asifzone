import type { Order, StoreSettings } from "@clothing-brand/shared";
import { formatPrice } from "@/lib/format";
import { StoreLogoImage } from "@/components/store-logo-image";
import { BarcodeSvg } from "./barcode-svg";
import { QrCodeSvg } from "./qr-code-svg";

interface ShippingLabelProps {
  order: Order;
  store: StoreSettings | undefined;
}

/** Packing-list text shrinks in steps as an order picks up more line items, instead of a fixed
 * font size that either wastes space on a 1-item order or overflows a many-item one. The barcode
 * at the bottom of the card is non-negotiable — a courier who can't scan it can't hand the parcel
 * over — so maxShown is capped well below what would actually fit text-wise, leaving guaranteed
 * room underneath rather than letting the list claim every last mm and clip the barcode off. */
function itemListSizing(itemCount: number): { className: string; maxShown: number } {
  if (itemCount <= 3) return { className: "text-[8.5px]", maxShown: itemCount };
  if (itemCount <= 5) return { className: "text-[7.5px]", maxShown: itemCount };
  return { className: "text-[7px]", maxShown: 3 };
}

/** A compact cut-and-paste shipping label — one order per card, sized for the 95mm x 91mm grid
 * cell defined in globals.css's print rules. Doubles as an internal packing label even before a
 * courier booking exists (falls back to encoding the order number instead of a tracking code).
 *
 * The visual language is deliberately editorial rather than "web card on paper" — thin rule lines
 * and type-weight contrast do the work that rounded gray boxes and thick borders were doing before,
 * which reads as considerably more premium for a clothing brand and, as a side effect, costs less
 * toner across a big print run than filled boxes would. Rule weight itself carries meaning: a bold
 * black double-rule around the COD amount vs. a hairline gray one for a paid order.
 *
 * Three constraints still shape every choice here: (1) visual weight is deliberately unequal —
 * recipient name > COD amount > barcode > everything else — matching what a courier needs to read
 * first off a stack of labels; (2) it survives a black-and-white printer, since nothing critical is
 * signaled by hue alone; (3) every text field is admin/customer-entered and unbounded in length (a
 * long name, a pasted paragraph of an address, a 12-item order) — every line either truncates or
 * shrinks so one long value can't silently push the barcode off the card. */
export function ShippingLabel({ order, store }: ShippingLabelProps) {
  const booked = Boolean(order.courierConsignmentId);
  const barcodeValue = booked && order.trackingNumber ? order.trackingNumber : order.orderNumber;
  const { className: itemFontClass, maxShown: maxItemsShown } = itemListSizing(order.items.length);
  const extraItemCount = order.items.length - maxItemsShown;

  return (
    <div className="label-cell flex h-full flex-col bg-white text-ink-900">
      {/* Just the logo — it already has the store name baked into the artwork, so a separate text
          label next to it would be redundant. Falls back to a text wordmark only if there's no
          logo configured, or the logo URL fails to load. */}
      <div className="flex items-center justify-between gap-2 border-b border-ink-200 pb-1">
        {store?.logoUrl ? (
          <StoreLogoImage
            src={store.logoUrl}
            alt={store.storeName}
            className="h-8 w-28 shrink-0"
            fallback={<span className="text-[10px] font-bold uppercase tracking-wide">{store.storeName}</span>}
          />
        ) : (
          <span className="text-[10px] font-bold uppercase tracking-wide">{store?.storeName ?? "Store"}</span>
        )}
        <span className="shrink-0 truncate text-[8px] tracking-wide text-ink-400">{order.orderNumber}</span>
      </div>

      {/* Recipient — the single most important block on the label, set in the brand's own display
          serif rather than a boxed card, so it reads like a boutique packing slip rather than a UI
          component pasted onto paper. The QR sits beside it (not down by the barcode) since it
          shares the same "who/where this parcel is for" context, and frees the barcode row to be a
          single centered element further down. Every line truncates to one row — a long value hits
          an ellipsis instead of wrapping and pushing everything below it further down the card. */}
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold leading-tight text-ink-900">{order.customerName}</p>
          <p className="truncate text-[13px] font-semibold leading-tight tabular-nums text-ink-800">
            {order.customerPhone}
          </p>
          <p className="mt-1 truncate text-[10px] leading-snug text-ink-600">{order.shippingAddressLine}</p>
          <p className="truncate text-[10px] leading-snug text-ink-500">
            {order.shippingArea}, {order.shippingDistrict}, {order.shippingDivision}
          </p>
        </div>
        {booked && order.courierTrackingLink && (
          <div className="shrink-0 pt-0.5">
            <QrCodeSvg value={order.courierTrackingLink} size={36} />
          </div>
        )}
      </div>

      {/* COD is the costliest thing for a courier to get wrong, so it's still the single largest
          number on the label — but the emphasis now comes from a bold black rule above and below,
          not a filled box. A pair of hairlines costs almost no toner even across hundreds of
          labels. Paid orders get the same shape at a fraction of the weight — a light gray hairline
          instead of black, small instead of large — so which one needs action is obvious without
          either needing color. */}
      {order.paymentMethod === "COD" ? (
        <div className="mt-2 flex items-baseline justify-between border-y-2 border-ink-900 py-1.5">
          <span className="text-[8px] font-semibold uppercase tracking-[0.15em] text-ink-500">
            Cash on delivery
          </span>
          <span className="text-[19px] font-extrabold leading-none tabular-nums text-ink-900">
            {formatPrice(order.total)}
          </span>
        </div>
      ) : (
        <div className="mt-2 flex items-baseline justify-between border-y border-ink-200 py-1">
          <span className="text-[8px] font-semibold uppercase tracking-[0.15em] text-ink-400">Payment</span>
          <span className="text-[10px] font-semibold text-ink-600">
            {order.paymentStatus === "PAID" ? "Paid online" : `Online — ${order.paymentStatus}`}
          </span>
        </div>
      )}

      {/* Packing list — this label is what the box actually gets packed from, so each item gets
          its own line with size/color instead of one truncated summary string. Font size and how
          many lines get shown both scale down as the item count grows (see itemListSizing) so a
          10-item order degrades gracefully instead of blowing out the card's fixed height. */}
      <div className="mt-1.5">
        {order.items.slice(0, maxItemsShown).map((item) => (
          <p key={item.id} className={`truncate leading-snug text-ink-700 ${itemFontClass}`}>
            <span className="font-semibold text-ink-900">{item.quantity}×</span> {item.productNameSnapshot}
            {(item.sizeSnapshot || item.colorSnapshot) && (
              <span className="text-ink-500">
                {" "}
                ({[item.sizeSnapshot, item.colorSnapshot].filter(Boolean).join(", ")})
              </span>
            )}
          </p>
        ))}
        {extraItemCount > 0 && (
          <p className="text-[7px] font-medium text-ink-500">
            +{extraItemCount} more item{extraItemCount === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {/* Barcode, centered and anchored to the very bottom — mirrors Steadfast's own label layout,
          and gives it a full, unshared width now that the QR lives up with the recipient block.
          BarcodeSvg bakes its own quiet-zone margin into the image and scales itself down instead
          of overflowing if the encoded value happens to be long — see its own comment for why. */}
      <div className="mt-auto flex flex-col items-center border-t border-ink-200 pt-1 text-center">
        <div className="flex w-full justify-center">
          <BarcodeSvg value={barcodeValue} height={40} width={1.2} fontSize={9} />
        </div>
        {booked ? (
          <p className="mt-0.5 truncate text-[7.5px] text-ink-600">Parcel ID: {order.courierConsignmentId}</p>
        ) : (
          <p className="mt-0.5 inline-block rounded border border-ink-900 px-1.5 py-0.5 text-[7.5px] font-bold uppercase tracking-wide text-ink-900">
            Not booked with courier yet
          </p>
        )}
      </div>
    </div>
  );
}
