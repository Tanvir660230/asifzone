import { z } from "zod";
import { BD_DELIVERY_TIME_TEXT, normalizeBdPhone } from "@clothing-brand/shared";
import { prisma } from "../../../config/prisma";
import { env } from "../../../config/env";
import { priceProductsForDisplay } from "../../../domain/pricing/pricing.service";
import { suggestSearch } from "../../products/product.service";
import { getSettings } from "../../settings/settings.service";

/**
 * What the Inbox AI may look up — read-only, and only what a shopper could see on the website anyway. Order status is
 * the one personal lookup, so it has an access rule (see orderStatus).
 */

export interface AssistContext {
  channel: "WEB_FORM" | "EMAIL" | "SMS" | "WHATSAPP" | "MESSENGER" | "INSTAGRAM" | "FB_COMMENT";
  /** The conversation's phone; on WhatsApp this is the sender's own number, proven by WhatsApp. */
  phone: string | null;
}

export type IntentName = "price" | "stock" | "delivery_charge" | "order_status" | "how_to_order" | "other";
export const INTENTS = ["price", "stock", "delivery_charge", "order_status", "how_to_order", "other"] as const;

export interface ToolOutcome {
  /** JSON handed back to the model. */
  content: string;
  /** The intents this result can back up as an auto-sent answer (empty when it found nothing). */
  backs: IntentName[];
}

const siteUrl = () => env.webOrigin.replace(/\/+$/, "");
const LOW_STOCK = 3;

// ── find_products ───────────────────────────────────────────────────────────────────────────────

const findProductsInput = z.object({ query: z.string().trim().min(1).max(120) });

async function findProducts(input: unknown): Promise<ToolOutcome> {
  const { query } = findProductsInput.parse(input);
  const { products: hits } = await suggestSearch(query, 5);
  if (hits.length === 0) return { content: JSON.stringify({ products: [], note: "Nothing on the website matches. Do not guess — leave a draft for staff." }), backs: [] };
  const rows = await prisma.product.findMany({
    where: { id: { in: hits.map((h) => h.id) }, isActive: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      basePrice: true,
      compareAtPrice: true,
      markedSoldOut: true,
      variants: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, size: true, sizeLabel: true, color: true, price: true, compareAtPrice: true, isActive: true, stock: true, markedSoldOut: true },
      },
    },
  });
  const pricing = await priceProductsForDisplay(rows);
  const order = new Map(hits.map((h, i) => [h.id, i]));
  const products = rows
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
    .map((p) => {
      const price = pricing.get(p.id);
      return {
        name: p.name,
        url: `${siteUrl()}/product/${p.slug}`,
        price: price ? (price.from === price.to ? price.from : { from: price.from, to: price.to }) : Number(p.basePrice),
        regularPrice: price?.compareAt ?? null,
        flashSale: Boolean(price?.flash),
        options: p.variants.map((v) => {
          const available = !p.markedSoldOut && !v.markedSoldOut && v.stock > 0;
          return {
            size: v.sizeLabel || v.size,
            ...(v.color ? { color: v.color } : {}),
            price: price?.variants[v.id]?.selling ?? null,
            inStock: available,
            ...(available && v.stock <= LOW_STOCK ? { fewLeft: true } : {}),
          };
        }),
      };
    });
  return { content: JSON.stringify({ products, currency: "BDT (taka)" }), backs: products.length ? ["price", "stock"] : [] };
}

// ── delivery_charges ────────────────────────────────────────────────────────────────────────────

async function deliveryCharges(): Promise<ToolOutcome> {
  const [zones, settings] = await Promise.all([
    prisma.shippingZone.findMany({ where: { isActive: true }, orderBy: [{ priority: "desc" }, { name: "asc" }], select: { name: true, isDefault: true, rate: { select: { fee: true, freeOverAmount: true } } } }),
    getSettings(),
  ]);
  const priced = zones.filter((z) => z.rate);
  const content = {
    zones: priced.map((z) => ({
      area: z.name,
      fee: Number(z.rate!.fee),
      freeDeliveryFrom: z.rate!.freeOverAmount === null ? null : Number(z.rate!.freeOverAmount),
      ...(z.isDefault ? { appliesTo: "everywhere not covered by another zone" } : {}),
    })),
    cashOnDelivery: settings.codEnabled,
    deliveryTime: `${BD_DELIVERY_TIME_TEXT} An estimate, not a promise.`,
    currency: "BDT (taka)",
  };
  return { content: JSON.stringify(content), backs: priced.length ? ["delivery_charge"] : [] };
}

// ── order_status ────────────────────────────────────────────────────────────────────────────────

const orderStatusInput = z.object({ orderNumber: z.string().trim().max(40).optional(), phone: z.string().trim().max(20).optional() });

const STATUS_WORDS: Record<string, string> = {
  PENDING: "received, waiting for confirmation",
  CONFIRMED: "confirmed",
  PROCESSING: "being prepared",
  PACKED: "packed, waiting for the courier",
  SHIPPED: "handed to the courier, on the way",
  DELIVERED: "delivered",
  PARTIALLY_DELIVERED: "partly delivered",
  CANCELLED: "cancelled",
  RETURNED: "returned",
};

/**
 * Anyone can type any phone number into Messenger, so a number alone proves nothing. Access rule:
 * - WhatsApp: the sender's own number (WhatsApp proves it) finds that number's orders;
 * - otherwise the customer must give the order number AND the phone it was placed with, and both must match one order.
 * Never returns the address, the customer's name or the full phone.
 */
async function orderStatus(input: unknown, ctx: AssistContext): Promise<ToolOutcome> {
  const { orderNumber, phone } = orderStatusInput.parse(input);
  const select = { orderNumber: true, status: true, total: true, createdAt: true, courierTrackingLink: true } as const;
  let orders: Array<{ orderNumber: string; status: string; total: unknown; createdAt: Date; courierTrackingLink: string | null }> = [];

  if (ctx.channel === "WHATSAPP" && ctx.phone) {
    orders = await prisma.order.findMany({
      where: { customerPhone: normalizeBdPhone(ctx.phone), deletedAt: null, ...(orderNumber ? { orderNumber } : {}) },
      orderBy: { createdAt: "desc" },
      take: 3,
      select,
    });
  } else if (orderNumber && phone) {
    const order = await prisma.order.findFirst({ where: { orderNumber, customerPhone: normalizeBdPhone(phone), deletedAt: null }, select });
    orders = order ? [order] : [];
  } else {
    return {
      content: JSON.stringify({ error: "verify", ask: "Ask the customer for their order number and the phone number the order was placed with." }),
      // Nothing was looked up, so nothing backs a status — whatever the model writes waits for staff.
      backs: [],
    };
  }

  if (orders.length === 0) {
    return { content: JSON.stringify({ orders: [], note: "No order matches. Do not guess — leave a draft for staff." }), backs: [] };
  }
  return {
    content: JSON.stringify({
      orders: orders.map((o) => ({
        orderNumber: o.orderNumber,
        status: STATUS_WORDS[o.status] ?? o.status.toLowerCase(),
        total: Number(o.total),
        placedOn: o.createdAt.toISOString().slice(0, 10),
        courierTracking: o.courierTrackingLink,
      })),
      trackOnWebsite: `${siteUrl()}/track-order`,
    }),
    backs: ["order_status"],
  };
}

// ── respond (terminal) ──────────────────────────────────────────────────────────────────────────

export const respondInput = z.object({
  action: z.enum(["auto", "draft", "none"]),
  intent: z.enum(INTENTS),
  body: z.string().trim().max(1000).default(""),
});
export type RespondInput = z.infer<typeof respondInput>;

// ── Catalog ─────────────────────────────────────────────────────────────────────────────────────

export const ASSIST_TOOLS = [
  {
    name: "find_products",
    description: "Search the store's published products. Returns name, website link, current price (flash sale included), and which sizes/colours are in stock.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "What the customer is asking about, e.g. 'black panjabi' or a product name." } }, required: ["query"] },
  },
  {
    name: "delivery_charges",
    description: "Delivery fee per area, the free-delivery threshold if any, how many days delivery usually takes, and whether cash on delivery is available.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "order_status",
    description:
      "Status of the customer's order. On WhatsApp call it with no input (the sender's number is used). Elsewhere it needs BOTH the order number and the phone number the order was placed with — if either is missing, it tells you to ask for them.",
    input_schema: { type: "object", properties: { orderNumber: { type: "string" }, phone: { type: "string" } } },
  },
  {
    name: "respond",
    description:
      "Finish: give your reply. action 'auto' = a complete factual answer backed by what the tools returned (it may be sent to the customer directly); 'draft' = staff should check or finish it; 'none' = no reply is needed (thanks, ok, a sticker).",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["auto", "draft", "none"] },
        intent: { type: "string", enum: [...INTENTS] },
        body: { type: "string", description: "The reply exactly as the customer should read it. Empty for 'none'." },
      },
      required: ["action", "intent", "body"],
    },
  },
] as const;

export async function runAssistTool(name: string, input: unknown, ctx: AssistContext): Promise<ToolOutcome> {
  switch (name) {
    case "find_products":
      return findProducts(input);
    case "delivery_charges":
      return deliveryCharges();
    case "order_status":
      return orderStatus(input, ctx);
    default:
      return { content: JSON.stringify({ error: `Unknown tool ${name}` }), backs: [] };
  }
}
