/**
 * Cost & profit planning (docs/COST_SHEET.md): what one sale of each size costs — making and selling — and what it earns.
 *
 * Each cost line is set at the nearest level that sets it — this size, the product, its category, the shop — else it is
 * worked out (AUTO) from what the books already know:
 *
 *   MAKING          the latest approved recipe at the materials' moving averages (a material without one: its reference
 *                   cost, marked an estimate); no recipe → the size's stock average → its cost price; else unknown
 *   PACKAGING       the active packing rules for a one-item parcel, at the materials' averages
 *   COURIER         the rate card: inside-Dhaka share × the Dhaka fee + the rest × the outside fee
 *   PAYMENT_FEE     COD % × the cash-on-delivery share + the gateway's % and fixed fee × the online share
 *   RETURN_RESERVE  return rate × what the courier keeps for a parcel that comes back
 *   ADS             the last 30 days' ad spend ÷ the orders placed in them
 *   LABOUR, OTHER   nothing unless set
 *
 * A cost that can't be worked out stays unknown — never 0 (docs/BUSINESS_DECISIONS.md P5-6) — and the sheet says so.
 * Every line is `fixed + percent × price`, so profit at any price, the most ads can cost before a sale loses money and
 * the price that reaches the target margin are all exact. A planning aid: nothing here is booked; the books keep the
 * real costs (planned vs actual compares them).
 */
import type { CostLineKind, CostLineMode, CostProfileScope, Prisma } from "@prisma/client";
import { COST_LINE_KINDS, costProfileSchema, type CostProfileInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { getFinanceContext } from "./finance-context";
import { financeError, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { packagingFor } from "./packaging.service";
import { rateCardFor, zoneOf } from "./charge-estimates";
import { loadRateCards } from "./charge-projection";

type Level = "VARIANT" | "PRODUCT" | "CATEGORY" | "BUSINESS";
export const DEFAULTS = { insideDhakaPct: 50, codPct: 100, targetMarginPct: 30 } as const;
const GATEWAYS = ["EPS_PG", "SSLCOMMERZ"];

/** One cost line of one size: `fixed` (minor units; null = unknown) + `percent` of the price. */
export interface LinePlan {
  kind: CostLineKind;
  label: string;
  /** Where it comes from: a level that set it, or AUTO (worked out). */
  from: Level | "AUTO";
  mode: CostLineMode;
  fixed: number | null;
  percent: number;
  /** How it was worked out, in words. */
  how: string;
  estimate: boolean;
}

export interface Assumptions { insideDhakaPct: number; codPct: number; returnRatePct: number; targetMarginPct: number }

/** Profit maths for one size at `price` (minor). Pure. */
export function economics(lines: LinePlan[], price: number, targetMarginPct: number) {
  const unknown = lines.filter((l) => l.fixed === null).map((l) => l.kind);
  const amountOf = (l: LinePlan) => (l.fixed === null ? null : Math.round(l.fixed + (l.percent / 100) * price));
  const fixed = lines.reduce((s, l) => s + (l.fixed ?? 0), 0);
  const percent = lines.reduce((s, l) => s + l.percent, 0);
  const total = lines.reduce((s, l) => s + (amountOf(l) ?? 0), 0);
  const ads = lines.find((l) => l.kind === "ADS");
  const withoutAds = total - (ads ? amountOf(ads) ?? 0 : 0);
  const denom = 1 - targetMarginPct / 100 - percent / 100;
  return {
    amounts: lines.map(amountOf),
    total,
    complete: unknown.length === 0,
    unknown,
    profit: price - total,
    marginPct: price > 0 ? Math.round(((price - total) / price) * 10_000) / 100 : null,
    /** The most ads can cost per sale before it earns nothing. */
    breakEvenAds: price - withoutAds,
    /** The price that leaves the target margin after every cost (null while a cost is unknown). */
    suggestedPrice: unknown.length || denom <= 0 ? null : Math.ceil(fixed / denom),
  };
}

const LABEL: Record<CostLineKind, string> = { MAKING: "Making", PACKAGING: "Parcel packing", COURIER: "Delivery", PAYMENT_FEE: "Payment fees", RETURN_RESERVE: "Returns", ADS: "Ads", LABOUR: "Labour", OTHER: "Other" };

interface LoadedLine { kind: CostLineKind; mode: CostLineMode; amount: Prisma.Decimal | null; label: string | null; variantId: string | null }
interface LoadedProfile { scope: CostProfileScope; scopeId: string; insideDhakaPct: Prisma.Decimal | null; codPct: Prisma.Decimal | null; returnRatePct: Prisma.Decimal | null; targetMarginPct: Prisma.Decimal | null; notes: string | null; updatedAt: Date; lines: LoadedLine[] }

/** Everything the sheets of `productIds` need, read once. */
async function load(productIds: string[]) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const since60 = new Date(Date.now() - 60 * 86_400_000);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, deletedAt: null, kind: "FINISHED" },
    select: { id: true, name: true, categoryId: true, basePrice: true, costPrice: true, fillToOrder: true, category: { select: { name: true } }, variants: { where: { isActive: true }, select: { id: true, sku: true, size: true, color: true, price: true, costPrice: true }, orderBy: [{ sortOrder: "asc" }, { sku: "asc" }] } },
    orderBy: { name: "asc" },
  });
  const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));
  const [profiles, boms, rules, rates, adSpend, orders, outcomes] = await Promise.all([
    prisma.costProfile.findMany({ where: { businessId: business.id }, select: { scope: true, scopeId: true, insideDhakaPct: true, codPct: true, returnRatePct: true, targetMarginPct: true, notes: true, updatedAt: true, lines: { select: { kind: true, mode: true, amount: true, label: true, variantId: true }, orderBy: { sortOrder: "asc" } } } }),
    prisma.billOfMaterials.findMany({
      where: { productId: { in: productIds }, status: "APPROVED" },
      orderBy: [{ productId: "asc" }, { version: "desc" }],
      select: { productId: true, version: true, lines: { where: { suppliedBy: "BUSINESS" }, select: { finishedVariantId: true, qtyPerUnit: true, wastagePct: true, materialVariantId: true, materialVariant: { select: { product: { select: { costPrice: true } } } } } } },
    }),
    prisma.packingRule.findMany({ where: { isActive: true }, select: { id: true, scope: true, scopeId: true, materialVariantId: true, quantity: true, per: true, createdAt: true, materialVariant: { select: { product: { select: { costPrice: true } } } } } }),
    loadRateCards(business.id, cur),
    prisma.adSpendDay.aggregate({ where: { date: { gte: since30 } }, _sum: { amount: true } }),
    prisma.order.count({ where: { deletedAt: null, createdAt: { gte: since30 }, status: { notIn: ["CANCELLED"] } } }),
    prisma.order.groupBy({ by: ["status"], where: { deletedAt: null, createdAt: { gte: since60 }, status: { in: ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED"] } }, _count: { _all: true } }),
  ]);
  const materialIds = [...new Set([...boms.flatMap((b) => b.lines.map((l) => l.materialVariantId)), ...rules.map((r) => r.materialVariantId)])];
  const states = await prisma.inventoryCostState.findMany({ where: { variantId: { in: [...materialIds, ...variantIds] } }, select: { variantId: true, avgUnitCost: true } });
  const avg = new Map(states.filter((s) => s.avgUnitCost !== null).map((s) => [s.variantId, Number(s.avgUnitCost)]));
  const delivered = outcomes.filter((o) => o.status !== "RETURNED").reduce((s, o) => s + o._count._all, 0);
  const returned = outcomes.find((o) => o.status === "RETURNED")?._count._all ?? 0;
  return {
    cur, products, profiles: profiles as LoadedProfile[], boms, rules, rates, avg,
    adsPerOrder: adSpend._sum.amount === null ? 0 : orders > 0 ? toMinor(adSpend._sum.amount, cur) / orders : null,
    adSpendMinor: adSpend._sum.amount === null ? 0 : toMinor(adSpend._sum.amount, cur),
    orders30: orders,
    returnRateActual: delivered + returned > 0 ? Math.round((returned / (delivered + returned)) * 10_000) / 100 : null,
  };
}
type Loaded = Awaited<ReturnType<typeof load>>;

const pick = <T>(...vals: Array<T | null | undefined>) => vals.find((v) => v !== null && v !== undefined) ?? null;

function assumptionsFor(d: Loaded, product: { id: string; categoryId: string }) {
  const own = d.profiles.find((p) => p.scope === "PRODUCT" && p.scopeId === product.id);
  const cat = d.profiles.find((p) => p.scope === "CATEGORY" && p.scopeId === product.categoryId);
  const shop = d.profiles.find((p) => p.scope === "BUSINESS");
  const one = (k: "insideDhakaPct" | "codPct" | "returnRatePct" | "targetMarginPct", fallback: number): { value: number; from: Level | "AUTO" } => {
    const v = pick(own?.[k], cat?.[k], shop?.[k]);
    const from: Level | "AUTO" = own?.[k] != null ? "PRODUCT" : cat?.[k] != null ? "CATEGORY" : shop?.[k] != null ? "BUSINESS" : "AUTO";
    return { value: v === null ? fallback : Number(v), from };
  };
  return {
    insideDhakaPct: one("insideDhakaPct", DEFAULTS.insideDhakaPct),
    codPct: one("codPct", DEFAULTS.codPct),
    returnRatePct: one("returnRatePct", d.returnRateActual ?? 0),
    targetMarginPct: one("targetMarginPct", DEFAULTS.targetMarginPct),
  };
}

/** The line a level sets for this size: the size's own line, then the product-wide one, then the category's, the shop's. */
function setLine(d: Loaded, product: { id: string; categoryId: string }, variantId: string, kind: CostLineKind): { line: LoadedLine; from: Level } | null {
  const own = d.profiles.find((p) => p.scope === "PRODUCT" && p.scopeId === product.id);
  const cat = d.profiles.find((p) => p.scope === "CATEGORY" && p.scopeId === product.categoryId);
  const shop = d.profiles.find((p) => p.scope === "BUSINESS");
  const v = own?.lines.find((l) => l.kind === kind && l.variantId === variantId);
  if (v && v.mode !== "AUTO") return { line: v, from: "VARIANT" };
  for (const [p, from] of [[own, "PRODUCT"], [cat, "CATEGORY"], [shop, "BUSINESS"]] as const) {
    const l = p?.lines.find((x) => x.kind === kind && !x.variantId);
    if (l && l.mode !== "AUTO") return { line: l, from };
  }
  return null;
}

// amounts in the "how" words are plain numbers in the shop's currency (the page shows the symbol)
const money = (minor: number, cur: string) => toMajorNumber(minor, cur).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function autoLine(d: Loaded, product: Loaded["products"][number], variant: Loaded["products"][number]["variants"][number], kind: CostLineKind, a: ReturnType<typeof assumptionsFor>): Omit<LinePlan, "kind" | "label" | "from" | "mode"> {
  const cur = d.cur;
  const today = new Date().toISOString().slice(0, 10);
  const card = rateCardFor(d.rates.cards, today);
  const s = a.insideDhakaPct.value / 100;
  const codShare = a.codPct.value / 100;
  const zoneFee = card ? s * zoneOf(card, "Dhaka", null).charge + (1 - s) * card.defaultCharge : null;
  switch (kind) {
    case "MAKING": {
      const bom = d.boms.find((b) => b.productId === product.id);
      const lines = bom?.lines.filter((l) => !l.finishedVariantId || l.finishedVariantId === variant.id) ?? [];
      if (lines.length) {
        let sum = 0;
        let estimate = false;
        for (const l of lines) {
          const unit = d.avg.get(l.materialVariantId) ?? (l.materialVariant.product.costPrice === null ? null : Number(l.materialVariant.product.costPrice));
          if (unit === null) return { fixed: null, percent: 0, how: `Recipe v${bom!.version} — a material has no cost yet`, estimate: false };
          if (!d.avg.has(l.materialVariantId)) estimate = true;
          sum += Number(l.qtyPerUnit) * (1 + Number(l.wastagePct) / 100) * unit;
        }
        return { fixed: toMinor(sum.toFixed(2), cur), percent: 0, how: `Recipe v${bom!.version} at today's material costs${estimate ? " (some are reference costs)" : ""}`, estimate };
      }
      const av = d.avg.get(variant.id);
      if (av !== undefined) return { fixed: toMinor(av.toFixed(2), cur), percent: 0, how: "Average cost of the stock", estimate: false };
      const cp = variant.costPrice ?? product.costPrice;
      if (cp !== null) return { fixed: toMinor(cp, cur), percent: 0, how: "Cost price on the product", estimate: true };
      return { fixed: null, percent: 0, how: "No recipe, stock cost or cost price", estimate: false };
    }
    case "PACKAGING": {
      const uses = packagingFor([{ variantId: variant.id, productId: product.id, categoryId: product.categoryId, quantity: 1 }], d.rules);
      if (!uses.size) return { fixed: 0, percent: 0, how: "No packing rule applies", estimate: false };
      let sum = 0;
      let estimate = false;
      for (const [materialId, qty] of uses) {
        const rule = d.rules.find((r) => r.materialVariantId === materialId)!;
        const unit = d.avg.get(materialId) ?? (rule.materialVariant.product.costPrice === null ? null : Number(rule.materialVariant.product.costPrice));
        if (unit === null) return { fixed: null, percent: 0, how: "A packing material has no cost yet", estimate: false };
        if (!d.avg.has(materialId)) estimate = true;
        sum += qty * unit;
      }
      return { fixed: toMinor(sum.toFixed(2), cur), percent: 0, how: "Packing rules for a one-item parcel", estimate };
    }
    case "COURIER":
      if (!card || zoneFee === null) return { fixed: null, percent: 0, how: "No courier rate card", estimate: false };
      return { fixed: Math.round(zoneFee), percent: 0, how: `${a.insideDhakaPct.value}% inside Dhaka ${money(zoneOf(card, "Dhaka", null).charge, cur)} · rest ${money(card.defaultCharge, cur)}`, estimate: false };
    case "PAYMENT_FEE": {
      if (!card) return { fixed: null, percent: 0, how: "No courier rate card", estimate: false };
      const fee = GATEWAYS.map((g) => rateCardFor(d.rates.fees.get(g) ?? [], today)).find(Boolean) ?? null;
      const online = 1 - codShare;
      if (online > 0 && !fee) return { fixed: null, percent: card.codPercent * codShare, how: `COD ${card.codPercent}% on ${a.codPct.value}% of sales; no gateway rate for the rest`, estimate: false };
      return {
        fixed: fee ? Math.round(fee.fixed * online) : 0,
        percent: card.codPercent * codShare + (fee ? fee.percent * online : 0),
        how: `COD ${card.codPercent}% on ${a.codPct.value}% of sales${fee && online > 0 ? ` · gateway ${fee.percent}% on the rest` : ""}`,
        estimate: false,
      };
    }
    case "RETURN_RESERVE":
      if (!card || zoneFee === null) return { fixed: null, percent: 0, how: "No courier rate card", estimate: false };
      return { fixed: Math.round((a.returnRatePct.value / 100) * zoneFee * (card.returnChargePercent / 100)), percent: 0, how: `${a.returnRatePct.value}% come back; the courier keeps ${card.returnChargePercent}% of the fee`, estimate: false };
    case "ADS":
      if (d.adsPerOrder === null) return { fixed: null, percent: 0, how: "Ad spend but no orders in the last 30 days", estimate: false };
      return { fixed: Math.round(d.adsPerOrder), percent: 0, how: d.adSpendMinor ? `Last 30 days: ${money(d.adSpendMinor, d.cur)} over ${d.orders30} orders` : "No ad spend in the last 30 days", estimate: false };
    default:
      return { fixed: 0, percent: 0, how: "None", estimate: false };
  }
}

function sheetOf(d: Loaded, product: Loaded["products"][number], tryPrice?: number) {
  const cur = d.cur;
  const a = assumptionsFor(d, product);
  const sizes = product.variants.map((v) => {
    const lines: LinePlan[] = COST_LINE_KINDS.map((kind) => {
      const set = setLine(d, product, v.id, kind);
      if (set) {
        const amt = Number(set.line.amount);
        return set.line.mode === "FIXED"
          ? { kind, label: set.line.label ?? LABEL[kind], from: set.from, mode: "FIXED" as const, fixed: toMinor(amt.toFixed(2), cur), percent: 0, how: "Set by you", estimate: false }
          : { kind, label: set.line.label ?? LABEL[kind], from: set.from, mode: "PERCENT_OF_PRICE" as const, fixed: 0, percent: amt, how: `${amt}% of the price`, estimate: false };
      }
      return { kind, label: LABEL[kind], from: "AUTO" as const, mode: "AUTO" as const, ...autoLine(d, product, v, kind, a) };
    });
    const priceMinor = toMinor(tryPrice ?? (v.price ?? product.basePrice), cur);
    const e = economics(lines, priceMinor, a.targetMarginPct.value);
    const major = (m: number | null) => (m === null ? null : toMajorNumber(m, cur));
    return {
      variantId: v.id,
      sku: v.sku,
      label: [v.size, v.color].filter((x) => x && x !== "Standard").join(" / ") || v.sku,
      price: toMajorNumber(priceMinor, cur),
      lines: lines.map((l, i) => ({ kind: l.kind, label: l.label, from: l.from, mode: l.mode, amount: major(e.amounts[i] ?? null), fixed: major(l.fixed), percent: l.percent, how: l.how, estimate: l.estimate })),
      total: toMajorNumber(e.total, cur),
      complete: e.complete,
      unknown: e.unknown,
      profit: toMajorNumber(e.profit, cur),
      marginPct: e.marginPct,
      breakEvenAds: toMajorNumber(e.breakEvenAds, cur),
      suggestedPrice: major(e.suggestedPrice),
      belowTarget: e.marginPct !== null && e.marginPct < a.targetMarginPct.value,
    };
  });
  return { productId: product.id, name: product.name, categoryId: product.categoryId, categoryName: product.category?.name ?? null, assumptions: a, sizes };
}

/** One product's cost sheet, with its own profile (what this product sets itself) for the editor. */
export async function productCostSheet(productId: string) {
  const d = await load([productId]);
  const product = d.products.find((p) => p.id === productId);
  if (!product) throw financeError(404, "PRODUCT_NOT_FOUND", "Product not found");
  const own = d.profiles.find((p) => p.scope === "PRODUCT" && p.scopeId === productId);
  return { ...sheetOf(d, product), own: own ? profileDto(own) : null, returnRateActual: d.returnRateActual };
}

/** Every product's sizes with their cost per sale, profit and margin — the Product costs list. */
export async function productCosts() {
  const ids = (await prisma.product.findMany({ where: { deletedAt: null, kind: "FINISHED", isActive: true }, select: { id: true } })).map((p) => p.id);
  const d = await load(ids);
  return {
    returnRateActual: d.returnRateActual,
    products: d.products.map((p) => {
      const s = sheetOf(d, p);
      return { ...s, sizes: s.sizes.map(({ lines, ...rest }) => ({ ...rest, making: lines.find((l) => l.kind === "MAKING")!.amount, selling: lines.filter((l) => l.kind !== "MAKING").reduce((t, l) => t + (l.amount ?? 0), 0) })) };
    }),
  };
}

function profileDto(p: LoadedProfile) {
  const n = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
  return { scope: p.scope, scopeId: p.scopeId, insideDhakaPct: n(p.insideDhakaPct), codPct: n(p.codPct), returnRatePct: n(p.returnRatePct), targetMarginPct: n(p.targetMarginPct), notes: p.notes, updatedAt: p.updatedAt, lines: p.lines.map((l) => ({ kind: l.kind, variantId: l.variantId, mode: l.mode, amount: n(l.amount), label: l.label })) };
}

/** The shop's and every category's own profile — the defaults page. */
export async function costDefaults() {
  const { business } = await getFinanceContext();
  const [profiles, categories] = await Promise.all([
    prisma.costProfile.findMany({ where: { businessId: business.id, scope: { in: ["BUSINESS", "CATEGORY"] } }, select: { scope: true, scopeId: true, insideDhakaPct: true, codPct: true, returnRatePct: true, targetMarginPct: true, notes: true, updatedAt: true, lines: { select: { kind: true, mode: true, amount: true, label: true, variantId: true }, orderBy: { sortOrder: "asc" } } } }),
    prisma.category.findMany({ where: { deletedAt: null, products: { some: { deletedAt: null, kind: "FINISHED" } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const shop = profiles.find((p) => p.scope === "BUSINESS");
  return {
    shop: shop ? profileDto(shop as LoadedProfile) : null,
    categories: categories.map((c) => {
      const p = profiles.find((x) => x.scope === "CATEGORY" && x.scopeId === c.id);
      return { id: c.id, name: c.name, profile: p ? profileDto(p as LoadedProfile) : null };
    }),
    defaults: DEFAULTS,
  };
}

/** Saves one level's profile (replacing its lines). An empty profile — nothing set — is removed. */
export async function saveCostProfile(scope: CostProfileScope, scopeId: string, raw: CostProfileInput, actor: FinanceActor) {
  const input = costProfileSchema.parse(raw);
  const { business } = await getFinanceContext();
  const key = scope === "BUSINESS" ? "" : scopeId;
  if (scope !== "BUSINESS" && !key) throw financeError(400, "COST_PROFILE_SCOPE", "Choose the category or product");
  if (scope === "CATEGORY" && !(await prisma.category.count({ where: { id: key, deletedAt: null } }))) throw financeError(404, "CATEGORY_NOT_FOUND", "Category not found");
  if (scope === "PRODUCT") {
    const p = await prisma.product.findFirst({ where: { id: key, deletedAt: null, kind: "FINISHED" }, select: { variants: { select: { id: true } } } });
    if (!p) throw financeError(404, "PRODUCT_NOT_FOUND", "Product not found");
    const own = new Set(p.variants.map((v) => v.id));
    if (input.lines.some((l) => l.variantId && !own.has(l.variantId))) throw financeError(400, "VARIANT_NOT_FOUND", "A size listed is not on this product");
  } else if (input.lines.some((l) => l.variantId)) throw financeError(400, "COST_LINE_SIZE", "Only a product's own sheet sets a cost for one size");
  const lines = input.lines.filter((l) => l.mode !== "AUTO");
  const empty = !lines.length && [input.insideDhakaPct, input.codPct, input.returnRatePct, input.targetMarginPct].every((v) => v === null || v === undefined) && !input.notes;
  return financeTransaction(async (tx) => {
    const before = await tx.costProfile.findUnique({ where: { businessId_scope_scopeId: { businessId: business.id, scope, scopeId: key } }, include: { lines: true } });
    if (empty) {
      if (before) await tx.costProfile.delete({ where: { id: before.id } });
    } else {
      const data = { insideDhakaPct: input.insideDhakaPct ?? null, codPct: input.codPct ?? null, returnRatePct: input.returnRatePct ?? null, targetMarginPct: input.targetMarginPct ?? null, notes: input.notes ?? null, updatedByAdminId: actor.type === "ADMIN" ? actor.adminId : null };
      const p = before
        ? await tx.costProfile.update({ where: { id: before.id }, data })
        : await tx.costProfile.create({ data: { businessId: business.id, scope, scopeId: key, ...data } });
      await tx.costProfileLine.deleteMany({ where: { profileId: p.id } });
      if (lines.length) await tx.costProfileLine.createMany({ data: lines.map((l, i) => ({ profileId: p.id, kind: l.kind, mode: l.mode, amount: l.amount!, label: l.label ?? null, variantId: l.variantId ?? null, sortOrder: i })) });
    }
    await recordFinanceAudit(tx, {
      businessId: business.id, actor, action: "cost_profile.save", entityType: "CostProfile", entityId: before?.id ?? `${scope}:${key}`,
      before: before ? { lines: before.lines.map((l) => `${l.kind}${l.variantId ? `@${l.variantId}` : ""}=${l.mode}:${l.amount}`), targetMarginPct: before.targetMarginPct?.toString() ?? null } : null,
      after: empty ? null : { lines: lines.map((l) => `${l.kind}${l.variantId ? `@${l.variantId}` : ""}=${l.mode}:${l.amount}`), targetMarginPct: input.targetMarginPct ?? null },
    });
    return { scope, scopeId: key, removed: empty };
  });
}
