import type { Prisma } from "@prisma/client";
import {
  isEmptyOverride,
  resolveSections,
  type SectionLayer,
  type SectionOverrideInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { invalidateProductCache } from "../products/product.cache";

/** A stored override row, whichever level (global / template / product) it belongs to. */
export interface SectionRow {
  sectionKey: string;
  enabled: boolean | null;
  sortOrder: number | null;
  title: string | null;
  content: string | null;
}

export const layerFromRows = (rows: SectionRow[] | undefined): SectionLayer =>
  Object.fromEntries((rows ?? []).map((r) => [r.sectionKey, { enabled: r.enabled, sortOrder: r.sortOrder, title: r.title, content: r.content }]));

export const overridesFromRows = (rows: SectionRow[] | undefined) =>
  (rows ?? []).map((r) => ({ sectionKey: r.sectionKey, enabled: r.enabled, sortOrder: r.sortOrder, title: r.title, content: r.content }));

/** Normalises an incoming override to the stored shape; blank strings mean "inherit", not "empty". */
const toStored = (o: SectionOverrideInput) => ({
  enabled: o.enabled ?? null,
  sortOrder: o.sortOrder ?? null,
  title: o.title?.trim() ? o.title.trim() : null,
  content: o.content && o.content.trim() ? o.content : null,
});

/** Only rows that actually override something are kept: an all-blank row is the same as no row, and storing it
 * would just make the table look busier than the admin's choices are. */
function keepers(rows: SectionOverrideInput[]) {
  return rows.map((r) => ({ key: r.sectionKey, ...toStored(r) })).filter((r) => !isEmptyOverride(r));
}

export function loadGlobalRows() {
  return prisma.globalSection.findMany();
}

/** The store-wide layer plus the fully resolved list it produces (what the settings page shows). */
export async function getGlobalSections() {
  const rows = await loadGlobalRows();
  return { overrides: overridesFromRows(rows), resolved: resolveSections({ global: layerFromRows(rows) }) };
}

/** Replaces the whole global layer: sections not sent go back to their defaults. */
export async function saveGlobalSections(rows: SectionOverrideInput[]) {
  const next = keepers(rows);
  await prisma.$transaction(async (tx) => {
    await tx.globalSection.deleteMany({ where: { sectionKey: { notIn: next.map((r) => r.key) } } });
    for (const { key, ...data } of next) {
      await tx.globalSection.upsert({ where: { sectionKey: key }, update: data, create: { sectionKey: key, ...data } });
    }
  });
  await invalidateProductCache();
  return getGlobalSections();
}

export async function saveTemplateSections(tx: Prisma.TransactionClient, templateId: string, rows: SectionOverrideInput[]) {
  const next = keepers(rows);
  await tx.templateSection.deleteMany({ where: { templateId, sectionKey: { notIn: next.map((r) => r.key) } } });
  for (const { key, ...data } of next) {
    await tx.templateSection.upsert({
      where: { templateId_sectionKey: { templateId, sectionKey: key } },
      update: data,
      create: { templateId, sectionKey: key, ...data },
    });
  }
}

export async function saveProductSections(tx: Prisma.TransactionClient, productId: string, rows: SectionOverrideInput[]) {
  const next = keepers(rows);
  await tx.productSection.deleteMany({ where: { productId, sectionKey: { notIn: next.map((r) => r.key) } } });
  for (const { key, ...data } of next) {
    await tx.productSection.upsert({
      where: { productId_sectionKey: { productId, sectionKey: key } },
      update: data,
      create: { productId, sectionKey: key, ...data },
    });
  }
}
