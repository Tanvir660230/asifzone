import { createHash } from "node:crypto";
import { z } from "zod";
import {
  METRIC_PRESETS,
  ORDER_QUEUE_FILTERS,
  ORDER_QUEUE_IDS,
  describeOrderTransitionConsequences,
  manualStockReasonEnum,
  metricDefinition,
  orderListQuerySchema,
  orderStatusEnum,
  orderTransitionContext,
  stockLevelStateEnum,
  stockLevelsQuerySchema,
  type AiResultCard,
  type OrderQueueId,
  type OrderStatus,
  type Permission,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { can, type AdminIdentity } from "../auth/authorization";
import { computeMetrics } from "../metrics/metrics.service";
import { listOrders, updateOrderStatus } from "../../modules/orders/order.service";
import { listStockLevels } from "../../modules/inventory/inventory-levels.service";
import { adjustVariantStock } from "../../modules/inventory/inventory.service";

/**
 * The AI assistant's tools (Blueprint V2 §T, DR-23). The model never touches data directly: it may only call these, each
 * validated by its schema and run through the same domain services a person uses, as the admin who asked.
 *
 *  - read    → runs at once and returns a minimised card (phones masked).
 *  - execute → never runs from the model. `preview` describes the change and fingerprints what it depends on; the
 *              assistant stores that as a proposal, and only an admin with ai.execute can confirm it
 *              (proposals.service), which re-checks the fingerprint and then calls `execute`.
 *
 * Effective permission = the admin's permissions ∩ the tool's permission ∩ (ai.execute for execute tools).
 */

export interface ToolPreview {
  title: string;
  effects: string[];
  /** The facts the change depends on; hashed, and re-checked at confirm time. */
  basis: unknown;
  href?: string;
}

interface ToolBase<S extends z.ZodTypeAny> {
  name: string;
  description: string;
  permission: Permission;
  schema: S;
  /** JSON schema the model sees (kept beside the zod schema it mirrors). */
  inputSchema: Record<string, unknown>;
}
export interface ReadTool<S extends z.ZodTypeAny = z.ZodTypeAny> extends ToolBase<S> {
  kind: "read";
  run(identity: AdminIdentity, input: z.infer<S>): Promise<AiResultCard>;
}
export interface ExecuteTool<S extends z.ZodTypeAny = z.ZodTypeAny> extends ToolBase<S> {
  kind: "execute";
  preview(identity: AdminIdentity, input: z.infer<S>): Promise<ToolPreview>;
  execute(identity: AdminIdentity, input: z.infer<S>): Promise<{ message: string; href?: string }>;
}
export type AiTool = ReadTool | ExecuteTool;

/** "01712345678" → "017•••••678": enough to tell customers apart, not enough to call them. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return phone.length > 6 ? `${phone.slice(0, 3)}${"•".repeat(phone.length - 6)}${phone.slice(-3)}` : "•••";
}

export function previewHash(basis: unknown): string {
  return createHash("sha256").update(JSON.stringify(basis)).digest("hex");
}

const rangeShape = {
  preset: z.enum(METRIC_PRESETS).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
};

const getMetrics: ReadTool = {
  kind: "read",
  name: "get_metrics",
  description:
    "Business numbers from the store's metrics registry (the same numbers as Analytics). Use registry keys such as realised_net_sales, orders_placed, orders_cancelled, aov, refunds, conversion_rate, return_rate, sessions, stock_on_hand, low_stock_variants. Money is in the store currency; ratios are 0–1. Default range: last_30_days.",
  permission: "analytics.read",
  schema: z.object({ metrics: z.array(z.string().max(60)).min(1).max(8), ...rangeShape }),
  inputSchema: {
    type: "object",
    properties: {
      metrics: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
      preset: { type: "string", enum: [...METRIC_PRESETS] },
      from: { type: "string", description: "YYYY-MM-DD (store timezone), with `to` instead of a preset" },
      to: { type: "string", description: "YYYY-MM-DD" },
    },
    required: ["metrics"],
  },
  async run(_identity, input) {
    const range = input.from || input.to ? { from: input.from ?? input.to!, to: input.to ?? input.from! } : { preset: input.preset ?? "last_30_days" };
    const result = await computeMetrics({ metrics: input.metrics, range });
    return {
      tool: "get_metrics",
      title: `Metrics · ${result.range.from} to ${result.range.to}`,
      rows: Object.entries(result.metrics).map(([key, v]) => ({ metric: metricDefinition(key)?.label ?? key, value: v.unit === "ratio" ? `${(v.value * 100).toFixed(1)}%` : v.value })),
      href: "/admin/analytics/overview",
    };
  },
};

const findOrders: ReadTool = {
  kind: "read",
  name: "find_orders",
  description: "Lists orders, newest first, optionally by work queue (e.g. needsAction, followUpDue, courierIssue, unpaid), status, or a search (order number, customer name, phone). Returns at most 20.",
  permission: "orders.read",
  schema: z.object({
    queue: z.enum(ORDER_QUEUE_IDS as unknown as [string, ...string[]]).optional(),
    status: orderStatusEnum.optional(),
    search: z.string().max(80).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  inputSchema: {
    type: "object",
    properties: {
      queue: { type: "string", enum: [...ORDER_QUEUE_IDS] },
      status: { type: "string", enum: orderStatusEnum.options },
      search: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    },
  },
  async run(_identity, input) {
    const query = orderListQuerySchema.parse({
      page: 1,
      pageSize: input.limit,
      ...(input.queue ? ORDER_QUEUE_FILTERS[input.queue as OrderQueueId] : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.search ? { search: input.search } : {}),
    });
    const { items, total } = await listOrders(query);
    return {
      tool: "find_orders",
      title: `${total} order${total === 1 ? "" : "s"}${items.length < total ? ` (showing ${items.length})` : ""}`,
      rows: items.map((o) => ({ order: o.orderNumber, status: o.status, total: Number(o.total), customer: o.customerName, phone: maskPhone(o.customerPhone), placed: o.createdAt.toISOString().slice(0, 10) })),
      href: input.queue ? `/admin/orders?f.queue=${input.queue}` : "/admin/orders",
    };
  },
};

async function orderByNumber(orderNumber: string) {
  const order = await prisma.order.findUnique({
    where: { orderNumber: orderNumber.trim().toUpperCase() },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      total: true,
      customerName: true,
      customerPhone: true,
      courierConsignmentId: true,
      courierStatus: true,
      couponId: true,
      followUpAt: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { items: true } },
    },
  });
  if (!order || order.deletedAt) throw AppError.notFound(`No order ${orderNumber}`);
  return order;
}

const getOrder: ReadTool = {
  kind: "read",
  name: "get_order",
  description: "One order by its order number (e.g. ORD-20261004-KKYMGO): status, payment, total, courier state, and which status moves are possible next.",
  permission: "orders.read",
  schema: z.object({ orderNumber: z.string().min(3).max(40) }),
  inputSchema: { type: "object", properties: { orderNumber: { type: "string" } }, required: ["orderNumber"] },
  async run(_identity, input) {
    const o = await orderByNumber(input.orderNumber);
    return {
      tool: "get_order",
      title: o.orderNumber,
      rows: [
        { field: "Status", value: o.status },
        { field: "Payment", value: `${o.paymentMethod} · ${o.paymentStatus}` },
        { field: "Total", value: Number(o.total) },
        { field: "Items", value: o._count.items },
        { field: "Customer", value: `${o.customerName} · ${maskPhone(o.customerPhone)}` },
        { field: "Courier", value: o.courierConsignmentId ? (o.courierStatus ?? "booked") : "not booked" },
        { field: "Placed", value: o.createdAt.toISOString().slice(0, 10) },
      ],
      href: `/admin/orders/${o.id}`,
    };
  },
};

const stockLevels: ReadTool = {
  kind: "read",
  name: "stock_levels",
  description: "Stock per variant (available, reserved by unshipped orders, days of cover), most urgent first. Filter by state (OUT_OF_STOCK, LOW_STOCK, IN_STOCK) or search a product name / SKU. At most 20.",
  permission: "inventory.read",
  schema: z.object({ state: stockLevelStateEnum.optional(), search: z.string().max(80).optional(), limit: z.number().int().min(1).max(20).default(10) }),
  inputSchema: {
    type: "object",
    properties: { state: { type: "string", enum: stockLevelStateEnum.options }, search: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } },
  },
  async run(_identity, input) {
    const result = await listStockLevels(stockLevelsQuerySchema.parse({ page: 1, pageSize: input.limit, ...(input.state ? { state: input.state } : {}), ...(input.search ? { search: input.search } : {}) }));
    return {
      tool: "stock_levels",
      title: `${result.total} variant${result.total === 1 ? "" : "s"}`,
      rows: result.items.map((v) => ({ product: v.productName, sku: v.sku, available: v.available, reserved: v.reserved, state: v.state, daysOfCover: v.daysOfCover })),
      href: "/admin/inventory",
    };
  },
};

const cancelOrder: ExecuteTool = {
  kind: "execute",
  name: "cancel_order",
  description: "Prepares cancelling one order (needs a reason the customer-facing team would accept). It is NOT cancelled until an admin confirms the proposal.",
  permission: "orders.manage",
  schema: z.object({ orderNumber: z.string().min(3).max(40), reason: z.string().trim().min(3).max(300) }),
  inputSchema: {
    type: "object",
    properties: { orderNumber: { type: "string" }, reason: { type: "string", description: "Why — saved on the order timeline" } },
    required: ["orderNumber", "reason"],
  },
  async preview(_identity, input) {
    const o = await orderByNumber(input.orderNumber);
    // Same-status moves are harmless no-ops in the state machine; for the assistant they'd be a pointless proposal.
    if (o.status === "CANCELLED") throw AppError.badRequest(`${o.orderNumber} is already cancelled`);
    const consequences = describeOrderTransitionConsequences(o.status as OrderStatus, "CANCELLED", orderTransitionContext(o));
    if (!consequences) throw AppError.badRequest(`${o.orderNumber} is ${o.status.toLowerCase()} and can't be cancelled`);
    const blocked = consequences.find((c) => c.tone === "blocked");
    if (blocked) throw AppError.badRequest(blocked.text);
    return {
      title: `Cancel ${o.orderNumber}`,
      effects: [`Reason: ${input.reason}`, ...consequences.map((c) => c.text)],
      basis: { id: o.id, status: o.status, paymentStatus: o.paymentStatus, courier: o.courierConsignmentId },
      href: `/admin/orders/${o.id}`,
    };
  },
  async execute(identity, input) {
    const o = await orderByNumber(input.orderNumber);
    await updateOrderStatus(o.id, { status: "CANCELLED", note: input.reason }, identity.adminId);
    return { message: `${o.orderNumber} is cancelled.`, href: `/admin/orders/${o.id}` };
  },
};

const adjustStock: ExecuteTool = {
  kind: "execute",
  name: "adjust_stock",
  description: "Prepares a stock adjustment for one variant by SKU: change is the number of units to add (+) or remove (−); reason is RESTOCK, ADJUSTMENT, DAMAGED or LOST. Nothing changes until an admin confirms.",
  permission: "inventory.adjust",
  schema: z.object({ sku: z.string().min(1).max(80), change: z.number().int().refine((v) => v !== 0, "Change can't be zero"), reason: manualStockReasonEnum, note: z.string().max(300).optional() }),
  inputSchema: {
    type: "object",
    properties: { sku: { type: "string" }, change: { type: "integer" }, reason: { type: "string", enum: manualStockReasonEnum.options }, note: { type: "string" } },
    required: ["sku", "change", "reason"],
  },
  async preview(_identity, input) {
    const v = await prisma.productVariant.findUnique({ where: { sku: input.sku.trim() }, select: { id: true, sku: true, stock: true, product: { select: { id: true, name: true } } } });
    if (!v) throw AppError.notFound(`No variant with SKU ${input.sku}`);
    if ((input.reason === "DAMAGED" || input.reason === "LOST") && input.change > 0) throw AppError.badRequest("Damaged or lost stock must be a negative change");
    if (input.reason === "RESTOCK" && input.change < 0) throw AppError.badRequest("A restock must add stock");
    const after = v.stock + input.change;
    if (after < 0) throw AppError.badRequest(`${v.sku} has ${v.stock} in stock — it can't go below zero`);
    return {
      title: `${input.change > 0 ? "Add" : "Remove"} ${Math.abs(input.change)} × ${v.product.name} (${v.sku})`,
      effects: [`Stock ${v.stock} → ${after}`, `Reason: ${input.reason.toLowerCase()}${input.note ? ` — ${input.note}` : ""}`, "Recorded in the stock movement history as this admin."],
      basis: { id: v.id, stock: v.stock },
      href: `/admin/inventory?tab=movements&variantId=${v.id}`,
    };
  },
  async execute(identity, input) {
    const v = await prisma.productVariant.findUniqueOrThrow({ where: { sku: input.sku.trim() }, select: { id: true, sku: true } });
    const updated = await adjustVariantStock(v.id, input.change, input.reason, identity.adminId, input.note ? `${input.note} (via AI assistant)` : "via AI assistant");
    return { message: `${v.sku} stock is now ${updated.stock}.`, href: `/admin/inventory?tab=movements&variantId=${v.id}` };
  },
};

export const AI_TOOLS: readonly AiTool[] = [getMetrics, findOrders, getOrder, stockLevels, cancelOrder, adjustStock];

export function aiTool(name: string): AiTool | undefined {
  return AI_TOOLS.find((t) => t.name === name);
}

/** The tools this admin may use: their permission ∩ the tool's ∩ (ai.execute for execute tools). */
export function toolsFor(identity: AdminIdentity): AiTool[] {
  return AI_TOOLS.filter((t) => can(identity, t.permission) && (t.kind === "read" || can(identity, "ai.execute")));
}
