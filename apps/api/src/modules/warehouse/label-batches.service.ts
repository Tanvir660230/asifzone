import type { LabelBatchInput, LabelBatchSummary, LabelBatchView } from "@clothing-brand/shared";
import { labelBatchPrintQty } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { LABEL_VARIANT_SELECT, toLabelVariant } from "./warehouse.service";

/**
 * Supplier lists for product stickers (docs/WAREHOUSE_OPERATIONS.md §3): what was ordered from a supplier and what
 * arrived, size by size, so the stickers print from the list instead of being typed again. Labels only — nothing here
 * touches stock, purchase orders or money.
 */

const LINE_INCLUDE = { lines: { include: { variant: { select: LABEL_VARIANT_SELECT } } } } as const;

type BatchRow = Awaited<ReturnType<typeof loadBatch>>;

async function loadBatch(id: string) {
  const b = await prisma.labelBatch.findUnique({ where: { id }, include: LINE_INCLUDE });
  if (!b) throw AppError.notFound("Supplier list not found");
  return b;
}

function totals(lines: Array<{ qtyOrdered: number; qtyReceived: number | null }>) {
  return {
    ordered: lines.reduce((n, l) => n + l.qtyOrdered, 0),
    toPrint: lines.reduce((n, l) => n + labelBatchPrintQty(l), 0),
    received: lines.some((l) => l.qtyReceived != null),
  };
}

function toView(b: NonNullable<BatchRow>): LabelBatchView {
  // Product by product (name), then the variant's own size order — the order a supplier sheet and the stickers follow.
  const lines = [...b.lines]
    .map((l) => ({ variantId: l.variantId, qtyOrdered: l.qtyOrdered, qtyReceived: l.qtyReceived, variant: toLabelVariant(l.variant) }))
    .sort((x, y) => x.variant.productName.localeCompare(y.variant.productName) || x.variant.sortOrder - y.variant.sortOrder || x.variant.sku.localeCompare(y.variant.sku));
  return {
    id: b.id,
    name: b.name,
    supplier: b.supplier,
    notes: b.notes,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    ...totals(b.lines),
    lines,
  };
}

async function assertVariants(lines: LabelBatchInput["lines"]) {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  if (ids.length !== lines.length) throw AppError.badRequest("A product size appears twice in the list");
  const found = await prisma.productVariant.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw AppError.badRequest("Some products in the list don't exist");
}

export async function listLabelBatches(limit = 100): Promise<LabelBatchSummary[]> {
  const rows = await prisma.labelBatch.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    include: { lines: { select: { qtyOrdered: true, qtyReceived: true } } },
  });
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    supplier: b.supplier,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    ...totals(b.lines),
  }));
}

export async function getLabelBatch(id: string): Promise<LabelBatchView> {
  return toView(await loadBatch(id));
}

export async function createLabelBatch(adminId: string | null, input: LabelBatchInput): Promise<LabelBatchView> {
  await assertVariants(input.lines);
  const b = await prisma.labelBatch.create({
    data: {
      name: input.name.trim(),
      supplier: input.supplier?.trim() || null,
      notes: input.notes?.trim() || null,
      createdByAdminId: adminId,
      lines: { create: input.lines.map((l) => ({ variantId: l.variantId, qtyOrdered: l.qtyOrdered, qtyReceived: l.qtyReceived })) },
    },
    include: LINE_INCLUDE,
  });
  return toView(b);
}

/** Saves the whole list: fields and lines are replaced by what was sent (a line left out is removed). */
export async function updateLabelBatch(id: string, input: LabelBatchInput): Promise<LabelBatchView> {
  await loadBatch(id);
  await assertVariants(input.lines);
  await prisma.$transaction([
    prisma.labelBatchLine.deleteMany({ where: { batchId: id } }),
    prisma.labelBatch.update({
      where: { id },
      data: {
        name: input.name.trim(),
        supplier: input.supplier?.trim() || null,
        notes: input.notes?.trim() || null,
        lines: { create: input.lines.map((l) => ({ variantId: l.variantId, qtyOrdered: l.qtyOrdered, qtyReceived: l.qtyReceived })) },
      },
    }),
  ]);
  return getLabelBatch(id);
}

export async function deleteLabelBatch(id: string): Promise<void> {
  await loadBatch(id);
  await prisma.labelBatch.delete({ where: { id } });
}
