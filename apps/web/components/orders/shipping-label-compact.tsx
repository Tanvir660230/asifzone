import type { Order, StoreSettings } from "@clothing-brand/shared";
import { formatPrice } from "@/lib/format";
import type { LabelTemplateId } from "@/lib/label-templates";
import { StoreLogoImage } from "@/components/store-logo-image";
import { BarcodeSvg } from "./barcode-svg";

type CompactTemplateId = "sticker-80x50" | "sticker-60x40" | "sticker-50x30";

interface ShippingLabelCompactProps {
  order: Order;
  store: StoreSettings | undefined;
  templateId: CompactTemplateId;
  onBarcodeReady?: () => void;
}

interface CompactSizeTier {
  paddingMm: number;
  storeNamePx: number;
  orderNumberPx: number;
  namePx: number;
  phonePx: number;
  addressPx: number;
  codPx: number;
  barcodeHeight: number;
  barcodeFontSize: number;
  /** Below this, there's no vertical room for the barcode's own human-readable digits row on top
   * of everything else — the bars alone stay fully scannable without it. */
  showBarcodeDigits: boolean;
  /** Height of the store logo image in the header row, in px — width follows at a fixed 3.5:1
   * aspect ratio (matching the full ShippingLabel's own h-8/w-28 logo box) rather than being stored
   * separately, so every tier's logo box keeps the same proportions regardless of size. Used only
   * when the store actually has a logoUrl configured; falls back to the text wordmark otherwise (or
   * if the image fails to load — see StoreLogoImage). */
  logoHeightPx: number;
}

// Three deliberately minimal tiers for the cramped thermal sticker sizes — dropping the QR code and
// the packing list entirely (no room, and a courier scanning a parcel doesn't need either), keyed off
// the template rather than item count since content here is fixed regardless of order size. Mirrors
// the tiering approach ShippingLabel's own itemListSizing() uses, just for a different axis.
//
// The header logo stays in, at a small size, even on the smallest tier: an early version of this
// component dropped it everywhere on these three templates, reasoning a raster logo would cost more
// legibility than it's worth at this physical size — but a shop's own branding on its shipping
// sticker isn't optional to them, it's the point of printing a custom label instead of a courier's
// generic one. StoreLogoImage's built-in fallback (back to the plain text wordmark) still covers the
// case where no logo is configured or the image fails to load, so this never regresses to a blank
// header.
const COMPACT_TIERS: Record<CompactTemplateId, CompactSizeTier> = {
  "sticker-80x50": {
    paddingMm: 2,
    storeNamePx: 7,
    orderNumberPx: 6.5,
    namePx: 12,
    phonePx: 11,
    addressPx: 8,
    codPx: 14,
    barcodeHeight: 26,
    barcodeFontSize: 7,
    showBarcodeDigits: true,
    logoHeightPx: 10,
  },
  "sticker-60x40": {
    paddingMm: 1.5,
    storeNamePx: 6,
    orderNumberPx: 5.5,
    namePx: 10,
    phonePx: 9.5,
    addressPx: 7,
    codPx: 12,
    barcodeHeight: 20,
    barcodeFontSize: 6,
    showBarcodeDigits: true,
    logoHeightPx: 8,
  },
  "sticker-50x30": {
    paddingMm: 1,
    storeNamePx: 5.5,
    orderNumberPx: 5,
    namePx: 8.5,
    phonePx: 8,
    addressPx: 6.5,
    codPx: 10,
    barcodeHeight: 15,
    barcodeFontSize: 0,
    showBarcodeDigits: false,
    logoHeightPx: 7,
  },
};

const LOGO_ASPECT_RATIO = 3.5;

export function isCompactTemplateId(id: LabelTemplateId): id is CompactTemplateId {
  return id === "sticker-80x50" || id === "sticker-60x40" || id === "sticker-50x30";
}

/** Minimal shipping label for the three thermal sticker sizes too small for the full ShippingLabel
 * design even scaled down — a shrunk copy of that design would make text/barcode illegibly tiny at
 * real print size, so this drops everything but what a courier actually needs off a tiny sticker:
 * who it's for, how to reach them, what's owed, a small store logo, and a barcode that's never
 * allowed to be cut. No QR (adds visual noise, not scan value beyond the barcode), no packing list,
 * no booked/not-booked courier status caption. */
export function ShippingLabelCompact({ order, store, templateId, onBarcodeReady }: ShippingLabelCompactProps) {
  const tier = COMPACT_TIERS[templateId];
  const booked = Boolean(order.courierConsignmentId);
  const barcodeValue = booked && order.trackingNumber ? order.trackingNumber : order.orderNumber;
  const addressLine = [order.shippingAddressLine, order.shippingArea].filter(Boolean).join(", ");

  return (
    <div className="flex h-full flex-col bg-white text-ink-900" style={{ padding: `${tier.paddingMm}mm` }}>
      <div className="flex items-center justify-between gap-1 border-b border-ink-200 pb-0.5">
        {store?.logoUrl ? (
          <StoreLogoImage
            src={store.logoUrl}
            alt={store.storeName}
            className="shrink-0"
            style={{ height: `${tier.logoHeightPx}px`, width: `${tier.logoHeightPx * LOGO_ASPECT_RATIO}px` }}
            fallback={
              <span className="truncate font-bold uppercase tracking-wide" style={{ fontSize: `${tier.storeNamePx}px` }}>
                {store.storeName}
              </span>
            }
          />
        ) : (
          <span
            className="truncate font-bold uppercase tracking-wide"
            style={{ fontSize: `${tier.storeNamePx}px` }}
          >
            {store?.storeName ?? "Store"}
          </span>
        )}
        <span className="shrink-0 truncate text-ink-600" style={{ fontSize: `${tier.orderNumberPx}px` }}>
          {order.orderNumber}
        </span>
      </div>

      <p className="mt-1 truncate font-bold leading-tight text-ink-900" style={{ fontSize: `${tier.namePx}px` }}>
        {order.customerName}
      </p>
      <p className="truncate font-semibold leading-tight tabular-nums text-ink-800" style={{ fontSize: `${tier.phonePx}px` }}>
        {order.customerPhone}
      </p>
      <p className="mt-0.5 truncate leading-snug text-ink-800" style={{ fontSize: `${tier.addressPx}px` }}>
        {addressLine}
      </p>

      {order.paymentMethod === "COD" ? (
        <p className="mt-1 truncate font-extrabold leading-none tabular-nums text-ink-900" style={{ fontSize: `${tier.codPx}px` }}>
          COD {formatPrice(order.total)}
        </p>
      ) : (
        <p className="mt-1 truncate font-extrabold leading-none text-ink-800" style={{ fontSize: `${tier.codPx}px` }}>
          Prepaid
        </p>
      )}

      <div className="mt-auto flex w-full justify-center pt-0.5">
        <BarcodeSvg
          value={barcodeValue}
          height={tier.barcodeHeight}
          width={0.9}
          fontSize={tier.barcodeFontSize}
          displayValue={tier.showBarcodeDigits}
          onReady={onBarcodeReady}
        />
      </div>
    </div>
  );
}
