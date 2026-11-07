import { afterAll, describe, expect, it, vi } from "vitest";

// A store with no courier account (Nasihamart before it books with Steadfast): the daily check still counts its queues and
// is OK; "not configured" is not an error (it was logged as one every morning on live).
vi.mock("../../domain/shipments/courier-evidence", async () => {
  const { AppError } = (await vi.importActual("../../lib/app-error")) as { AppError: { badRequest: (m: string) => Error } };
  return {
    syncCourierPayouts: vi.fn(async () => {
      throw AppError.badRequest("Steadfast is not configured — set STEADFAST_API_KEY/STEADFAST_SECRET_KEY");
    }),
  };
});
const captured = vi.hoisted(() => ({ errors: [] as unknown[] }));
vi.mock("../../lib/observability/error-capture", () => ({ captureError: (err: unknown) => captured.errors.push(err) }));

import { prisma } from "../../config/prisma";
import { runCourierAutomation } from "./courier-automation.service";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("courier automation without a courier account", () => {
  it("is OK, says payouts were not checked, and logs no error", async () => {
    const run = await runCourierAutomation();
    expect(run.outcome).toBe("OK");
    expect(run.message).toMatch(/No courier account/);
    expect(captured.errors).toEqual([]);
  });
});
