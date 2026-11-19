"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Order, OrderPaymentSummary, StoreSettings } from "@clothing-brand/shared";
import { formatPrice, paymentStatusLabel } from "@/lib/format";
import { DETAIL_LEVELS, LABEL_RENDER_SCALE, chooseLevel, isLargeSticker, pickLayout, searchUnit, unitBounds, type DetailLevel, type FitResult } from "@/lib/label-fit";
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
      {isLargeSticker(wMm, hMm) ? (
        layout === "stack" ? (
          <LargeTallLabel view={view} detail={detail} onBarcodeReady={handleBarcodeReady} />
        ) : (
          <LargeWideLabel view={view} detail={detail} onBarcodeReady={handleBarcodeReady} />
        )
      ) : layout === "stack" ? (
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
  cod: number;
  paidCaption: string;
  areaLine: string;
  pieces: number;
  printed: string;
  date: string;
}

function buildView(order: LabelOrder, store: StoreSettings | undefined, printedAt: Date): LabelView {
  const booked = Boolean(order.courierConsignmentId);
  const timeZone = store?.timezone || undefined;
  const stamp = (d: Date, withTime: boolean) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
      ...(withTime ? { hour: "numeric", minute: "2-digit", hour12: true } : {}),
      timeZone,
    }).format(d);
  return {
    order,
    store,
    booked,
    barcodeValue: booked && order.trackingNumber ? order.trackingNumber : order.orderNumber,
    cod: order.payment.codToCollect,
    paidCaption:
      order.paymentMethod === "COD" ? "Paid — collect nothing" : order.paymentStatus === "PAID" ? "Paid online — collect nothing" : `Online — ${paymentStatusLabel(order.paymentStatus)}`,
    areaLine: [order.shippingArea, order.shippingDistrict, order.shippingDivision].filter(Boolean).join(", "),
    pieces: order.items.reduce((sum, item) => sum + item.quantity, 0),
    printed: stamp(printedAt, true),
    date: stamp(new Date(order.courierBookedAt ?? order.createdAt), false),
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

      {detail.infoTable ? (
        <div className="mt-[0.4em] flex border-y-[0.09em] border-ink-900 py-[0.35em]">
          {detail.qr !== "none" && order.courierTrackingLink && (
            <div
              className="mr-[0.45em] shrink-0 border-r-[0.09em] border-ink-900 pr-[0.45em]"
              style={{ width: `${qrEm(detail, 5.4)}em`, height: `${qrEm(detail, 5.4)}em` }}
            >
              <QrCodeSvg value={order.courierTrackingLink} size={128} fill />
            </div>
          )}
          <InfoTable view={view} />
        </div>
      ) : (
        <CompactInfo view={view} className="mt-[0.4em] border-y-[0.09em] border-ink-900 py-[0.25em]" />
      )}

      <div className="mt-[0.5em] grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-[0.6em] gap-y-[0.12em]">
        <FieldLabel>Name</FieldLabel>
        <p lang="bn" className="text-[1.3em] font-bold leading-[1.15]">{order.customerName}</p>
        <FieldLabel>Phone</FieldLabel>
        <p className="text-[1.3em] font-bold leading-[1.15] tabular-nums">{order.customerPhone}</p>
        <FieldLabel>Address</FieldLabel>
        <p lang="bn" className="text-[1.04em] font-bold leading-[1.28]">
          {order.shippingAddressLine}
          {view.areaLine && <span className="block font-semibold">{view.areaLine}</span>}
        </p>
      </div>

      <Payment view={view} className="mt-[0.55em]" amountEm={1.75} />
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
      <Header view={view} logoEm={detail.logo ? 1.9 : 0} rightText={order.orderNumber} />
      <div className="mt-[0.35em] flex gap-[0.6em]">
        <div className="min-w-0 flex-1">
          <p lang="bn" className="text-[1.2em] font-bold leading-[1.15]">{order.customerName}</p>
          <p className="text-[1.15em] font-bold leading-[1.15] tabular-nums">{order.customerPhone}</p>
          <p lang="bn" className="mt-[0.15em] text-[0.95em] font-bold leading-[1.25]">
            {order.shippingAddressLine}
            {view.areaLine && <span className="block font-semibold">{view.areaLine}</span>}
          </p>
          <CourierNote order={order} className="mt-[0.3em] text-[0.88em]" />
        </div>
        <div className="flex w-[38%] shrink-0 flex-col gap-[0.35em]">
          <Payment view={view} amountEm={1.6} caption="COD" />
          {detail.qr !== "none" && order.courierTrackingLink && (
            <div className="self-center" style={{ width: `${qrEm(detail, 4.6)}em`, height: `${qrEm(detail, 4.6)}em` }}>
              <QrCodeSvg value={order.courierTrackingLink} size={128} fill />
            </div>
          )}
          {/* Centred like the QR above it, so the column reads as one block. */}
          {detail.infoTable && <CompactInfo view={view} stacked hideOrder className="items-center" />}
        </div>
      </div>
      <Items view={view} detail={detail} className="mt-[0.35em]" />
      <div className="min-h-0 flex-1" aria-hidden />
      <Barcode view={view} heightEm={detail.slimBarcode ? 2 : 2.6} digitsEm={0.95} onReady={onBarcodeReady} className="mt-[0.3em]" />
      {detail.footer && <Footer view={view} />}
    </>
  );
}

/* ───────────── Large courier sticker (75×100 portrait, 100×75 wide) — the "Panels" design ─────────────
 * Owner-picked (2026-11-19, direction A of the label mockups): each job sits in its own thin rounded panel — "Deliver to"
 * for the rider (name, phone, address, and the thana · district as a tag), "Collect · COD" beside the parcel QR, then the
 * courier note, the items with qty badges, and the barcode with blank space either side for the scanner. Black ink only,
 * thin rules, no solid blocks except the small thana tag. Every size is in em, so the fit engine scales and trims it like
 * every other label. */

/** Thana first, then district — the owner's order; the division isn't needed on a parcel. */
function thanaDistrict(order: LabelOrder): { thana: string | null; district: string | null } {
  const thana = order.shippingArea?.trim() || null;
  const district = order.shippingDistrict?.trim() || null;
  return { thana, district: district && district !== thana ? district : null };
}

const PANEL = "rounded-[0.6em] border-[0.1em] border-ink-900";

/** Line icons (stroke only, so a thermal head prints a clean outline). */
function Icon({ name, className = "" }: { name: "user" | "phone" | "pin" | "alert"; className?: string }) {
  const paths = {
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
    pin: (
      <>
        <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
        <circle cx="12" cy="9.5" r="2.5" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3l9.5 17h-19z" />
        <path d="M12 10v4M12 17.5v.01" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`h-[1em] w-[1em] shrink-0 ${className}`}>
      {paths[name]}
    </svg>
  );
}

/** A Bangladeshi mobile number as 01XXX XXXXXX — the way people read it out — with a gap, not a character, between the
 * groups, so the digits stay exactly as typed. Anything else prints as is. */
function PhoneDigits({ phone }: { phone: string }) {
  const m = /^(\+?88)?(01\d{3})(\d{6})$/.exec(phone.replace(/[\s-]/g, ""));
  if (!m) return <>{phone}</>;
  return (
    <>
      {m[1] && <span className="mr-[0.3em]">{m[1]}</span>}
      <span className="mr-[0.32em]">{m[2]}</span>
      {m[3]}
    </>
  );
}

/** Small uppercase caption. */
function Caption({ children, className = "" }: { children: string; className?: string }) {
  return <p className={`text-[0.6em] font-bold uppercase leading-none tracking-[0.16em] ${className}`}>{children}</p>;
}

/** Logo left; courier pill + order number right. */
function LargeHeader({ view, detail }: { view: LabelView; detail: DetailLevel }) {
  const { store, order } = view;
  const name = store?.storeName ?? "Store";
  const wordmark = <span className="text-[1.3em] font-extrabold uppercase leading-none tracking-[0.06em]">{name}</span>;
  return (
    <div className="flex items-center justify-between gap-[0.8em]">
      {store?.logoUrl && detail.logo ? (
        <StoreLogoImage src={store.logoUrl} alt={name} className="shrink-0 [&_img]:object-left" style={{ height: "2.4em", width: "6.5em" }} fallback={wordmark} />
      ) : (
        wordmark
      )}
      <div className="flex flex-col items-end leading-[1.1]">
        {order.carrier && (
          <span className="rounded-full border-[0.1em] border-ink-900 px-[0.6em] py-[0.08em] text-[0.6em] font-bold uppercase tracking-[0.14em]">{order.carrier}</span>
        )}
        <p className={`${order.carrier ? "mt-[0.2em]" : ""} whitespace-nowrap text-[1em] font-extrabold tabular-nums`}>{order.orderNumber}</p>
      </div>
    </div>
  );
}

function DeliverTo({ view, className = "" }: { view: LabelView; className?: string }) {
  const { order } = view;
  const { thana, district } = thanaDistrict(order);
  return (
    // One icon column, one text column: the caption, name, phone, address and area tag all start on the same line, and
    // each icon is centred on the first line of its row (the cell's height = that row's first line box, in base em).
    <div className={`${PANEL} grid grid-cols-[1em_minmax(0,1fr)] gap-x-[0.5em] px-[0.7em] pb-[0.65em] pt-[0.6em] ${className}`}>
      <span aria-hidden />
      <Caption>Deliver to</Caption>

      <span className="mt-[0.35em] flex h-[1.57em] items-center">
        <Icon name="user" />
      </span>
      <p lang="bn" className="mt-[0.35em] text-[1.4em] font-extrabold leading-[1.12]">{order.customerName}</p>

      <span className="mt-[0.2em] flex h-[1.43em] items-center">
        <Icon name="phone" />
      </span>
      <p className="mt-[0.2em] whitespace-nowrap text-[1.3em] font-extrabold leading-[1.1] tracking-[0.02em] tabular-nums">
        <PhoneDigits phone={order.customerPhone} />
      </p>

      <span className="mt-[0.3em] flex h-[1.29em] items-center">
        <Icon name="pin" />
      </span>
      <p lang="bn" className="mt-[0.3em] text-[0.98em] font-bold leading-[1.32]">{order.shippingAddressLine}</p>

      {(thana || district) && (
        <>
          <span aria-hidden />
          {/* Thana first, then district, in a thin outlined tag (owner: no black fill). */}
          <p className="mt-[0.45em] flex w-fit max-w-full items-center rounded-[0.4em] border-[0.1em] border-ink-900 px-[0.55em] py-[0.12em] text-[0.82em] uppercase leading-[1.25] tracking-[0.08em]">
            {thana && <span className="font-extrabold">{thana}</span>}
            {thana && district && <span aria-hidden className="mx-[0.5em] h-[0.9em] w-[0.1em] shrink-0 bg-ink-900" />}
            {district && <span className="font-semibold">{district}</span>}
          </p>
        </>
      )}
    </div>
  );
}

/** The amount to collect in its own panel. Paid orders: PAID / Collect nothing; a pending online payment never reads PAID. */
function LargeCod({ view, amountEm, className = "" }: { view: LabelView; amountEm: number; className?: string }) {
  const frame = `flex flex-col justify-center ${PANEL} px-[0.7em] py-[0.5em] ${className}`;
  if (view.cod > 0) {
    return (
      <div className={frame}>
        <Caption>Collect · COD</Caption>
        <span className="mt-[0.3em] whitespace-nowrap font-extrabold leading-none tracking-[-0.01em] tabular-nums" style={{ fontSize: `${amountEm}em` }}>
          {formatPrice(view.cod)}
        </span>
      </div>
    );
  }
  const settled = view.order.paymentMethod === "COD" || view.order.paymentStatus === "PAID";
  return (
    <div className={frame}>
      <Caption>Payment</Caption>
      <span className="mt-[0.3em] font-extrabold uppercase leading-none tracking-[0.04em]" style={{ fontSize: `${amountEm * 0.75}em` }}>
        {settled ? "Paid" : "Online"}
      </span>
      <span className="mt-[0.25em] text-[0.78em] font-semibold leading-tight">{settled ? "Collect nothing" : view.paidCaption}</span>
    </div>
  );
}

/** QR (booked orders) with the parcel id and the date beside it. */
function ParcelBox({ view, detail, qrEm: full, className = "" }: { view: LabelView; detail: DetailLevel; qrEm: number; className?: string }) {
  const { order } = view;
  const showQr = detail.qr !== "none" && order.courierTrackingLink;
  return (
    <div className={`flex items-center gap-[0.5em] ${className}`}>
      {showQr && (
        <div className="shrink-0" style={{ width: `${qrEm(detail, full)}em`, height: `${qrEm(detail, full)}em` }}>
          <QrCodeSvg value={order.courierTrackingLink!} size={128} fill />
        </div>
      )}
      <div className="text-[0.8em] font-bold leading-[1.3] tabular-nums">
        {order.courierConsignmentId ? (
          <>
            <p className="font-semibold">Parcel</p>
            <p className="whitespace-nowrap">{order.courierConsignmentId}</p>
          </>
        ) : (
          <p className="whitespace-nowrap">Not booked yet</p>
        )}
        {detail.infoTable && <p className="mt-[0.15em] whitespace-nowrap text-[0.78em] font-bold uppercase tracking-[0.14em]">{view.date}</p>}
      </div>
    </div>
  );
}

function LargeNote({ order, className = "" }: { order: LabelOrder; className?: string }) {
  if (!order.courierNoteForLabel) return null;
  return (
    <p lang="bn" className={`grid grid-cols-[1.09em_minmax(0,1fr)] gap-x-[0.54em] px-[0.87em] text-[0.92em] font-bold leading-[1.28] ${className}`}>
      <span className="flex h-[1.28em] items-center">
        <Icon name="alert" />
      </span>
      <span className="min-w-0">{order.courierNoteForLabel}</span>
    </p>
  );
}

/** How many pieces of this product, big and boxed so the packer reads it at a glance (owner: "koy pc" bigger). */
function QtyBadge({ qty }: { qty: number }) {
  return (
    // One inline run inside a centred box: the number and "pc" share a text baseline, the box centres the run.
    <span className="inline-flex h-[1.5em] min-w-[2.6em] items-center justify-center rounded-[0.4em] border-[0.12em] border-ink-900 px-[0.3em] leading-none tabular-nums">
      <span className="whitespace-nowrap">
        <span className="text-[1.1em] font-extrabold">{qty}</span>
        <span className="ml-[0.12em] text-[0.7em] font-bold">pc</span>
      </span>
    </span>
  );
}

function LargeItems({ view, detail, className = "", twoColumns = false }: { view: LabelView; detail: DetailLevel; className?: string; twoColumns?: boolean }) {
  const { items } = view.order;
  if (items.length === 0) return null;
  const variantOf = (item: (typeof items)[number]) => [item.sizeSnapshot, item.colorSnapshot].filter(Boolean).join(", ");
  // Total pieces big on the right (the number the packer counts), the product count small beside it.
  const head = (
    <div className="flex items-baseline justify-between border-b-[0.08em] border-ink-900 pb-[0.25em]">
      <Caption>In this parcel</Caption>
      <p className="whitespace-nowrap leading-none">
        <span className="text-[0.66em] font-bold uppercase tracking-[0.12em]">
          {items.length} item{items.length === 1 ? "" : "s"} ·{" "}
        </span>
        <span className="text-[1.05em] font-extrabold tabular-nums">{view.pieces}</span>
        <span className="text-[0.72em] font-bold"> pc{view.pieces === 1 ? "" : "s"}</span>
      </p>
    </div>
  );
  if (detail.items === "summary") return <div className={className}>{head}</div>;
  if (detail.items === "inline") {
    return (
      <div className={className}>
        {head}
        <p lang="bn" className="mt-[0.3em] text-[0.86em] leading-[1.3]">
          {items.map((item, i) => {
            const variant = variantOf(item);
            return (
              <span key={item.id}>
                {i > 0 && <span className="font-bold"> / </span>}
                <span className="text-[1.15em] font-extrabold tabular-nums">{item.quantity} pc</span> {item.productNameSnapshot}
                {variant && <span className="font-bold"> · {variant}</span>}
              </span>
            );
          })}
        </p>
      </div>
    );
  }
  const shown = items.slice(0, detail.items);
  const more = items.length - shown.length;
  const cols = twoColumns && shown.length > 4 ? "grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]" : "grid-cols-[auto_minmax(0,1fr)]";
  return (
    <div className={className}>
      {head}
      <div className={`mt-[0.35em] grid ${cols} items-start gap-x-[0.5em] gap-y-[0.22em] text-[0.9em] leading-[1.24]`}>
        {shown.map((item) => {
          const variant = variantOf(item);
          return (
            <div key={item.id} className="contents">
              <QtyBadge qty={item.quantity} />
              <span lang="bn" className="pt-[0.14em]">
                {item.productNameSnapshot}
                {variant && <span className="font-bold"> · {variant}</span>}
              </span>
            </div>
          );
        })}
        {more > 0 && <span className="col-span-full font-semibold">+{more} more item{more === 1 ? "" : "s"}</span>}
      </div>
    </div>
  );
}

/** The barcode with blank space either side (scanners want a quiet zone of ~10 bar widths). */
function LargeBarcode({ view, heightEm, onReady, className }: { view: LabelView; heightEm: number; onReady: () => void; className: string }) {
  return <Barcode view={view} heightEm={heightEm} digitsEm={0.95} onReady={onReady} className={`px-[7%] ${className}`} />;
}

/** 75×100 portrait: header, Deliver to, COD panel beside the QR, note, items, barcode. */
function LargeTallLabel({ view, detail, onBarcodeReady }: PartProps) {
  return (
    <>
      <LargeHeader view={view} detail={detail} />
      <DeliverTo view={view} className="mt-[0.6em]" />
      <div className="mt-[0.6em] flex items-stretch gap-[0.6em]">
        <LargeCod view={view} amountEm={2.2} className="min-w-0 flex-1" />
        <ParcelBox view={view} detail={detail} qrEm={4.8} className="shrink-0" />
      </div>
      <LargeNote order={view.order} className="mt-[0.6em]" />
      <LargeItems view={view} detail={detail} className="mt-[0.6em] px-[0.8em]" />
      <div className="min-h-0 flex-1" aria-hidden />
      <LargeBarcode view={view} heightEm={detail.slimBarcode ? 2.6 : 3.3} onReady={onBarcodeReady} className="mt-[0.5em]" />
    </>
  );
}

/** 100×75 wide: header; Deliver to left, COD panel + QR right; note and items full width; barcode along the bottom. */
function LargeWideLabel({ view, detail, onBarcodeReady }: PartProps) {
  return (
    <>
      <LargeHeader view={view} detail={detail} />
      <div className="mt-[0.55em] flex gap-[0.6em]">
        <DeliverTo view={view} className="min-w-0 flex-1" />
        <div className="flex w-[35%] shrink-0 flex-col gap-[0.5em]">
          <LargeCod view={view} amountEm={2.1} />
          <ParcelBox view={view} detail={detail} qrEm={4.4} className="px-[0.8em]" />
        </div>
      </div>
      <LargeNote order={view.order} className="mt-[0.5em]" />
      <LargeItems view={view} detail={detail} twoColumns className="mt-[0.5em] px-[0.8em]" />
      <div className="min-h-0 flex-1" aria-hidden />
      <LargeBarcode view={view} heightEm={detail.slimBarcode ? 2.2 : 2.8} onReady={onBarcodeReady} className="mt-[0.45em]" />
    </>
  );
}

/** Logo (or wordmark) left; right: the store's phone — or, on wide labels, the order number (it has no info table
 * row there once space runs out, and the courier asks for it more than the shop's number). `logoEm` 0 = the fit
 * engine dropped the logo image: the wordmark takes its place. */
function Header({ view, logoEm, rightText }: { view: LabelView; logoEm: number; rightText?: string }) {
  const { store } = view;
  const name = store?.storeName ?? "Store";
  const wordmark = <span className="text-[1.25em] font-bold leading-none">{name}</span>;
  const right = rightText ?? store?.contactPhone;
  return (
    <div className="flex items-center justify-between gap-[0.6em] border-b-[0.12em] border-ink-900 pb-[0.35em]">
      {store?.logoUrl && logoEm > 0 ? (
        <>
          <StoreLogoImage src={store.logoUrl} alt={name} className="shrink-0 [&_img]:object-left" style={{ height: `${logoEm}em`, width: `${logoEm * 2.4}em` }} fallback={wordmark} />
          {/* The logo artwork already carries the store name, so only the phone (or order number) sits beside it. */}
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

function InfoTable({ view }: { view: LabelView }) {
  const { order } = view;
  const rows: Array<[string, string]> = [
    ["Parcel", order.courierConsignmentId ?? "Not booked yet"],
    ...(order.carrier ? ([["Courier", order.carrier]] as Array<[string, string]>) : []),
    ["Date", view.date],
  ];
  // No flex-wrap and no auto margins anywhere in here: the capture freezes every computed size (auto margins included)
  // as px, so a row that "just fit" on screen could tip onto two lines in the image (measured: the date dropped onto
  // the rule below). A fixed grid has no wrap decision to re-make. The order number — the longest value, and one that
  // must never break — sits on its own line under its label.
  return (
    <dl className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] content-center gap-x-[0.5em] gap-y-[0.16em] text-[0.84em] leading-tight">
      <dt className="col-span-2 text-[0.86em] font-semibold uppercase tracking-[0.08em]">Order</dt>
      <dd className="col-span-2 whitespace-nowrap text-right font-bold tabular-nums">{order.orderNumber}</dd>
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[0.86em] font-semibold uppercase tracking-[0.08em]">{label}</dt>
          <dd className="whitespace-nowrap text-right font-bold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CompactInfo({ view, className = "", stacked = false, hideOrder = false }: { view: LabelView; className?: string; stacked?: boolean; hideOrder?: boolean }) {
  const { order } = view;
  const parcel = order.courierConsignmentId ? `Parcel ${order.courierConsignmentId}` : "Not booked yet";
  return (
    // No flex-wrap (see InfoTable): side by side, or stacked — decided by the layout, never by a wrap at capture time.
    <div className={`${stacked ? "flex flex-col" : "flex justify-between gap-x-[0.6em]"} text-[0.8em] font-bold leading-tight tabular-nums ${className}`}>
      {!hideOrder && <span className="whitespace-nowrap">{order.orderNumber}</span>}
      <span className="whitespace-nowrap">{parcel}</span>
    </div>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <span className="text-[0.7em] font-semibold uppercase tracking-[0.1em]">{children}</span>;
}

/** The amount to collect, boxed: caption left, amount right on one line. `caption` is the short "COD" in a wide label's
 * narrow column. */
function Payment({ view, className = "", amountEm, caption = "Cash on delivery" }: { view: LabelView; className?: string; amountEm: number; caption?: string }) {
  if (view.cod > 0) {
    return (
      <div className={`flex items-center justify-between gap-[0.5em] border-[0.14em] border-ink-900 px-[0.55em] py-[0.28em] ${className}`}>
        <span className="text-[0.8em] font-bold uppercase leading-tight tracking-[0.12em]">{caption}</span>
        <span className="whitespace-nowrap font-extrabold leading-none tabular-nums" style={{ fontSize: `${amountEm}em` }}>
          {formatPrice(view.cod)}
        </span>
      </div>
    );
  }
  return (
    <div className={`border-[0.09em] border-ink-900 px-[0.55em] py-[0.3em] text-[0.95em] font-bold leading-tight ${className}`}>{view.paidCaption}</div>
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
