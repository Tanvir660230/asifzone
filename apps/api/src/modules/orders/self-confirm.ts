import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { parseSelfConfirmCode, selfConfirmCode } from "./self-confirm-code";
import { applyOrderTransition, runTransitionSideEffects, type OrderTransitionOutcome } from "./order.service";
import { lockOrder } from "./confirmation.service";

/**
 * The customer confirms (or cancels) their own order from the order-placed SMS (docs/superpowers/plans/
 * 2026-11-08-order-outcomes-programme.md, PR 1). The link is `/c/<orderNumber>.<signature>`: the signature is an HMAC of
 * the order number, so the code is short enough for an SMS, can't be guessed for another order, and needs no table. It
 * only ever changes a PENDING cash-on-delivery order — the same transition and side effects as a confirmation call —
 * and records it like one (an OrderConfirmationAttempt with no admin), so the call queues drop the order on their own.
 */

export { parseSelfConfirmCode, selfConfirmCode };
export { SELF_CONFIRM_WAIT_MINUTES } from "./self-confirm-code";

export interface SelfConfirmView {
  orderNumber: string;
  status: string;
  total: number;
  shippingArea: string;
  items: { name: string; variantLabel: string; quantity: number; imageUrl: string | null }[];
  /** Still waiting for confirmation, and cash on delivery: the buttons are shown. */
  canAct: boolean;
}

const notFound = () => AppError.notFound("This link isn't valid");

async function orderFor(code: string) {
  const orderNumber = parseSelfConfirmCode(code);
  if (!orderNumber) throw notFound();
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      total: true,
      paymentMethod: true,
      shippingArea: true,
      shippingDistrict: true,
      deletedAt: true,
      items: {
        select: {
          productNameSnapshot: true,
          sizeSnapshot: true,
          colorSnapshot: true,
          quantity: true,
          productIdSnapshot: true,
        },
      },
    },
  });
  if (!order || order.deletedAt) throw notFound();
  // Each line's product photo (the line keeps the product id it was sold as; the first image is the cover).
  const productIds = [...new Set(order.items.map((i) => i.productIdSnapshot).filter((id): id is string => Boolean(id)))];
  const images = productIds.length
    ? await prisma.productImage.findMany({ where: { productId: { in: productIds } }, select: { productId: true, url: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })
    : [];
  const cover = new Map<string, string>();
  for (const img of images) if (!cover.has(img.productId)) cover.set(img.productId, img.url);
  return { ...order, cover };
}

const actionable = (o: { status: string; paymentMethod: string }) => o.status === "PENDING" && o.paymentMethod === "COD";

function view(o: Awaited<ReturnType<typeof orderFor>>): SelfConfirmView {
  return {
    orderNumber: o.orderNumber,
    status: o.status,
    total: Number(o.total),
    shippingArea: [o.shippingArea, o.shippingDistrict].filter(Boolean).join(", "),
    items: o.items.map((i) => ({
      name: i.productNameSnapshot,
      variantLabel: [i.colorSnapshot, i.sizeSnapshot].filter(Boolean).join(" / "),
      quantity: i.quantity,
      imageUrl: (i.productIdSnapshot && o.cover.get(i.productIdSnapshot)) || null,
    })),
    canAct: actionable(o),
  };
}

export async function getSelfConfirmView(code: string): Promise<SelfConfirmView> {
  return view(await orderFor(code));
}

/** Confirm or cancel as the customer. Anything but a PENDING COD order is returned as it is — a second tap, or an order
 * staff already handled, changes nothing and records nothing. */
export async function confirmBySelf(code: string, action: "confirm" | "cancel"): Promise<SelfConfirmView> {
  const order = await orderFor(code);
  const outcome = await prisma.$transaction(async (tx): Promise<OrderTransitionOutcome | null> => {
    const row = await lockOrder(tx, order.id);
    if (!actionable({ status: row.status, paymentMethod: order.paymentMethod })) return null;
    const confirm = action === "confirm";
    await tx.orderConfirmationAttempt.create({
      data: { orderId: order.id, adminId: null, outcome: confirm ? "CONFIRMED" : "DECLINED", note: "From the SMS link" },
    });
    const t = await applyOrderTransition(
      tx,
      order.id,
      { status: confirm ? "CONFIRMED" : "CANCELLED", note: confirm ? "Confirmed by the customer from the SMS link" : "Cancelled by the customer from the SMS link" },
      { adminId: null },
    );
    await tx.order.update({
      where: { id: order.id },
      data: { followUpAt: null, confirmationClaimedById: null, confirmationClaimedAt: null, ...(confirm ? { confirmationEscalatedAt: null, confirmationEscalationReason: null } : {}) },
    });
    return t;
  });
  if (outcome) await runTransitionSideEffects(outcome);
  return getSelfConfirmView(code);
}
