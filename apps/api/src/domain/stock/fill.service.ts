/**
 * Stock › Filled (docs/STOCK_HUB.md §3, inventory recovery phase 3): bottles filled from bulk oil and empty bottles by the
 * approved recipe. A fill is a small in-house production order run start to finish on the manufacturing engine (plan →
 * approve → issue → declare what was used and wasted → receive the bottles → close at the final cost), so the materials
 * leave stock at their moving average and each bottle comes in at exactly what it took.
 *
 * Those steps are separate transactions, so the fill is a stock hub entry (hub-entry.ts): the Idempotency-Key claims it
 * (a double tap waits — 409 STOCK_ENTRY_IN_PROGRESS), the entry remembers what each step made, a retry after a failure
 * resumes at the step that failed, and a replay of a finished fill writes nothing. Each step is idempotent on its own as
 * well (the issue by its request key, the usage as absolute figures, the receipt posted once), so no retry can take the
 * oil or the bottles twice.
 *
 * Checked before anything is written: the size has an approved recipe (otherwise it is unconfigured and can't be filled —
 * the owner adds the real recipe first), every material named in `used` / `wasted` is in it, and the stock holds what the
 * fill takes (the recipe's need, or what was really used, plus what was wasted). Nothing is invented: no recipe, no fill.
 */
import { stockFillSchema, type StockFillInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import type { FinanceActor } from "../finance/finance-audit";
import { businessToday, getFinanceContext } from "../finance/finance-context";
import { financeError } from "../finance/finance-values";
import { computeRequirements } from "../manufacturing/requirements";
import { approveProductionOrder, createProductionOrder, getProductionOrder } from "../manufacturing/production-orders.service";
import { declareMaterialUsage, issueMaterials } from "../manufacturing/material-custody.service";
import { createProductionReceipt, postProductionReceipt } from "../manufacturing/production-receipts.service";
import { closeProductionOrder } from "../manufacturing/production-close.service";
import { claimEntry, completeEntry, findEntry, fingerprintOf, releaseEntry, saveSteps, unitOf, type Lease } from "./hub-entry";

const SEE = { canSeeCost: true };

/** The production order's notes start with this, as quick refills always have (Finance › Refills lists them). */
export const fillMarker = (key: string) => `Quick refill ${key}`;

interface FillSteps {
  request: ReturnType<typeof stockFillSchema.parse>;
  productionOrderId?: string;
  receiptId?: string;
}

interface PlannedMaterial {
  materialVariantId: string;
  sku: string;
  name: string;
  unit: string;
  /** What the recipe needs for these bottles (wastage % of the recipe included). */
  need: number;
  /** What leaves stock as the bottles' material: `used` when given, else `need`. */
  consumed: number;
  wasted: number;
  inStock: number;
}

/** What the fill will take from stock, checked before anything is written. Throws when it can't be filled. */
export async function planFill(input: ReturnType<typeof stockFillSchema.parse>) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: input.variantId },
    select: { id: true, sku: true, size: true, productId: true, product: { select: { name: true, kind: true, trackInventory: true, deletedAt: true } } },
  });
  if (!variant || variant.product.kind !== "FINISHED" || !variant.product.trackInventory || variant.product.deletedAt) {
    throw financeError(404, "VARIANT_NOT_FOUND", "Choose the bottle size you filled");
  }
  const bom = await prisma.billOfMaterials.findFirst({
    where: { productId: variant.productId, status: "APPROVED" },
    orderBy: { version: "desc" },
    select: { id: true, lines: { select: { id: true, materialVariantId: true, finishedVariantId: true, qtyPerUnit: true, wastagePct: true, suppliedBy: true } } },
  });
  const requirements = bom
    ? computeRequirements(
        bom.lines.map((l) => ({ id: l.id, materialVariantId: l.materialVariantId, finishedVariantId: l.finishedVariantId, qtyPerUnit: l.qtyPerUnit.toString(), wastagePct: l.wastagePct.toString(), suppliedBy: l.suppliedBy })),
        [{ variantId: variant.id, plannedQty: input.quantity }],
      ).filter((r) => r.suppliedBy === "BUSINESS" && r.plannedQty > 0)
    : [];
  if (!bom || !requirements.length) {
    throw financeError(409, "NO_RECIPE", `${variant.product.name}${variant.size ? ` ${variant.size}` : ""} has no approved recipe yet, so it can't be filled — add the real recipe (oil, bottle, box… per bottle) under Inventory › Manufacturing › Bills of materials`);
  }
  const inRecipe = new Set(requirements.map((r) => r.materialVariantId));
  const strange = [...(input.used ?? []), ...(input.wasted ?? [])].filter((x) => !inRecipe.has(x.materialVariantId));
  if (strange.length) throw financeError(400, "FILL_MATERIAL_NOT_IN_RECIPE", "A material entered as used or wasted is not in this size's recipe");

  const rows = await prisma.productVariant.findMany({
    where: { id: { in: [...inRecipe] } },
    select: { id: true, sku: true, size: true, stock: true, product: { select: { name: true, kind: true, stockUnit: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const used = new Map((input.used ?? []).map((u) => [u.materialVariantId, u.quantity]));
  const wasted = new Map((input.wasted ?? []).map((w) => [w.materialVariantId, w.quantity]));
  const materials: PlannedMaterial[] = requirements.map((r) => {
    const m = byId.get(r.materialVariantId)!;
    return {
      materialVariantId: r.materialVariantId, sku: m.sku, name: m.product.name, unit: unitOf(m.product),
      need: r.plannedQty, consumed: used.get(r.materialVariantId) ?? r.plannedQty, wasted: wasted.get(r.materialVariantId) ?? 0, inStock: m.stock,
    };
  });
  if (!materials.some((m) => m.consumed > 0)) throw financeError(400, "FILL_NOTHING_USED", "A fill uses some material");
  const short = materials.filter((m) => m.consumed + m.wasted > m.inStock);
  if (short.length) {
    throw financeError(
      409,
      "FILL_SHORT",
      `Not enough in stock: ${short.map((m) => `${m.name} needs ${m.consumed + m.wasted} ${m.unit}, ${m.inStock} in stock`).join("; ")} — record what you bought on Stock › Bought first, or fill fewer`,
      { short: short.map((m) => ({ sku: m.sku, name: m.name, unit: m.unit, needed: m.consumed + m.wasted, inStock: m.inStock })) },
    );
  }
  return { variant, bomId: bom.id, materials };
}

/** POST /stock/fills — 201 with the fill, or 200 with the earlier one for a replay. */
export async function recordFill(raw: StockFillInput, actor: FinanceActor, key: string | null) {
  if (!key) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every fill");
  const input = stockFillSchema.parse(raw);
  const { business } = await getFinanceContext();
  const fingerprint = fingerprintOf(input);
  const existing = await findEntry(business.id, "FILL", key);
  if (existing && existing.fingerprint !== fingerprint) throw financeError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different fill");
  if (existing?.completedAt) return { fill: await fillOf(existing.id), replayed: true };
  // a new fill is checked before anything is written; an entry already started resumes (its materials may be issued)
  if (!existing) await planFill(input);

  const steps: FillSteps = { request: input };
  const { entry, done, lease } = await claimEntry({ businessId: business.id, kind: "FILL", key, fingerprint, entryDate: businessToday(business), steps: steps as never, actor });
  if (done) return { fill: await fillOf(entry.id), replayed: true };
  try {
    await runFill(lease!, { ...(entry.steps as unknown as FillSteps), request: input }, key, actor);
  } catch (err) {
    await releaseEntry(lease!);
    throw err;
  }
  return { fill: await fillOf(entry.id), replayed: false };
}

async function runFill(lease: Lease, steps: FillSteps, key: string, actor: FinanceActor) {
  const input = steps.request;
  const marker = fillMarker(key);
  const save = () => saveSteps(lease, steps as never);
  const stopped = (name: string, number: string | null) => (err: unknown): never => {
    const e = err as { message?: string; statusCode?: number; details?: { code?: string } };
    if (e.details?.code === "STOCK_ENTRY_LEASE_LOST") throw err;
    throw financeError(e.statusCode === 400 ? 400 : 409, "FILL_STOPPED", `${number ? `${number}: ` : ""}stopped at "${name}" — ${e.message ?? String(err)}. Nothing is lost: send the fill again (same form) and it carries on from there.`, { step: name, productionOrderId: steps.productionOrderId ?? null, cause: e.details?.code ?? null });
  };

  // 1. the production order (found by its marker if an earlier attempt made it and stopped before remembering it)
  if (!steps.productionOrderId) {
    const prior = await prisma.productionOrder.findFirst({ where: { OR: [{ notes: marker }, { notes: { startsWith: `${marker} — ` } }] }, select: { id: true } });
    if (prior) steps.productionOrderId = prior.id;
    else {
      const { variant, bomId } = await planFill(input);
      const notes = `${marker}${input.note ? ` — ${input.note}` : ""}${input.wasteReason ? ` — wasted: ${input.wasteReason}` : ""}`;
      const created = await createProductionOrder({ productId: variant.productId, bomId, lines: [{ variantId: variant.id, plannedQty: input.quantity }], notes }, actor, SEE);
      steps.productionOrderId = created.id;
    }
    await save();
  }
  const moId = steps.productionOrderId;
  let mo = await getProductionOrder(moId, SEE);
  const fail = (name: string) => stopped(name, mo.number);

  // 2. approve
  if (mo.status === "DRAFT") {
    await approveProductionOrder(moId, actor, SEE).catch(fail("approve"));
    mo = await getProductionOrder(moId, SEE);
  }
  // 3. issue what is used + what was wasted (replays by its request key)
  const used = new Map((input.used ?? []).map((u) => [u.materialVariantId, u.quantity]));
  const wasted = new Map((input.wasted ?? []).map((w) => [w.materialVariantId, w.quantity]));
  const own = mo.materials.filter((m) => m.suppliedBy === "BUSINESS");
  const lines = own
    .map((m) => ({ m, consumed: used.get(m.materialVariantId) ?? m.plannedQty, scrapped: wasted.get(m.materialVariantId) ?? 0 }))
    .filter((l) => l.consumed + l.scrapped > 0);
  const overPlan = lines.some((l) => l.consumed + l.scrapped > l.m.plannedQty);
  await issueMaterials(
    moId,
    { lines: lines.map((l) => ({ materialLineId: l.m.id, quantity: l.consumed + l.scrapped })), note: "Stock › Filled", overIssueReason: overPlan ? (input.wasteReason ? `Wasted: ${input.wasteReason}` : "Stock › Filled: what was really used") : null },
    actor,
    { ...SEE, requestKey: `fill:${lease.id}` },
  ).catch(fail("take the materials"));
  // 4. declare: the bottles' material, and the waste (absolute figures — a repeat changes nothing)
  await declareMaterialUsage(moId, { lines: lines.map((l) => ({ materialLineId: l.m.id, consumedQty: l.consumed, scrappedQty: l.scrapped })) }, actor, SEE).catch(fail("declare what was used"));
  // 5. receive the bottles (one receipt; an earlier attempt's draft is reused)
  mo = await getProductionOrder(moId, SEE);
  if (!steps.receiptId) {
    const open = mo.receipts.find((r) => r.status !== "REVERSED");
    steps.receiptId = open
      ? open.id
      : (await createProductionReceipt(moId, { lines: [{ orderLineId: mo.lines[0]!.id, delivered: input.quantity, accepted: input.quantity }], inspectionNotes: "Stock › Filled" }, actor, SEE).catch(fail("receive the bottles"))).id;
    await save();
  }
  // 6. post it (posting a posted receipt is a replay)
  await postProductionReceipt(steps.receiptId, {}, actor, SEE).catch(fail("put the bottles in stock"));
  // 7. close at the final cost
  mo = await getProductionOrder(moId, SEE);
  if (mo.status !== "CLOSED") await closeProductionOrder(moId, { note: "Stock › Filled" }, actor, SEE).catch(fail("work out the cost"));
  await completeEntry(lease, steps as never);
}

/** One fill as the hub shows it: what went in, what came out, its cost, when and by whom. */
export async function fillOf(entryId: string, opts: { canSeeCost: boolean } = SEE) {
  const entry = await prisma.stockHubEntry.findUniqueOrThrow({ where: { id: entryId } });
  const steps = entry.steps as unknown as FillSteps;
  const mo = steps.productionOrderId ? await getProductionOrder(steps.productionOrderId, opts) : null;
  const by = entry.createdByAdminId ? await prisma.adminUser.findUnique({ where: { id: entry.createdByAdminId }, select: { name: true, email: true } }) : null;
  return {
    id: entry.id,
    complete: entry.completedAt !== null,
    date: mo?.orderDate ?? null,
    recordedAt: entry.createdAt,
    by: by ? by.name || by.email : null,
    productionOrderId: mo?.id ?? null,
    number: mo?.number ?? null,
    variantId: steps.request.variantId,
    sku: mo?.lines[0]?.sku ?? null,
    product: mo?.product.name ?? null,
    quantity: mo ? mo.lines.reduce((s, l) => s + l.acceptedQty, 0) : 0,
    wasteReason: steps.request.wasteReason ?? null,
    materials: (mo?.materials ?? []).filter((m) => m.suppliedBy === "BUSINESS").map((m) => ({ sku: m.sku, name: m.name, unit: m.stockUnit, used: m.consumedQty, wasted: m.scrappedQty, value: m.issuedValue })),
    cost: opts.canSeeCost ? mo?.finalCost?.goods ?? null : null,
    perBottle: opts.canSeeCost ? mo?.finalCost?.perAcceptedUnit ?? null : null,
  };
}
export type StockFill = Awaited<ReturnType<typeof fillOf>>;
