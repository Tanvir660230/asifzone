"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Order, OrderPaymentSummary, StoreSettings } from "@clothing-brand/shared";
import { formatPrice, paymentStatusLabel } from "@/lib/format";
import { siteUrl } from "@/lib/runtime-config";
import { DETAIL_LEVELS, LABEL_RENDER_SCALE, chooseLevel, pickLayout, searchUnit, unitBounds, type DetailLevel, type FitResult } from "@/lib/label-fit";
import { StoreLogoImage } from "@/components/store-logo-image";
import { BarcodeSvg } from "./barcode-svg";
import { QrCodeSvg } from "./qr-code-svg";

type LabelOrder = Order & { payment: OrderPaymentSummary };

/** font-normal / semibold / bold / extrabold — every weight the label below uses. */
const LABEL_FONT_WEIGHTS = [400, 600, 700, 800] as const;

interface LabelCardProps {
  order: LabelOrder;
  store: StoreSettings | undefined;
  /** The label's printable cell, in mm — the page margin is already taken off. */
  wMm: number;
  hMm: number;
  /** One timestamp for the whole batch, printed in the footer. */
  printedAt: Date;
  /** Called once: the fit is settled, fonts are loaded and the barcode is drawn — safe to rasterize. */
  onReady: (fit: FitResult) => void;
}

/**
 * The shipping label, one design for every label size (see lib/label-fit.ts for the engine). Laid out after
 * Steadfast's own label — logo header, full-width barcode with big digits, QR beside an info table, labelled
 * NAME / PHONE / ADDRESS rows, a boxed COD — plus the store's own parts: the courier note and what's in the box.
 *
 * Every size here is in `em` of the base unit the fit search sets on the root, so the whole label scales as one.
 * Nothing truncates: the address, name and note wrap (any long unbroken string breaks anywhere instead of running off
 * the edge), and the fit search guarantees the wrapped result still fits. All text and rules are the darkest ink so a
 * thermal head prints solid black, never a dithered grey.
 */
export function LabelCard({ order, store, wMm, hMm, printedAt, onReady }: LabelCardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const layout = pickLayout(wMm, hMm);
  const bounds = useMemo(() => unitBounds(wMm, hMm), [wMm, hMm]);

  const [fontsReady, setFontsReady] = useState(false);
  const [barcodeReady, setBarcodeReady] = useState(false);
  const [level, setLevel] = useState(0);
  const [fit, setFit] = useState<FitResult | null>(null);
  const bestByLevel = useRef<Array<number | null>>([]);

  // Measure only with the real fonts. `document.fonts.ready` alone isn't enough: a font face (here each Noto Sans
  // Bengali subset and weight) only starts loading once text needs it, so `ready` can resolve before this label's own
  // Bangla glyphs have loaded — the fit then measures the wider fallback font and the captured image (which embeds the
  // real one) lays out differently. Loading every weight the label uses, for this label's own text, closes that gap.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let cancelled = false;
    const family = getComputedStyle(el).fontFamily;
    const text = el.textContent ?? "";
    Promise.all(LABEL_FONT_WEIGHTS.map((weight) => document.fonts.load(`${weight} 16px ${family}`, text)))
      .catch(() => undefined)
      .then(() => document.fonts.ready)
      .then(() => !cancelled && setFontsReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // The search: per level, the largest unit that fits; stop at the first comfortable level, else take the plainest.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || !fontsReady || fit) return;
    const fits = (unit: number) => {
      el.style.fontSize = `${unit * LABEL_RENDER_SCALE}px`;
      return el.scrollHeight <= el.clientHeight + 0.5 && el.scrollWidth <= el.clientWidth + 0.5;
    };
    const best = searchUnit(fits, bounds.min, bounds.max);
    bestByLevel.current[level] = best;
    const last = level === DETAIL_LEVELS.length - 1;
    if ((best != null && best >= bounds.comfortable - 0.01) || last) {
      const result = chooseLevel(bestByLevel.current, bounds);
      if (result.level !== level) {
        setLevel(result.level);
        return;
      }
      el.style.fontSize = `${result.unit * LABEL_RENDER_SCALE}px`;
      setFit(result);
    } else {
      setLevel(level + 1);
    }
  }, [fontsReady, level, fit, bounds]);

  const reported = useRef(false);
  useEffect(() => {
    if (!fit || !barcodeReady || reported.current) return;
    reported.current = true;
    onReady(fit);
  }, [fit, barcodeReady, onReady]);

  const handleBarcodeReady = useCallback(() => setBarcodeReady(true), []);
  const detail = DETAIL_LEVELS[level]!;
  const view = buildView(order, store, printedAt);

  return (
    <div
      ref={rootRef}
      data-fit-level={fit ? fit.level : undefined}
      data-fit-overflow={fit ? String(fit.overflow) : undefined}
      // p-[0.15em]: a glyph's ascent/descent reaches past its line box when line-height is tight — the padding keeps the
      // first and last line's ink inside the cell (and inside the fit check), so a bottom descender is never cut off.
      // geometricPrecision: on screen Chrome hints glyph advances even at the 8× layout size, while the capture draws
      // exact ones — on Linux CI a long Bangla address took 4 lines on screen and 3 in the image. Unhinted advances on
      // screen too, so the layout the fit measures is the one that prints.
      className="flex flex-col overflow-hidden bg-white p-[0.15em] font-sans leading-[1.22] text-ink-900 [overflow-wrap:anywhere] [text-rendering:geometricPrecision] [&>*]:shrink-0"
      style={{ width: `${wMm * LABEL_RENDER_SCALE}mm`, height: `${hMm * LABEL_RENDER_SCALE}mm` }}
    >
      {layout === "stack" ? (
        <StackLabel view={view} detail={detail} onBarcodeReady={handleBarcodeReady} />
      ) : (
        <WideLabel view={view} detail={detail} onBarcodeReady={handleBarcodeReady} />
      )}
    </div>
  );
}

interface LabelView {
  order: LabelOrder;
  store: StoreSettings | undefined;
  booked: boolean;
  barcodeValue: string;
  /** What the QR opens: the courier's tracking page once booked, else this store's own Track order page with the
   * order number filled in (the customer still enters their phone, so nobody else's order shows). */
  qrValue: string;
  cod: number;
  paidCaption: string;
  areaLine: string;
  pieces: number;
  printed: string;
}

function buildView(order: LabelOrder, store: StoreSettings | undefined, printedAt: Date): LabelView {
  const booked = Boolean(order.courierConsignmentId);
  const timeZone = store?.timezone || undefined;
  return {
    order,
    store,
    booked,
    barcodeValue: booked && order.trackingNumber ? order.trackingNumber : order.orderNumber,
    qrValue: order.courierTrackingLink || `${siteUrl()}/track-order?order=${encodeURIComponent(order.orderNumber)}`,
    cod: order.payment.codToCollect,
    paidCaption:
      order.paymentMethod === "COD" ? "Paid — collect nothing" : order.paymentStatus === "PAID" ? "Paid online — collect nothing" : `Online — ${paymentStatusLabel(order.paymentStatus)}`,
    areaLine: [order.shippingArea, order.shippingDistrict, order.shippingDivision].filter(Boolean).join(", "),
    pieces: order.items.reduce((sum, item) => sum + item.quantity, 0),
    printed: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "numeric", minute: "2-digit", hour12: true, timeZone }).format(printedAt),
  };
}

/** The QR's side in em: its full size, or ~80% of it once the fit engine trades QR size for text. */
function qrEm(detail: DetailLevel, full: number): number {
  return detail.qr === "small" ? Math.round(full * 0.8 * 10) / 10 : full;
}

interface PartProps {
  view: LabelView;
  detail: DetailLevel;
  onBarcodeReady: () => void;
}

/** Portrait and square labels (2×3", 3×3", 4×6", A4 4-up/6-up/1-up). */
function StackLabel({ view, detail, onBarcodeReady }: PartProps) {
  const { order } = view;
  return (
    <>
      <Header view={view} logoEm={detail.logo ? 2.5 : 0} />
      <Barcode view={view} heightEm={detail.slimBarcode ? 2.5 : 3.3} digitsEm={1.12} onReady={onBarcodeReady} className="mt-[0.45em]" />

      <div className="mt-[0.5em] grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-[0.6em] gap-y-[0.12em] border-t-[0.09em] border-ink-900 pt-[0.45em]">
        <FieldLabel>Name</FieldLabel>
        <p lang="bn" className="text-[1.3em] font-bold leading-[1.15]">{order.customerName}</p>
        <FieldLabel>Phone</FieldLabel>
        <p className="whitespace-nowrap text-[1.3em] font-bold leading-[1.15] tabular-nums">{order.customerPhone}</p>
        <FieldLabel>Address</FieldLabel>
        <p lang="bn" className="text-[1.04em] font-bold leading-[1.28]">
          {order.shippingAddressLine}
          {view.areaLine && <span className="block font-semibold">{view.areaLine}</span>}
        </p>
      </div>

      {/* Payment with the QR beside it — the owner's layout: no order/parcel/date table; name, phone and address keep
          the label's full width (a phone number must never break across lines). */}
      <div className="mt-[0.55em] flex items-stretch gap-[0.6em]">
        <Payment view={view} className="min-w-0 flex-1 justify-center" amountEm={1.9} stacked />
        <QrBox view={view} sideEm={qrEm(detail, 5.4)} />
      </div>
      <CourierNote order={order} className="mt-[0.45em] text-[0.95em]" />
      <Items view={view} detail={detail} className="mt-[0.5em]" />

      <div className="min-h-0 flex-1" aria-hidden />
      {detail.footer && <Footer view={view} />}
    </>
  );
}

/** Landscape labels (80×50, 60×40, 50×30, A4 8-up and 2-up): address and payment side by side, barcode full width. */
function WideLabel({ view, detail, onBarcodeReady }: PartProps) {
  const { order } = view;
  return (
    <>
      <Header view={view} logoEm={detail.logo ? 1.9 : 0} />
      <div className="mt-[0.35em] flex gap-[0.6em]">
        <div className="min-w-0 flex-1">
          <p lang="bn" className="text-[1.2em] font-bold leading-[1.15]">{order.customerName}</p>
          <p className="whitespace-nowrap text-[1.15em] font-bold leading-[1.15] tabular-nums">{order.customerPhone}</p>
          <p lang="bn" className="mt-[0.15em] text-[0.95em] font-bold leading-[1.25]">
            {order.shippingAddressLine}
            {view.areaLine && <span className="block font-semibold">{view.areaLine}</span>}
          </p>
          <CourierNote order={order} className="mt-[0.3em] text-[0.88em]" />
        </div>
        <div className="flex w-[38%] shrink-0 flex-col gap-[0.35em]">
          <Payment view={view} amountEm={1.45} stacked caption="COD" />
          <QrBox view={view} sideEm={qrEm(detail, 4.6)} className="self-center" />
        </div>
      </div>
      <Items view={view} detail={detail} className="mt-[0.35em]" />
      <div className="min-h-0 flex-1" aria-hidden />
      <Barcode view={view} heightEm={detail.slimBarcode ? 2 : 2.6} digitsEm={0.95} onReady={onBarcodeReady} className="mt-[0.3em]" />
      {detail.footer && <Footer view={view} />}
    </>
  );
}

/** Logo (or wordmark) left, the store's phone right. `logoEm` 0 = the fit engine dropped the logo image: the wordmark
 * takes its place. */
function Header({ view, logoEm }: { view: LabelView; logoEm: number }) {
  const { store } = view;
  const name = store?.storeName ?? "Store";
  const wordmark = <span className="text-[1.25em] font-bold leading-none">{name}</span>;
  const right = store?.contactPhone;
  return (
    <div className="flex items-center justify-between gap-[0.6em] border-b-[0.12em] border-ink-900 pb-[0.35em]">
      {store?.logoUrl && logoEm > 0 ? (
        <>
          <StoreLogoImage src={store.logoUrl} alt={name} className="shrink-0 [&_img]:object-left" style={{ height: `${logoEm}em`, width: `${logoEm * 2.4}em` }} fallback={wordmark} />
          {/* The logo artwork already carries the store name, so only the phone sits beside it. */}
          {right && <p className="whitespace-nowrap text-right text-[0.9em] font-semibold tabular-nums">{right}</p>}
        </>
      ) : (
        <>
          {wordmark}
          {right && <span className="whitespace-nowrap text-[0.8em] font-semibold tabular-nums">{right}</span>}
        </>
      )}
    </div>
  );
}

function Barcode({ view, heightEm, digitsEm, onReady, className }: { view: LabelView; heightEm: number; digitsEm: number; onReady: () => void; className: string }) {
  return (
    <div className={className}>
      <div style={{ height: `${heightEm}em` }}>
        <BarcodeSvg value={view.barcodeValue} height={60} width={2} onReady={onReady} fill />
      </div>
      <p className="mt-[0.15em] text-center font-bold leading-none tracking-[0.16em] tabular-nums" style={{ fontSize: `${digitsEm}em` }}>
        {view.barcodeValue}
      </p>
    </div>
  );
}

/** The QR, on every label: the courier's tracking page, or the store's own Track order page before booking. */
function QrBox({ view, sideEm, className = "" }: { view: LabelView; sideEm: number; className?: string }) {
  return (
    <div data-label-qr className={`shrink-0 ${className}`} style={{ width: `${sideEm}em`, height: `${sideEm}em` }}>
      <QrCodeSvg value={view.qrValue} size={128} fill />
    </div>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <span className="text-[0.7em] font-semibold uppercase tracking-[0.1em]">{children}</span>;
}

/** The amount to collect, boxed. `stacked`: caption over the amount (beside the QR, or in a wide label's narrow column,
 * where `caption` is the short "COD"). */
function Payment({ view, className = "", amountEm, stacked = false, caption = "Cash on delivery" }: { view: LabelView; className?: string; amountEm: number; stacked?: boolean; caption?: string }) {
  if (view.cod > 0) {
    return (
      <div className={`flex border-[0.14em] border-ink-900 px-[0.55em] py-[0.28em] ${stacked ? "flex-col gap-[0.15em]" : "items-center justify-between gap-[0.5em]"} ${className}`}>
        <span className="text-[0.8em] font-bold uppercase leading-tight tracking-[0.12em]">{caption}</span>
        <span className="whitespace-nowrap font-extrabold leading-none tabular-nums" style={{ fontSize: `${amountEm}em` }}>
          {formatPrice(view.cod)}
        </span>
      </div>
    );
  }
  return (
    <div className={`flex flex-col border-[0.09em] border-ink-900 px-[0.55em] py-[0.3em] text-[0.95em] font-bold leading-tight ${className}`}>{view.paidCaption}</div>
  );
}

function CourierNote({ order, className }: { order: LabelOrder; className: string }) {
  if (!order.courierNoteForLabel) return null;
  return (
    <p lang="bn" className={`border-l-[0.3em] border-ink-900 pl-[0.5em] font-bold leading-[1.28] ${className}`}>
      {order.courierNoteForLabel}
    </p>
  );
}

function Items({ view, detail, className }: { view: LabelView; detail: DetailLevel; className: string }) {
  const { items } = view.order;
  if (items.length === 0) return null;
  const count = `${items.length} item${items.length === 1 ? "" : "s"} · ${view.pieces} pc${view.pieces === 1 ? "" : "s"}`;
  if (detail.items === "summary") {
    return <p className={`text-[0.82em] font-semibold ${className}`}>In this parcel: {count}</p>;
  }
  if (detail.items === "inline") {
    return (
      <p lang="bn" className={`text-[0.8em] leading-[1.25] ${className}`}>
        <span className="font-semibold uppercase tracking-[0.06em]">{count}: </span>
        {items.map((item, i) => {
          const variant = [item.sizeSnapshot, item.colorSnapshot].filter(Boolean).join(", ");
          return (
            <span key={item.id}>
              {i > 0 && "; "}
              <span className="font-bold tabular-nums">{item.quantity}×</span> {item.productNameSnapshot}
              {variant && <span className="font-semibold"> · {variant}</span>}
            </span>
          );
        })}
      </p>
    );
  }
  const shown = items.slice(0, detail.items);
  const more = items.length - shown.length;
  return (
    <div className={className}>
      <p className="border-b-[0.07em] border-ink-900 pb-[0.12em] text-[0.7em] font-semibold uppercase tracking-[0.1em]">In this parcel · {count}</p>
      <ul className="mt-[0.15em] space-y-[0.08em] text-[0.86em] leading-[1.22]">
        {shown.map((item) => {
          const variant = [item.sizeSnapshot, item.colorSnapshot].filter(Boolean).join(", ");
          return (
            <li key={item.id} lang="bn">
              <span className="font-bold tabular-nums">{item.quantity}×</span> {item.productNameSnapshot}
              {variant && <span className="font-semibold"> · {variant}</span>}
            </li>
          );
        })}
        {more > 0 && <li className="font-semibold">+{more} more item{more === 1 ? "" : "s"}</li>}
      </ul>
    </div>
  );
}

function Footer({ view }: { view: LabelView }) {
  return (
    <div className="mt-[0.4em] flex justify-between gap-[0.5em] border-t-[0.08em] border-ink-900 pt-[0.28em] text-[0.68em] leading-tight">
      <span>Printed {view.printed}</span>
      <span className="font-semibold">{view.store?.storeName}</span>
    </div>
  );
}
