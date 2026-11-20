"use client";

import type { ProductLabelVariant } from "@clothing-brand/shared";
import { BarcodeSvg } from "@/components/orders/barcode-svg";
import { QrCodeSvg } from "@/components/orders/qr-code-svg";
import { formatPriceWhole } from "@/lib/format";
import { STICKER_SIZES, stickerBarcode, stickerName, stickerSizeTier, type StickerSize } from "@/lib/product-sticker";
import { cn } from "@/lib/utils";

const MIN_QR_MM = 10;

/** Millimetre and point measurements per sticker size; rem units would follow the admin's responsive root zoom. */
const STICKER_LAYOUT = {
  "50x25": { sideMm: 14, sizeBoxMm: 7.5, gapMm: 0.8, stripMm: 5, name: "9pt", color: "9pt", price: "7pt", code: "5.5pt", tier: { xl: "18pt", lg: "14pt", md: "11.5pt", sm: "7pt" } },
  "50x30": { sideMm: 15, sizeBoxMm: 8.5, gapMm: 1, stripMm: 6, name: "9.5pt", color: "10pt", price: "8pt", code: "6.5pt", tier: { xl: "20pt", lg: "16pt", md: "13pt", sm: "8pt" } },
  "38x25": { sideMm: 11.5, sizeBoxMm: 7, gapMm: 0.8, stripMm: 5, name: "7pt", color: "8pt", price: "6.5pt", code: "5.5pt", tier: { xl: "16pt", lg: "13pt", md: "10.5pt", sm: "6.5pt" } },
} as const;

/** One sticker: name, colour and code on the left; the size in a box with the QR code under it on the right. A product
 * with its own barcode (EAN and the like) also gets a bar strip along the bottom when it prints cleanly
 * (lib/product-sticker.ts); an SKU-only product always gets the QR alone, so every size of it looks the same. */
export function ClassicLabel({ v, size, showPrice, printed }: { v: ProductLabelVariant; size: StickerSize; showPrice: boolean; printed?: boolean }) {
  const dims = STICKER_SIZES[size];
  const l = STICKER_LAYOUT[size];
  const strip = v.barcode ? stickerBarcode(v.code, size) : null;
  const tier = stickerSizeTier(v.size);
  const innerH = dims.heightMm - 2 * dims.padMm - (strip ? l.stripMm + l.gapMm : 0);
  const qrMm = Math.min(l.sideMm, innerH - (tier === "none" ? 0 : l.sizeBoxMm + l.gapMm));
  // Under 10 mm (quiet zone included) a QR's squares get close to two printer dots; the bars carry the same code then.
  const showQr = !strip || qrMm >= MIN_QR_MM;
  return (
    <div
      style={{ width: `${dims.widthMm}mm`, height: `${dims.heightMm}mm`, padding: `${dims.padMm}mm` }}
      data-testid={printed ? "product-sticker" : "product-sticker-preview"}
      className={cn("flex flex-col overflow-hidden bg-white text-black", printed && "break-after-page")}
    >
      <div className="flex min-h-0 flex-1" style={{ gap: `${l.gapMm}mm` }}>
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div className="min-w-0">
            <p data-field="name" className="line-clamp-2 font-bold leading-[1.15]" style={{ fontSize: l.name }}>
              {stickerName(v.productName, v.color)}
            </p>
            {v.color && (
              <p data-field="color" className="truncate font-semibold leading-[1.15]" style={{ fontSize: l.color, marginTop: "0.6mm" }}>
                {v.color}
              </p>
            )}
            {showPrice && v.price != null && (
              <p className="font-semibold leading-[1.15] tabular-nums" style={{ fontSize: l.price, marginTop: "0.4mm" }}>
                {formatPriceWhole(v.price)}
              </p>
            )}
          </div>
          <p data-field="code" className="break-all font-mono font-semibold leading-[1.2]" style={{ fontSize: l.code }}>
            {v.code}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-center" style={{ width: `${l.sideMm}mm`, gap: `${l.gapMm}mm` }}>
          {tier !== "none" && (
            <div
              className="flex w-full items-center justify-center overflow-hidden rounded-[1mm] text-center font-extrabold leading-none"
              style={{ height: `${l.sizeBoxMm}mm`, border: "0.4mm solid #000", fontSize: l.tier[tier] }}
            >
              <span data-field="size" className={cn("block leading-[1.2]", tier === "sm" ? "line-clamp-2 break-words px-[0.5mm]" : "whitespace-nowrap")}>{v.size}</span>
            </div>
          )}
          {showQr && (
            <div data-field="qr" style={{ width: `${qrMm}mm`, height: `${qrMm}mm` }}>
              <QrCodeSvg value={v.code} fill />
            </div>
          )}
        </div>
      </div>
      {strip && (
        <div data-field="barcode" className="mx-auto shrink-0" style={{ width: `${strip.widthMm}mm`, height: `${l.stripMm}mm`, marginTop: `${l.gapMm}mm` }}>
          <BarcodeSvg value={v.code} fill displayValue={false} width={1} />
        </div>
      )}
    </div>
  );
}
