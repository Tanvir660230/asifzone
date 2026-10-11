import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { asOwner, ownerId } from "../../test-fixtures";
import { getOrderStats } from "../orders/order.service";
import { adminAttention } from "./attention.service";

// Blueprint V2 PERF-03: one composite attention read for the shell, scoped to the caller's permissions.

afterAll(async () => {
  await prisma.$disconnect();
});

describe("admin attention composite", () => {
  it("returns every section for an owner, with the same order numbers as /api/orders/stats", async () => {
    const agent = await asOwner();
    const res = await agent.get("/api/v1/admin/attention");
    expect(res.status).toBe(200);
    expect(res.body.payments).not.toBeNull();
    expect(typeof res.body.pendingReviews).toBe("number");
    expect(typeof res.body.unreadFeedback).toBe("number");
    expect(typeof res.body.unreadNotifications).toBe("number");
    const stats = await getOrderStats();
    expect(res.body.orders).toMatchObject({ pending: stats.pending, needsAttention: stats.needsAttention, returnRequestsPending: stats.returnRequestsPending });
  });

  it("leaves out sections the admin may not read", async () => {
    const result = await adminAttention({ adminId: await ownerId(), role: "STAFF", permissions: ["orders.read"] });
    expect(result.orders).not.toBeNull();
    expect(result.payments).toBeNull();
    expect(result.pendingReviews).toBeNull();
    expect(result.unreadFeedback).toBeNull();
  });

  it("refuses an anonymous caller", async () => {
    expect((await request(app).get("/api/v1/admin/attention")).status).toBe(401);
  });
});
