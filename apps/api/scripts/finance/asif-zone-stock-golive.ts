/**
 * Asif Zone: switch the stock hub on (docs/STOCK_HUB.md §4 and §6). One-off, run once on live, off-peak.
 *
 * The owner counts the shelf on go-live day and the figures go into a JSON file (shape:
 * asif-zone-stock-golive.counts.example.json — that example holds the 2026-10-22 figures and must not be used as is).
 * Dry run unless --apply; a second --apply writes nothing. In order:
 *   1. Materials (kind MATERIAL): attar oil per fragrance (ml), empty bottle 6 ml / 12 ml, gift box, sticker, black poly,
 *      bubble poly roll (pcs); each one's stock set to the count (unvalued — the cutover values it).
 *   2. Recipes: per attar product one bill of materials, per size: 6 ml = oil 6 + bottle 6 ml + box + sticker; 12 ml = oil
 *      12 + bottle 12 ml + box + sticker; wastage 0; supplied by the business; approved.
 *   3. Attar becomes fill to order; each attar variant's stock = filled bottles counted − units on orders not yet booked
 *      with the courier (negative = ordered, not filled). Caps keep their stock; the website total is compared with the
 *      count (a difference stops the run unless --accept-caps-difference).
 *      Open orders not yet in the books whose lines carry no cost, or an old catalog cost, get today's cost price (as the
 *      checkout records it; attar: its recipe cost at the counted rates) — so their delivery is costed and the cutover
 *      counts them as on the way to customers.
 *      Attar ordered and not filled: the cutover starts its deficit at the recipe cost, held off the inventory account
 *      (costing.service header), so nothing is set aside and nothing reaches 5150; each fill posts only actual − recipe.
 *   4. Valuation cutover: materials at the counted rates, attar at recipe cost, caps at the owner's cost (all KNOWN), any
 *      other tracked variant at its cost price (ESTIMATED) or MISSING; the whole true-up is booked as an opening-balance
 *      correction (3900, "Stock counted <date> for go-live") so no profit changes; costing switches on.
 *   5. Packaging: black poly ×1 on every parcel (a packing rule, from now on). Bubble poly is a roll: one is opened today.
 *   6. Product cache and the attar products' read model refreshed; what the website sells per attar variant printed.
 *   7. The finance checks; with --apply the run fails if an inventory check isn't MATCHED.
 *
 *   npx tsx scripts/finance/asif-zone-stock-golive.ts --as <owner admin email> --counts <counts.json>
 *       [--apply --expect-trueup <the dry run's projected true-up>] [--accept-caps-difference] [--keep-earlier-counts]
 *   Production: docs/STOCK_HUB.md §6.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { minorDigits } from "@clothing-brand/shared";
import "../../src/config/env";
import { prisma } from "../../src/config/prisma";
import { resolveAdminIdentity } from "../../src/domain/auth/authorization";
import type { FinanceActor } from "../../src/domain/finance/finance-audit";
import { businessToday, getFinanceContext } from "../../src/domain/finance/finance-context";
import { createMaterial } from "../../src/domain/manufacturing/materials.service";
import { approveBom, createBom, updateBom } from "../../src/domain/manufacturing/boms.service";
import { ensureManufacturingSetup, manufacturingReadiness } from "../../src/domain/manufacturing/manufacturing-setup.service";
import { approveCutover, draftCutover, getCutover, inventoryLedgerBridge, postCutover, reopenCutover, updateCutoverLines, updateCutoverSettings, type CutoverLineInput } from "../../src/domain/finance/inventory-cutover.service";
import { createPackingRule } from "../../src/domain/finance/packaging.service";
import { openRoll } from "../../src/domain/finance/stock-check.service";
import { syncCommerce } from "../../src/domain/finance/commerce-accounting.service";
import { acknowledgeException } from "../../src/domain/finance/finance-exceptions.service";
import { RECONCILIATION_CHECKS, RECONCILIATION_CHECK_KEYS } from "../../src/domain/finance/reconciliation.service";
import { adjustVariantStockInTx, afterAdjustment, lockVariantStock, stockMovedSettled } from "../../src/modules/inventory/inventory.service";
import { reservedNotDispatched } from "../../src/domain/stock/count.service";
import { fillCapacityChanged, withFillToOrder } from "../../src/domain/stock/fill-capacity.service";
import { readModelDrift, refreshReadModels } from "../../src/domain/storefront/read-model.service";
import { invalidateProductCache, triggerStorefrontRevalidation } from "../../src/modules/products/product.cache";

const FRAGRANCES = ["AZHAAR", "ROYAL", "SWEET", "ZAYAN"] as const;
type Fragrance = (typeof FRAGRANCES)[number];
type Size = "6ml" | "12ml";
const ML: Record<Size, number> = { "6ml": 6, "12ml": 12 };
/** One adjustment per variant, ever: the go-live sets stock once; afterwards the hub's Counted does. */
const SOURCE_TYPE = "StockGoLive";

// ── the counts file ────────────────────────────────────────────────────────────────────────────────────────────────

const count = z.number().int().min(0).max(1_000_000);
const rate = z.number().positive().max(1_000_000).refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "a rate has at most 2 decimals (whole paisa)");
const item = z.object({ count, rate }).strict();
const perFragrance = <T extends z.ZodTypeAny>(t: T) => z.object({ AZHAAR: t, ROYAL: t, SWEET: t, ZAYAN: t }).strict();
const countsSchema = z.object({
  countedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "countedOn is YYYY-MM-DD"),
  notes: z.string().max(2000).optional(),
  /** Bulk attar oil on the shelf (ml, whole) and its cost per ml. */
  oil: perFragrance(z.object({ ml: count, rate }).strict()),
  emptyBottles: z.object({ "6ml": item, "12ml": item }).strict(),
  boxes: item,
  stickers: item,
  blackPoly: item,
  /** Rolls not yet opened plus the one in use; the rate is per roll. */
  bubblePolyRolls: item,
  /** Every cap on the shelf, all colours and sizes (bagged for unbooked orders included); the rate is the owner's cost per cap. */
  caps: item,
  /** Filled attar bottles on the shelf (bagged for unbooked orders included). */
  filledBottles: perFragrance(z.object({ "6ml": count, "12ml": count }).strict()),
}).strict();
type Counts = z.infer<typeof countsSchema>;

// ── output ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const value = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const KNOWN_FLAGS = new Set(["--apply", "--accept-caps-difference", "--keep-earlier-counts", "--as", "--counts", "--expect-trueup"]);
const APPLY = flag("--apply");
const r2 = (n: number) => Math.round(n * 100) / 100;
const taka = (n: number) => `৳${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
// Operator output goes straight to the terminal, not the JSON logger.
const say = (s: string) => process.stdout.write(`${s}\n`);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The materials, by a fixed SKU (the owner-history script's names, plus the two polys). */
interface MaterialSpec { sku: string; name: string; unit: string; spec: string; qty: number; rate: number }
function materialSpecs(c: Counts, attar: Record<Fragrance, { name: string }>): Record<string, MaterialSpec> {
  const oilSku: Record<Fragrance, string> = { AZHAAR: "MAT-OIL-AZHAR", ROYAL: "MAT-OIL-ROYAL", SWEET: "MAT-OIL-SWEET", ZAYAN: "MAT-OIL-ZAYAN" };
  const out: Record<string, MaterialSpec> = {};
  for (const f of FRAGRANCES) out[`oil:${f}`] = { sku: oilSku[f], name: `Attar oil — ${attar[f].name}`, unit: "ml", spec: "Bulk oil", qty: c.oil[f].ml, rate: c.oil[f].rate };
  out["bottle:6ml"] = { sku: "MAT-BTL-6", name: "Empty attar bottle 6 ml", unit: "pcs", spec: "6 ml", qty: c.emptyBottles["6ml"].count, rate: c.emptyBottles["6ml"].rate };
  out["bottle:12ml"] = { sku: "MAT-BTL-12", name: "Empty attar bottle 12 ml", unit: "pcs", spec: "12 ml", qty: c.emptyBottles["12ml"].count, rate: c.emptyBottles["12ml"].rate };
  out.box = { sku: "MAT-BOX", name: "Attar gift box", unit: "pcs", spec: "Standard", qty: c.boxes.count, rate: c.boxes.rate };
  out.sticker = { sku: "MAT-STICKER", name: "Attar sticker", unit: "pcs", spec: "Standard", qty: c.stickers.count, rate: c.stickers.rate };
  out.blackPoly = { sku: "MAT-POLY-BLACK", name: "Black poly (parcel bag)", unit: "pcs", spec: "Standard", qty: c.blackPoly.count, rate: c.blackPoly.rate };
  out.bubblePoly = { sku: "MAT-POLY-BUBBLE", name: "Bubble poly roll", unit: "pcs", spec: "Roll", qty: c.bubblePolyRolls.count, rate: c.bubblePolyRolls.rate };
  return out;
}

/** The frozen summary a posted cutover keeps (inventory-cutover.service postCutover). */
interface CutoverSummary { ledgerBefore: number; valuation: number; inTransit: number; unfilledAtRecipeCost?: number; unfilledUnits?: number; adjustment: number; toOpeningBalanceEquity: number; toCostAdjustments: number; deficitUnits: number; unvaluedUnits: number }

/** The count an earlier run's go-live movement was made from, from the note it wrote (materials: "owner count <date> — <n>
 * <unit>"; attar: "<n> filled bottle(s) counted <date>"). */
function countInNote(note: string | null): { count: number; on: string } | null {
  const material = /owner count (\d{4}-\d{2}-\d{2}) — (\d+) /.exec(note ?? "");
  if (material) return { count: Number(material[2]), on: material[1]! };
  const attar = /— (\d+) filled bottle\(s\) counted (\d{4}-\d{2}-\d{2})/.exec(note ?? "");
  return attar ? { count: Number(attar[1]), on: attar[2]! } : null;
}

/** Sets one variant's stock to a target, once (the movement carries SOURCE_TYPE and the variant as its source). The stock and
 * the units waiting on orders not yet booked with the courier are read under the variant's row lock — the lock every sale
 * takes — in the adjustment's own transaction, so an order placed meanwhile can't leave a phantom unit. Null: nothing to do. */
async function setStockOnce(variantId: string, adminId: string, plan: (waiting: number) => { target: number; note: string }) {
  const done = await prisma.$transaction(async (tx) => {
    const current = await lockVariantStock(tx, variantId);
    if (current === null) throw new Error(`Variant ${variantId} not found`);
    const waiting = (await reservedNotDispatched(tx, [variantId])).get(variantId) ?? 0;
    const { target, note } = plan(waiting);
    if (current === target) return null;
    const adjusted = await adjustVariantStockInTx(tx, variantId, target - current, "ADJUSTMENT", adminId, note, { source: { type: SOURCE_TYPE, id: variantId }, floor: Math.max(0, -target) });
    return { from: current, to: target, adjusted };
  });
  if (done) afterAdjustment(done.adjusted);
  return done;
}

function sizeOf(raw: string): Size | null {
  const m = /^\s*(6|12)\s*ml\s*$/i.exec(raw);
  return m ? (`${m[1]}ml` as Size) : null;
}

/** A recipe line's identity, for "is the approved bill of materials already this one". */
const lineKey = (l: { materialVariantId: string; finishedVariantId: string | null; qtyPerUnit: string | number; wastagePct: string | number; suppliedBy: string }) =>
  `${l.materialVariantId}|${l.finishedVariantId ?? "*"}|${Number(l.qtyPerUnit)}|${Number(l.wastagePct)}|${l.suppliedBy}`;

async function main() {
  const unknown = args.filter((a, i) => a.startsWith("--") && !KNOWN_FLAGS.has(a) && !(i > 0 && ["--as", "--counts", "--expect-trueup"].includes(args[i - 1]!)));
  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.join(" ")}`);
  const email = value("--as");
  if (!email) throw new Error("Pass --as <owner admin email>");
  const file = value("--counts");
  if (!file) throw new Error("Pass --counts <counts.json> (the owner's count on go-live day; see asif-zone-stock-golive.counts.example.json)");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`Can't read ${file}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  const parsed = countsSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${file} is not a valid counts file:\n${parsed.error.issues.map((i) => `  ${i.path.join(".") || "(file)"}: ${i.message}`).join("\n")}`);
  const counts = parsed.data;

  const admin = await prisma.adminUser.findUnique({ where: { email }, select: { id: true, email: true, role: true } });
  if (!admin) throw new Error(`No admin ${email}`);
  const identity = await resolveAdminIdentity(admin.id);
  if (!identity) throw new Error(`${email} can't sign in`);
  if (admin.role !== "OWNER") throw new Error(`${email} isn't the owner — the valuation cutover is the owner's`);
  const actor: FinanceActor = { type: "ADMIN", adminId: admin.id, label: `${admin.email} (stock go-live)`, permissions: identity.permissions };
  const { business } = await getFinanceContext();
  const today = businessToday(business);
  const age = daysBetween(counts.countedOn, today);
  if (age < 0) throw new Error(`countedOn ${counts.countedOn} is in the future (today is ${today})`);
  if (age > 1) throw new Error(`countedOn ${counts.countedOn} is ${age} days old — count the shelf again on go-live day (bottles are filled and parcels leave every day)`);
  const costingOn = (await prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { inventoryCostingActivatedAt: true } })).inventoryCostingActivatedAt;
  say(`${business.name}: stock hub go-live, count of ${counts.countedOn}${APPLY ? "" : " — DRY RUN (nothing written)"}`);
  if (costingOn) say(`Costing has been live since ${costingOn.toISOString()} — stock is no longer set from this file; only what is missing is completed.`);
  let wrote = false;

  // ── read everything first ──────────────────────────────────────────────────────────────────────────────────────
  const products = await prisma.product.findMany({
    where: { kind: "FINISHED", deletedAt: null },
    select: { id: true, name: true, slug: true, fillToOrder: true, trackInventory: true, category: { select: { name: true } }, variants: { select: { id: true, sku: true, size: true, color: true, stock: true, costPrice: true, isActive: true }, orderBy: { sku: "asc" } } },
  });
  const attar = {} as Record<Fragrance, (typeof products)[number]>;
  for (const f of FRAGRANCES) {
    const hits = products.filter((p) => p.name.toUpperCase().includes(f));
    if (hits.length !== 1) throw new Error(`Expected one attar product named like "${f}", found ${hits.length}${hits.length ? `: ${hits.map((p) => p.name).join(", ")}` : ""}`);
    attar[f] = hits[0]!;
    if (!attar[f].trackInventory) throw new Error(`${attar[f].name} isn't stock-tracked`);
  }
  const attarVariants: Array<{ f: Fragrance; size: Size; v: (typeof products)[number]["variants"][number]; product: (typeof products)[number] }> = [];
  for (const f of FRAGRANCES) {
    for (const v of attar[f].variants) {
      const size = sizeOf(v.size);
      if (!size) throw new Error(`${attar[f].name} ${v.sku}: size "${v.size}" is neither 6ml nor 12ml — fix the variant before go-live`);
      if (attarVariants.some((a) => a.f === f && a.size === size)) throw new Error(`${attar[f].name} has two ${size} variants`);
      attarVariants.push({ f, size, v, product: attar[f] });
    }
  }
  attarVariants.sort((a, b) => FRAGRANCES.indexOf(a.f) - FRAGRANCES.indexOf(b.f) || ML[a.size] - ML[b.size]);
  const caps = products.filter((p) => /cap/i.test(p.category?.name ?? "") && p.trackInventory).flatMap((p) => p.variants.map((v) => ({ ...v, product: p.name })));
  const reserved = await reservedNotDispatched(prisma, [...attarVariants.map((a) => a.v.id), ...caps.map((c) => c.id)]);
  const specs = materialSpecs(counts, attar);
  const existingMaterials = new Map((await prisma.productVariant.findMany({ where: { sku: { in: Object.values(specs).map((s) => s.sku) } }, select: { id: true, sku: true, stock: true, product: { select: { id: true, kind: true, stockUnit: true, name: true } } } })).map((v) => [v.sku, v]));
  for (const [sku, v] of existingMaterials) {
    const spec = Object.values(specs).find((s) => s.sku === sku)!;
    if (v.product.kind !== "MATERIAL") throw new Error(`SKU ${sku} is taken by ${v.product.name}, which isn't a material`);
    if (v.product.stockUnit !== spec.unit) throw new Error(`Material ${sku} counts in ${v.product.stockUnit}, not ${spec.unit}`);
  }
  // What an earlier run already set (one movement per variant, ever) and from which count — read from the note it wrote.
  const earlierMoves = await prisma.stockMovement.findMany({ where: { sourceType: SOURCE_TYPE }, select: { variantId: true, note: true } });
  const goneLive = new Set(earlierMoves.map((m) => m.variantId));
  const earlierCount = new Map(earlierMoves.map((m) => [m.variantId, countInNote(m.note)]));

  // recipe cost per attar variant (৳): oil × ml + bottle + box + sticker, at the counted rates
  const recipeCost = (f: Fragrance, size: Size) => r2(counts.oil[f].rate * ML[size] + counts.emptyBottles[size].rate + counts.boxes.rate + counts.stickers.rate);

  say("");
  say(`1. Materials (stock set to the count${costingOn ? " — already live, not changed" : ""})`);
  // A re-run after a partial failure keeps what the earlier run set; a different count in this file is shown and stops --apply
  // unless --keep-earlier-counts (so a corrected or wrong file never goes half-applied without anyone noticing).
  const keptDifferences: string[] = [];
  const earlierDiffers = (variantId: string, label: string, now: number, unit: string) => {
    const e = earlierCount.get(variantId);
    if (!goneLive.has(variantId) || !e || e.count === now) return "";
    keptDifferences.push(`${label}: set from ${e.count} ${unit} (count of ${e.on}); this file says ${now}`);
    return ` ⚠ earlier run used ${e.count} (${e.on})`;
  };
  for (const s of Object.values(specs)) {
    const ex = existingMaterials.get(s.sku);
    const now = ex ? `${ex.stock} ${s.unit} on record${goneLive.has(ex.id) ? " (set at go-live)" : ""}${earlierDiffers(ex.id, s.sku, s.qty, s.unit)}` : "new";
    say(`   ${s.sku.padEnd(16)} ${s.name}: ${s.qty.toLocaleString("en-IN")} ${s.unit} × ${taka(s.rate)} = ${taka(r2(s.qty * s.rate))}  [${now}]`);
  }
  say("2. Recipes (per size; wastage 0; supplied by the business; approved)");
  for (const f of FRAGRANCES) {
    say(`   ${attar[f].name}: ${attarVariants.filter((a) => a.f === f).map((a) => `${a.size} = oil ${ML[a.size]} ml + bottle ${a.size} + box + sticker → ${taka(recipeCost(f, a.size))}`).join("; ")}`);
  }
  say("3. Attar: fill to order; stock = filled bottles − units on orders not yet booked with the courier");
  const attarTarget = new Map<string, number>();
  for (const a of attarVariants) {
    const filled = counts.filledBottles[a.f][a.size];
    const waiting = reserved.get(a.v.id) ?? 0;
    attarTarget.set(a.v.id, filled - waiting);
    say(`   ${a.v.sku.padEnd(16)} ${a.product.name} ${a.size}: ${filled} filled − ${waiting} waiting = ${filled - waiting} (website number now ${a.v.stock})${goneLive.has(a.v.id) ? " — set at go-live" : ""}${earlierDiffers(a.v.id, `${a.v.sku} filled bottles`, filled, "bottle(s)")}`);
  }
  if (keptDifferences.length) {
    say(`   ⚠ An earlier run already set ${keptDifferences.length} item(s) from different counts — stock is set once, so those keep the earlier figures:`);
    for (const d of keptDifferences) say(`     ${d}`);
    if (APPLY && !costingOn && !flag("--keep-earlier-counts")) {
      throw new Error("Counts differ from what an earlier run already set (above). Use the earlier counts file, or correct those items under Stock › Counted after go-live and re-run with --keep-earlier-counts");
    }
  }
  const capWebsite = caps.reduce((s, c) => s + c.stock, 0);
  const capWaiting = caps.reduce((s, c) => s + (reserved.get(c.id) ?? 0), 0);
  const capDiff = counts.caps.count - (capWebsite + capWaiting);
  say(`   Caps: website ${capWebsite} + ${capWaiting} on unbooked orders = ${capWebsite + capWaiting} expected on the shelf; counted ${counts.caps.count}; difference ${capDiff > 0 ? "+" : ""}${capDiff} (cap stock is per colour and size — not changed here)`);
  const capsBlock = capDiff !== 0 && !costingOn && !flag("--accept-caps-difference");
  if (capsBlock && !APPLY) say(`   ⚠ --apply will stop here: correct the cap variants first, or add --accept-caps-difference to go live with the website's ${capWebsite} caps`);
  if (capsBlock && APPLY) {
    throw new Error(`Caps differ from the count by ${capDiff}. Correct the cap variants first (Inventory), or re-run with --accept-caps-difference to go live with the website's ${capWebsite} caps valued at ${taka(counts.caps.rate)}`);
  }

  // Open orders taken before the variant had its cost price carry no cost (their delivery would raise a "missing cost"
  // note, and the cutover would leave them out of what is on the way to customers), or an old typed catalog cost (attar
  // at ৳610 before the owner's list). Neither is in the books yet; they get today's cost price, as the checkout records
  // it (CATALOG) — the cost the 2026-10-22 count put into the inventory account for them.
  const factor = 10 ** minorDigits(business.baseCurrency);
  const attarCost = attarVariants.map((a) => ({ id: a.v.id, cost: Math.round(recipeCost(a.f, a.size) * factor) }));
  const uncosted = costingOn ? [] : await uncostedOpenLines(factor, attarCost);
  const uncostedMinor = uncosted.reduce((s, l) => s + l.units * (l.cost - (l.old ?? 0)), 0);
  say(`   Open orders, lines without today's cost price: ${uncosted.length} line(s), ${uncosted.reduce((s, l) => s + l.units, 0)} unit(s); on the way to customers ${uncostedMinor >= 0 ? "+" : ""}${taka(uncostedMinor / factor)}`);
  const bySku = new Map<string, { units: number; from: Set<string>; to: number }>();
  for (const l of uncosted) {
    const g = bySku.get(l.sku) ?? { units: 0, from: new Set<string>(), to: l.cost };
    g.units += l.units;
    g.from.add(l.old === null ? "none" : taka(l.old / factor));
    bySku.set(l.sku, g);
  }
  for (const [sku, g] of bySku) say(`     ${sku.padEnd(22)} ${g.units} unit(s): ${[...g.from].join(" / ")} → ${taka(g.to / factor)}`);

  // Unfilled: attar sold before go-live and not filled yet. The cutover starts each such variant's deficit at its recipe cost,
  // held off the inventory account (their cost is on the way to customers, their materials are on the shelf — counted
  // once); each fill then posts only what the bottles really cost beyond the recipe. Nothing is set aside, nothing to 5150.
  const unfilled = attarVariants.reduce((acc, a) => {
    const short = Math.max(0, -attarTarget.get(a.v.id)!);
    return { units: acc.units + short, minor: acc.minor + short * Math.round(recipeCost(a.f, a.size) * factor) };
  }, { units: 0, minor: 0 });
  if (unfilled.units) say(`   Waiting to be filled: ${unfilled.units} attar unit(s) ordered and not filled (recipe cost ${taka(unfilled.minor / factor)}) — the cutover holds them at recipe cost; fill them under Stock › Filled`);

  // projected valuation (dry run; the post values the stock at that moment)
  const tracked = await prisma.productVariant.findMany({ where: { product: { trackInventory: true } }, select: { id: true, sku: true, stock: true, costPrice: true, product: { select: { costPrice: true, kind: true } } } });
  const specBySku = new Map(Object.values(specs).map((s) => [s.sku, s]));
  const capIds = new Set(caps.map((c) => c.id));
  const attarById = new Map(attarVariants.map((a) => [a.v.id, a]));
  function costLine(v: (typeof tracked)[number]): CutoverLineInput & { qty: number } {
    const spec = specBySku.get(v.sku);
    if (spec) return { variantId: v.id, unitCost: spec.rate, valuationStatus: "KNOWN", costSource: "OWNER", evidence: `owner count ${counts.countedOn}`, qty: costingOn ? v.stock : spec.qty };
    const a = attarById.get(v.id);
    if (a) return { variantId: v.id, unitCost: recipeCost(a.f, a.size), valuationStatus: "KNOWN", costSource: "OWNER", evidence: `recipe at the rates of the owner count ${counts.countedOn}`, qty: costingOn ? v.stock : attarTarget.get(v.id)! };
    // A cap batch bought at another price carries it on its variants (typed in the product form); the counts file's rate
    // covers caps with none.
    if (capIds.has(v.id)) {
      const own = v.costPrice !== null && Number(v.costPrice) > 0 ? r2(Number(v.costPrice)) : null;
      return { variantId: v.id, unitCost: own ?? counts.caps.rate, valuationStatus: "KNOWN", costSource: "OWNER", evidence: own !== null ? "owner's cost price on the cap" : "owner's cost list", qty: v.stock };
    }
    const cp = v.costPrice ?? v.product.costPrice;
    if (cp !== null && Number(cp) > 0) return { variantId: v.id, unitCost: r2(Number(cp)), valuationStatus: "ESTIMATED", costSource: v.costPrice !== null ? "CATALOG_VARIANT" : "CATALOG_PRODUCT", evidence: "Typed catalog cost price — not purchase-verified", qty: v.stock };
    return { variantId: v.id, unitCost: null, valuationStatus: "MISSING", costSource: "NONE", evidence: null, qty: v.stock };
  }
  const projected = [...tracked.map(costLine), ...Object.values(specs).filter((s) => !existingMaterials.has(s.sku)).map((s) => ({ variantId: s.sku, unitCost: s.rate, valuationStatus: "KNOWN" as const, costSource: "OWNER" as const, evidence: "", qty: s.qty }))];
  const projValuation = r2(projected.reduce((s, l) => s + Math.max(0, l.qty) * (l.unitCost ?? 0), 0));
  const others = tracked.filter((v) => !specBySku.has(v.sku) && !attarById.has(v.id) && !capIds.has(v.id));
  const missing = projected.filter((l) => l.valuationStatus === "MISSING");
  say(`4. Valuation cutover: materials at the counted rates, attar at recipe cost, caps at their own cost price, else ${taka(counts.caps.rate)} (KNOWN); ${others.length} other tracked variant(s) at cost price (ESTIMATED)${missing.length ? `, ${missing.length} MISSING (held unvalued): ${missing.map((l) => tracked.find((v) => v.id === l.variantId)?.sku).join(", ")}` : ""}`);
  const cutover = await getCutover();
  let projectedTrueUp: number | null = null;
  if (cutover.batch?.status === "POSTED") {
    const s = cutover.batch.summary as unknown as CutoverSummary;
    say(`   posted ${cutover.batch.cutoverDate}: ledger before ${taka(s.ledgerBefore)}, valuation ${taka(s.valuation)}, in-transit ${taka(s.inTransit)}, unfilled at recipe cost ${taka(s.unfilledAtRecipeCost ?? 0)}, adjustment ${taka(s.adjustment)} (3900 ${taka(s.toOpeningBalanceEquity)}, 5150 ${taka(s.toCostAdjustments)})`);
  } else {
    const bridge = await inventoryLedgerBridge(prisma, business);
    const ledger = bridge.ledgerMinor / factor, inTransit = bridge.inTransitMinor / factor;
    const transit = r2(inTransit + uncostedMinor / factor);
    const waiting = r2(unfilled.minor / factor);
    say(`   inventory account (1610) ${taka(ledger)}`);
    say(`   projected valuation ${taka(projValuation)} + in-transit ${taka(transit)} (now ${taka(inTransit)} + lines given a cost ${taka(uncostedMinor / factor)}) − unfilled at recipe cost ${taka(waiting)} = ${taka(r2(projValuation + transit - waiting))}`);
    projectedTrueUp = r2(projValuation + transit - waiting - ledger);
    say(`   projected true-up ${taka(projectedTrueUp)} → opening-balance correction (3900) "Stock counted ${counts.countedOn} for go-live"; nothing else to profit (5150)`);
  }
  say("5. Packaging: black poly ×1 on every parcel (packing rule, from now on); bubble poly: one roll opened today (not a packing rule)");

  if (!APPLY) {
    say("");
    await printChecks(false);
    say(`Dry run only. Run again with --apply${projectedTrueUp !== null ? ` --expect-trueup ${projectedTrueUp}` : ""} to write this.`);
    return 0;
  }
  // The operator confirms the true-up the dry run showed: a mistyped count (an extra zero) shows up there as a figure nobody
  // expected, and the run doesn't go ahead on a number nobody looked at.
  if (projectedTrueUp !== null) {
    const typed = value("--expect-trueup");
    if (typed === undefined) throw new Error(`Pass --expect-trueup <the projected true-up the dry run printed> (it is ${projectedTrueUp} now)`);
    const expected = Number(typed.replace(/[৳,\s]/g, ""));
    if (!Number.isFinite(expected)) throw new Error(`--expect-trueup "${typed}" isn't a number`);
    if (Math.abs(expected - projectedTrueUp) > 1) throw new Error(`The projected true-up is ${taka(projectedTrueUp)}, not ${taka(expected)} — run the dry run again and check what changed`);
  }

  // ── 0. manufacturing accounts (quick refill — "Filled" — needs them) ─────────────────────────────────────────────
  if (!(await manufacturingReadiness(prisma, business.id)).ready) {
    const r = await ensureManufacturingSetup(actor);
    say(`0. manufacturing set up: ${r.changes.join(", ") || "nothing to add"}`);
    wrote = true;
  }

  // ── 1. materials ────────────────────────────────────────────────────────────────────────────────────────────────
  const materialId: Record<string, string> = {};
  for (const [key, s] of Object.entries(specs)) {
    let v = existingMaterials.get(s.sku);
    if (!v) {
      const m = await createMaterial({ name: s.name, stockUnit: s.unit, referenceCost: s.rate, description: `Created by the stock go-live (${counts.countedOn})`, variants: [{ sku: s.sku, spec: s.spec }] }, actor, { canSeeCost: true });
      v = { id: m.variants[0]!.id, sku: s.sku, stock: 0, product: { id: m.id, kind: "MATERIAL", stockUnit: s.unit, name: s.name } };
      say(`1. created ${s.sku} ${s.name}`);
      wrote = true;
    }
    materialId[key] = v.id;
    if (!costingOn && !goneLive.has(v.id)) {
      const set = await setStockOnce(v.id, admin.id, () => ({ target: s.qty, note: `Stock go-live: owner count ${counts.countedOn} — ${s.qty} ${s.unit}` }));
      if (set) {
        say(`1. ${s.sku}: stock ${set.from} → ${set.to} ${s.unit}`);
        wrote = true;
      }
    }
  }

  // ── 2. recipes ──────────────────────────────────────────────────────────────────────────────────────────────────
  for (const f of FRAGRANCES) {
    const lines = attarVariants.filter((a) => a.f === f).flatMap((a) => [
      { materialVariantId: materialId[`oil:${f}`]!, finishedVariantId: a.v.id, qtyPerUnit: String(ML[a.size]), wastagePct: "0", suppliedBy: "BUSINESS" as const },
      { materialVariantId: materialId[`bottle:${a.size}`]!, finishedVariantId: a.v.id, qtyPerUnit: "1", wastagePct: "0", suppliedBy: "BUSINESS" as const },
      { materialVariantId: materialId.box!, finishedVariantId: a.v.id, qtyPerUnit: "1", wastagePct: "0", suppliedBy: "BUSINESS" as const },
      { materialVariantId: materialId.sticker!, finishedVariantId: a.v.id, qtyPerUnit: "1", wastagePct: "0", suppliedBy: "BUSINESS" as const },
    ]);
    const want = lines.map(lineKey).sort().join("\n");
    const boms = await prisma.billOfMaterials.findMany({ where: { productId: attar[f].id }, orderBy: { version: "desc" }, include: { lines: true } });
    const approved = boms.find((b) => b.status === "APPROVED");
    if (approved && approved.lines.map((l) => lineKey({ ...l, qtyPerUnit: l.qtyPerUnit.toString(), wastagePct: l.wastagePct.toString() })).sort().join("\n") === want) continue;
    const draft = boms.find((b) => b.status === "DRAFT");
    const id = draft ? (await updateBom(draft.id, { name: `${attar[f].name} — fill`, lines }, actor)).id : (await createBom({ productId: attar[f].id, name: `${attar[f].name} — fill`, notes: `Stock go-live ${counts.countedOn}: one bottle = oil + empty bottle + box + sticker`, lines }, actor)).id;
    const b = await approveBom(id, actor);
    say(`2. ${attar[f].name}: recipe v${b.version} approved${approved ? ` (replaces v${approved.version})` : ""}`);
    wrote = true;
  }

  // ── 3. attar: fill to order, stock = filled − waiting ─────────────────────────────────────────────────────────────
  for (const f of FRAGRANCES) {
    if (attar[f].fillToOrder) continue;
    await prisma.product.update({ where: { id: attar[f].id }, data: { fillToOrder: true } });
    say(`3. ${attar[f].name}: fill to order`);
    wrote = true;
  }
  if (!costingOn) {
    for (const a of attarVariants) {
      if (goneLive.has(a.v.id)) continue;
      const filled = counts.filledBottles[a.f][a.size];
      // Units waiting are read under the variant's lock, in the adjustment's transaction: an order placed meanwhile either
      // committed before (its units are waiting, and in the stock) or waits for this to commit — never half of each.
      const set = await setStockOnce(a.v.id, admin.id, (waiting) => ({
        target: filled - waiting,
        note: `Stock go-live: fill to order — ${filled} filled bottle(s) counted ${counts.countedOn} less ${waiting} on orders not yet booked with the courier`,
      }));
      if (set) {
        say(`3. ${a.v.sku} ${a.product.name} ${a.size}: stock ${set.from} → ${set.to}`);
        wrote = true;
      }
    }
  }
  await stockMovedSettled();

  if (!costingOn) {
    // 3b. open orders' lines → today's cost price (read again: orders may have come in)
    const lines = await uncostedOpenLines(factor, attarCost);
    if (lines.length) {
      const n = await prisma.$executeRaw`
        UPDATE "OrderItem" i SET "unitCostSnapshot" = x.cost, "unitCostSource" = 'CATALOG'
        FROM jsonb_to_recordset(${JSON.stringify(lines.map((l) => ({ id: l.id, cost: l.cost, old: l.old })))}::jsonb) AS x(id text, cost int, old int)
        WHERE i.id = x.id AND i."unitCostSnapshot" IS NOT DISTINCT FROM x.old AND i."costMovementId" IS NULL`;
      say(`3. ${n} open order line(s) given today's cost price (on the way to customers ${taka(lines.reduce((s, l) => s + l.units * (l.cost - (l.old ?? 0)), 0) / factor)})`);
      wrote = true;
    }
  }

  // ── 4. valuation cutover ───────────────────────────────────────────────────────────────────────────────────────
  let batch = (await getCutover()).batch;
  if (batch?.status !== "POSTED") {
    const reason = `Stock counted ${counts.countedOn} for go-live`;
    let posted = null;
    for (let attempt = 1; attempt <= 3 && !posted; attempt += 1) {
      if (batch?.status === "APPROVED") await reopenCutover({ reason: "Stock go-live script: costs and the true-up are set again" }, actor);
      await draftCutover({ notes: `Stock hub go-live — ${reason}` }, actor);
      const lines = await prisma.inventoryCutoverLine.findMany({ where: { batch: { businessId: business.id } }, select: { variantId: true } });
      const fresh = new Map((await prisma.productVariant.findMany({ where: { id: { in: lines.map((l) => l.variantId) } }, select: { id: true, sku: true, stock: true, costPrice: true, product: { select: { costPrice: true, kind: true } } } })).map((v) => [v.id, v]));
      const inputs = lines.map((l) => { const { qty: _qty, ...line } = costLine(fresh.get(l.variantId)!); return line; });
      for (let i = 0; i < inputs.length; i += 200) await updateCutoverLines(inputs.slice(i, i + 200), actor);
      const preview = (await getCutover()).preview!;
      await updateCutoverSettings({ openingErrorAmount: preview.adjustment, openingErrorReason: preview.adjustment === 0 ? null : reason }, actor);
      const approved = await approveCutover({ acknowledgeMissing: true }, actor);
      say(`4. cutover approved: ${approved.summary.lines} line(s) — ${approved.summary.known} known, ${approved.summary.estimated} estimated, ${approved.summary.missing} missing; preview true-up ${taka(preview.adjustment)}`);
      try {
        posted = await postCutover(actor);
      } catch (e) {
        const code = (e as { details?: { code?: string } }).details?.code;
        if (code !== "CUTOVER_OPENING_ERROR_EXCEEDS" || attempt === 3) throw e;
        say(`   stock moved between approval and posting (${(e as Error).message}) — again`);
        batch = (await getCutover()).batch;
      }
    }
    const s = posted!.batch.summary as unknown as CutoverSummary;
    say(`4. cutover POSTED: ledger before ${taka(s.ledgerBefore)}, valuation ${taka(s.valuation)}, in-transit ${taka(s.inTransit)}, unfilled at recipe cost ${taka(s.unfilledAtRecipeCost ?? 0)}, adjustment ${taka(s.adjustment)} → 3900 ${taka(s.toOpeningBalanceEquity)}, 5150 ${taka(s.toCostAdjustments)}; ${s.deficitUnits} unit(s) ordered not filled, ${s.unvaluedUnits} unvalued; journal ${posted!.journal?.number ?? "none (no true-up)"}`);
    if (s.toCostAdjustments !== 0) say(`   NOTE: ${taka(s.toCostAdjustments)} went to 5150 — stock moved between the approval and the post`);
    wrote = true;
  }

  // The go-live movements were made before costing was live; the cutover valued them. The books' scan raises a
  // "stock without a value" note for each — closed here as seen.
  const glMoves = await prisma.stockMovement.findMany({ where: { sourceType: SOURCE_TYPE }, select: { id: true } });
  const glExceptions = await prisma.financeException.findMany({ where: { businessId: business.id, sourceType: "StockMovement", sourceId: { in: glMoves.map((m) => m.id) } }, select: { id: true, status: true, sourceId: true } });
  if (glMoves.some((m) => !glExceptions.some((e) => e.sourceId === m.id))) {
    await syncCommerce({ full: true, actor });
    wrote = true;
  }
  const openNotes = await prisma.financeException.findMany({ where: { businessId: business.id, status: "OPEN", sourceType: "StockMovement", sourceId: { in: glMoves.map((m) => m.id) } }, select: { id: true } });
  for (const e of openNotes) await acknowledgeException(e.id, `Stock go-live (count ${counts.countedOn}): the stock was set before costing went live and is valued by the valuation cutover`, actor);
  if (openNotes.length) { say(`4. ${openNotes.length} go-live stock note(s) closed as valued by the cutover`); wrote = true; }

  // ── 5. packaging ───────────────────────────────────────────────────────────────────────────────────────────────
  const black = materialId.blackPoly!;
  if (!(await prisma.packingRule.findFirst({ where: { materialVariantId: black, scope: "EVERY_PARCEL", isActive: true } }))) {
    await createPackingRule({ scope: "EVERY_PARCEL", materialVariantId: black, quantity: 1, per: "PARCEL", notes: `Stock go-live ${counts.countedOn}: one black poly on every parcel` }, actor);
    say("5. packing rule: black poly ×1 on every parcel");
    wrote = true;
  }
  const bubble = materialId.bubblePoly!;
  if (counts.bubblePolyRolls.count >= 1 && !(await prisma.materialRoll.findFirst({ where: { businessId: business.id, materialVariantId: bubble, finishedOn: null } }))) {
    await openRoll({ materialVariantId: bubble, openedOn: today, note: `Stock go-live ${counts.countedOn}: the roll in use` }, actor);
    say(`5. bubble poly: roll opened ${today}`);
    wrote = true;
  }

  // ── 6. what the website sells ───────────────────────────────────────────────────────────────────────────────────
  const attarIds = FRAGRANCES.map((f) => attar[f].id);
  const drifted = (await readModelDrift()).filter((d) => attarIds.includes(d.productId));
  if (wrote || drifted.length) {
    fillCapacityChanged();
    await invalidateProductCache();
    await refreshReadModels(attarIds);
    await triggerStorefrontRevalidation({ productIds: attarIds }).catch(() => undefined);
    say(`6. product cache cleared; read model refreshed for ${attarIds.length} attar product(s)`);
  }
  say("6. the website sells (filled + can be made):");
  for (const f of FRAGRANCES) {
    const p = await prisma.product.findUniqueOrThrow({ where: { id: attar[f].id }, select: { fillToOrder: true, trackInventory: true, variants: { select: { id: true, sku: true, size: true, stock: true }, orderBy: { sku: "asc" } } } });
    const sells = await withFillToOrder(prisma, p, p.variants.map((v) => ({ ...v })));
    for (const v of sells) say(`   ${v.sku.padEnd(16)} ${attar[f].name} ${v.size}: stock ${p.variants.find((x) => x.id === v.id)!.stock}, sells ${v.stock}`);
  }

  // ── 7. checks ──────────────────────────────────────────────────────────────────────────────────────────────────
  const ok = await printChecks(true);
  say(wrote ? "Done." : "Done — nothing to write (already live).");
  return ok ? 0 : 2;
}

/** Lines of open orders (not trashed, not delivered, returned or cancelled, not paid online — so not yet in the books)
 * whose recorded cost is missing or a catalog figure other than today's cost price; `cost` / `old` in minor units. */
async function uncostedOpenLines(factor: number, fixed: Array<{ id: string; cost: number }>) {
  // Today's cost: attar its recipe cost (`fixed`, minor units), anything else its catalog cost price.
  return prisma.$queryRaw<Array<{ id: string; sku: string; units: number; cost: number; old: number | null }>>`
    WITH f AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(fixed)}::jsonb) AS x(id text, cost int)),
    l AS (
      SELECT i.id, v.sku, (i.quantity - i."restockedQuantity")::int AS units, COALESCE(f.cost, ROUND(COALESCE(v."costPrice", p."costPrice") * ${factor})::int) AS cost,
             i."unitCostSnapshot" AS old, i."unitCostSource" AS source, i."costMovementId", o.id AS "orderId", o."deletedAt", o.status
      FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId" JOIN "ProductVariant" v ON v.id = i."variantId" JOIN "Product" p ON p.id = v."productId"
      LEFT JOIN f ON f.id = v.id
    )
    SELECT l.id, l.sku, l.units, l.cost, l.old FROM l
    WHERE l."costMovementId" IS NULL AND l."deletedAt" IS NULL
      AND (l.old IS NULL OR (l.source = 'CATALOG' AND l.old <> l.cost))
      AND l.status IN ('PENDING', 'CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED')
      AND l.cost > 0
      AND NOT EXISTS (SELECT 1 FROM "Payment" pm WHERE pm."orderId" = l."orderId" AND pm.status = 'SUCCEEDED')
      AND NOT EXISTS (SELECT 1 FROM "FinanceException" fe WHERE fe."orderId" = l."orderId" AND fe.kind = 'MISSING_COST')
    ORDER BY l.sku, l.id`;
}

/** Every finance check, read only (not recorded as a run). Inventory checks must be MATCHED once costing is live. */
async function printChecks(strict: boolean): Promise<boolean> {
  const ctx = await getFinanceContext();
  say("7. finance checks:");
  let ok = true;
  for (const key of RECONCILIATION_CHECK_KEYS) {
    let status: string, note = "";
    try {
      const r: { status: string; expected?: number | null; actual?: number | null } = await RECONCILIATION_CHECKS[key].run(ctx, {});
      status = r.status;
      if (r.expected != null && r.actual != null && r.status !== "MATCHED") note = ` expected ${taka(r.expected / 100)}, actual ${taka(r.actual / 100)}, difference ${taka((r.actual - r.expected) / 100)}`;
    } catch (e) {
      status = "ERROR";
      note = ` ${e instanceof Error ? e.message : String(e)}`;
    }
    const inventory = key.startsWith("inventory.");
    if (strict && inventory && status !== "MATCHED") ok = false;
    say(`   ${status.padEnd(15)} ${key}${note}${strict && inventory && status !== "MATCHED" ? "   ← must be MATCHED" : ""}`);
  }
  return ok;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => {
    const details = (e as { details?: unknown }).details;
    console.error(e instanceof Error ? `${e.message}${details ? ` ${JSON.stringify(details)}` : ""}` : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect())
  .then(() => process.exit());
