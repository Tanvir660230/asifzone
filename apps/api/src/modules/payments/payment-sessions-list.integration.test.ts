import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner } from "../../test-fixtures";
import { listPaymentSessions } from "./payment-ledger-lists.service";

// Finance › Online attempts (Blueprint V2 P5): every gateway checkout attempt — including the failed storefront ones that
// never became an order — findable by the customer's phone or the gateway reference. Read-only.

const RUN = Date.now().toString(36);
const PHONE = "01912" + String(Date.now()).slice(-6);
const ids: string[] = [];

afterAll(async () => {
  await prisma.paymentSession.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

async function attempt(status: "FAILED" | "ACTIVE", ref: string) {
  const s = await prisma.paymentSession.create({
    data: {
      provider: "SSLCOMMERZ",
      status,
      gatewayTransactionRef: ref,
      amount: 1250,
      expiresAt: new Date(Date.now() + 48 * 3600_000),
      checkoutPayload: { input: { customerName: "Attempt Customer", customerPhone: PHONE }, pricing: { total: 1250 } },
      events: status === "FAILED" ? { create: { type: "FAILED", note: "Card declined by issuer" } } : undefined,
    },
  });
  ids.push(s.id);
  return s;
}

describe("payment attempts list", () => {
  it("finds a failed checkout with no order by the customer's phone, with the gateway's last message", async () => {
    await attempt("FAILED", `vt-${RUN}-1`);
    await attempt("ACTIVE", `vt-${RUN}-2`);
    const { items, total } = await listPaymentSessions({ page: 1, pageSize: 20, search: PHONE });
    expect(total).toBe(2);
    const failed = items.find((i) => i.gatewayRef === `vt-${RUN}-1`)!;
    expect(failed).toMatchObject({ status: "FAILED", provider: "SSLCOMMERZ", amount: 1250, order: null, customerName: "Attempt Customer", customerPhone: PHONE });
    expect(failed.lastEvent).toMatchObject({ type: "FAILED", note: "Card declined by issuer" });
  });

  it("filters by result and finds by gateway reference", async () => {
    const failed = await listPaymentSessions({ page: 1, pageSize: 20, search: PHONE, status: "FAILED" });
    expect(failed.items.map((i) => i.gatewayRef)).toEqual([`vt-${RUN}-1`]);
    const byRef = await listPaymentSessions({ page: 1, pageSize: 20, search: `vt-${RUN}-2` });
    expect(byRef.items.map((i) => i.status)).toEqual(["ACTIVE"]);
  });

  it("serves the list over HTTP to payments.read", async () => {
    const agent = await asOwner();
    const res = await agent.get(`/api/payment-admin/sessions?search=${PHONE}&status=FAILED`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});
