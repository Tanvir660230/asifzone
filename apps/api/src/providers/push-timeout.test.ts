import { afterAll, describe, expect, it, vi } from "vitest";

// Phase 12 W6 (contract P-3): a push send that never completes is cut off at PUSH_TIMEOUT_MS. The VAPID keys are supplied
// through a config mock (vapidConfigured is read when the module loads) and web-push itself is stubbed — no network.
vi.mock("../config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/env")>();
  return { ...actual, env: { ...actual.env, webPush: { ...actual.env.webPush, publicKey: "test-public", privateKey: "test-private" } } };
});
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(() => new Promise(() => undefined)) } }));

import { PUSH_TIMEOUT_MS, sendPush } from "./push/web-push";

afterAll(() => vi.useRealTimers());

describe("Web Push — bounded by PUSH_TIMEOUT_MS", () => {
  it("a send that never completes rejects after 10 s (as a TimeoutError) instead of hanging the campaign", async () => {
    expect(PUSH_TIMEOUT_MS).toBe(10_000);
    vi.useFakeTimers();
    let settled = false;
    const outcome = sendPush({ subscription: { endpoint: "https://push.example/e", p256dh: "p", auth: "a" }, title: "t", body: "b" })
      .then(
        () => "sent",
        (e: Error) => `${e.name}: ${e.message}`,
      )
      .finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(PUSH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await outcome).toBe(`TimeoutError: [push] send timed out after ${PUSH_TIMEOUT_MS} ms`);
  });
});
