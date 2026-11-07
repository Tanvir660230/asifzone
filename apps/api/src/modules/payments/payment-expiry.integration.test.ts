import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, placeOrder } from "../../test-fixtures";
import { getProviders } from "../../providers/registry";
import type { EpsCheck } from "../../providers/payment/eps";
import { EPS_UNREACHABLE_GRACE_MS, expireStalePaymentSessions } from "./payment.service";

// EPS has no webhook. A session past its window is asked one last time before it expires, and an EPS outage never
// expires a session a customer may have paid (live 2026-11-06: EPS timed out and sessions expired unconfirmed).

const HOUR = 60 * 60 * 1000;
const made: string[] = [];

async function epsSession(expiredAgoMs: number) {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 700 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  const ref = `exp_${order.id}`;
  await prisma.paymentSession.create({
    data: { orderId: order.id, provider: "EPS_PG", status: "ACTIVE", gatewayTransactionRef: ref, expiresAt: new Date(Date.now() - expiredAgoMs), amount: order.total },
  });
  made.push(ref);
  return { order, ref };
}

function epsAnswers(answers: Record<string, EpsCheck>) {
  vi.spyOn(getProviders().payments.adapter("EPS_PG"), "check").mockImplementation(async (ref: string) => answers[ref] ?? { kind: "NO_RECORD" });
}
const statusOf = async (ref: string) => (await prisma.paymentSession.findUniqueOrThrow({ where: { gatewayTransactionRef: ref } })).status;

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("expiring EPS sessions", () => {
  it("keeps a session open while EPS does not answer, and expires it once the grace is over", async () => {
    const recent = await epsSession(HOUR);
    const old = await epsSession(EPS_UNREACHABLE_GRACE_MS + HOUR);
    epsAnswers({ [recent.ref]: { kind: "UNREACHABLE" }, [old.ref]: { kind: "UNREACHABLE" } });
    await expireStalePaymentSessions();
    expect(await statusOf(recent.ref)).toBe("ACTIVE");
    expect(await statusOf(old.ref)).toBe("EXPIRED");
  });

  it("settles a session EPS confirms was paid instead of expiring it", async () => {
    const { order, ref } = await epsSession(HOUR);
    epsAnswers({ [ref]: { kind: "FOUND", result: { merchantTransactionId: ref, epsTransactionId: `EPS-${order.id}`, amount: Number(order.total), status: "Success" } } });
    await expireStalePaymentSessions();
    expect(await statusOf(ref)).toBe("SUCCEEDED");
    expect(await prisma.payment.count({ where: { orderId: order.id, status: "SUCCEEDED", provider: "EPS_PG" } })).toBe(1);
  });

  it("expires a session EPS has no payment for, or one it reports as not paid", async () => {
    const none = await epsSession(HOUR);
    const failed = await epsSession(HOUR);
    epsAnswers({
      [none.ref]: { kind: "NO_RECORD" },
      [failed.ref]: { kind: "FOUND", result: { merchantTransactionId: failed.ref, epsTransactionId: "", amount: 0, status: "Failed" } },
    });
    await expireStalePaymentSessions();
    expect(await statusOf(none.ref)).toBe("EXPIRED");
    expect(await statusOf(failed.ref)).toBe("EXPIRED");
  });
});
