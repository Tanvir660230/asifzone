export type LabelTemplateId =
  | "a4-1up"
  | "a4-2up"
  | "a4-4up"
  | "a4-6up"
  | "a4-8up"
  | "sticker-100x150"
  | "sticker-80x50"
  | "sticker-60x40"
  | "sticker-50x30";

export interface LabelTemplate {
  id: LabelTemplateId;
  name: string;
  kind: "a4" | "sticker";
  /** Portrait page size, before any orientation swap. */
  pageWmm: number;
  pageHmm: number;
  /** Portrait grid, before any orientation swap. Always 1x1 for sticker templates — the page IS the label. */
  columns: number;
  rows: number;
  defaultMarginMm: number;
  /** False for sticker templates — rotating a die-cut/roll label is a printer setting, not a layout one. */
  orientationSwappable: boolean;
  /** True for the three cramped sticker sizes that can't fit the full ShippingLabel design even scaled down. */
  compact: boolean;
}

// Gap between cells on an A4 multi-up sheet — matches the spacing already proven out in the old
// CSS grid (globals.css's since-removed `.print-page` rule used 4mm), kept as one constant so every
// A4 template stays visually consistent rather than each one picking its own value.
export const A4_GAP_MM = 4;

export const LABEL_TEMPLATES: LabelTemplate[] = [
  {
    id: "a4-1up",
    name: "A4 — 1 label (full page)",
    kind: "a4",
    pageWmm: 210,
    pageHmm: 297,
    columns: 1,
    rows: 1,
    defaultMarginMm: 10,
    orientationSwappable: true,
    compact: false,
  },
  {
    id: "a4-2up",
    name: "A4 — 2 labels",
    kind: "a4",
    pageWmm: 210,
    pageHmm: 297,
    columns: 1,
    rows: 2,
    defaultMarginMm: 10,
    orientationSwappable: true,
    compact: false,
  },
  {
    id: "a4-4up",
    name: "A4 — 4 labels",
    kind: "a4",
    pageWmm: 210,
    pageHmm: 297,
    columns: 2,
    rows: 2,
    defaultMarginMm: 10,
    orientationSwappable: true,
    compact: false,
  },
  {
    id: "a4-6up",
    name: "A4 — 6 labels (default)",
    kind: "a4",
    pageWmm: 210,
    pageHmm: 297,
    columns: 2,
    rows: 3,
    defaultMarginMm: 10,
    orientationSwappable: true,
    compact: false,
  },
  {
    id: "a4-8up",
    name: "A4 — 8 labels",
    kind: "a4",
    pageWmm: 210,
    pageHmm: 297,
    columns: 2,
    rows: 4,
    defaultMarginMm: 10,
    orientationSwappable: true,
    compact: false,
  },
  {
    id: "sticker-100x150",
    name: "Sticker — 100 × 150mm (4×6\", courier default)",
    kind: "sticker",
    pageWmm: 100,
    pageHmm: 150,
    columns: 1,
    rows: 1,
    defaultMarginMm: 2,
    orientationSwappable: false,
    compact: false,
  },
  {
    id: "sticker-80x50",
    name: "Sticker — 80 × 50mm",
    kind: "sticker",
    pageWmm: 80,
    pageHmm: 50,
    columns: 1,
    rows: 1,
    defaultMarginMm: 1.5,
    orientationSwappable: false,
    compact: true,
  },
  {
    id: "sticker-60x40",
    name: "Sticker — 60 × 40mm",
    kind: "sticker",
    pageWmm: 60,
    pageHmm: 40,
    columns: 1,
    rows: 1,
    defaultMarginMm: 1.5,
    orientationSwappable: false,
    compact: true,
  },
  {
    id: "sticker-50x30",
    name: "Sticker — 50 × 30mm",
    kind: "sticker",
    pageWmm: 50,
    pageHmm: 30,
    columns: 1,
    rows: 1,
    defaultMarginMm: 1,
    orientationSwappable: false,
    compact: true,
  },
];

export const DEFAULT_TEMPLATE_ID: LabelTemplateId = "a4-6up";

export function getTemplate(id: LabelTemplateId): LabelTemplate {
  const template = LABEL_TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error(`Unknown label template: ${id}`);
  return template;
}

export interface ResolvedGeometry {
  /** Page size after orientation swap — what the PDF page/preview sheet is actually sized to. */
  pageWmm: number;
  pageHmm: number;
  /** Grid after orientation swap. */
  columns: number;
  rows: number;
  /** Usable size of a single label cell. */
  cellWmm: number;
  cellHmm: number;
  gapMm: number;
  marginMm: number;
  labelsPerPage: number;
}

/** Turns a template + user-adjustable orientation/margin into exact mm geometry. Every number here
 * is derived, never hardcoded — unlike the old CSS grid (which padded its height with slack to dodge
 * `fr`-unit rounding), PDF placement uses explicit mm coordinates, so there's no rounding tolerance
 * to protect against and the usable area can be computed exactly. */
export function resolveGeometry(template: LabelTemplate, orientation: "portrait" | "landscape", marginMm: number): ResolvedGeometry {
  const swap = template.orientationSwappable && orientation === "landscape";
  const pageWmm = swap ? template.pageHmm : template.pageWmm;
  const pageHmm = swap ? template.pageWmm : template.pageHmm;
  const columns = swap ? template.rows : template.columns;
  const rows = swap ? template.columns : template.rows;
  const gapMm = template.kind === "a4" ? A4_GAP_MM : 0;

  const usableWmm = pageWmm - 2 * marginMm;
  const usableHmm = pageHmm - 2 * marginMm;
  const cellWmm = (usableWmm - gapMm * (columns - 1)) / columns;
  const cellHmm = (usableHmm - gapMm * (rows - 1)) / rows;

  return {
    pageWmm,
    pageHmm,
    columns,
    rows,
    cellWmm,
    cellHmm,
    gapMm,
    marginMm,
    labelsPerPage: columns * rows,
  };
}
