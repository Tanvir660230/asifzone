import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, ownerId } from "../../test-fixtures";
import { auditEntityType } from "../../middlewares/audit";

// Admin V2: audit viewer filters, the request-id envelope, and entity naming for /api/v1 writes.

const LIST = `vt-audit-${Date.now().toString(36)}`;

afterAll(async () => {
  await prisma.savedView.deleteMany({ where: { listKey: LIST } });
  await prisma.$disconnect();
});

describe("audit entity naming", () => {
  it("names the area past /api, /v1 and the /admin group", () => {
    expect(auditEntityType("/api/orders", "/abc/status")).toBe("orders");
    expect(auditEntityType("/api/v1/outbox", "/e1/retry")).toBe("outbox");
    expect(auditEntityType("/api/v1/admin", "/views")).toBe("views");
    expect(auditEntityType("/api/v1/admin", "/views/x1")).toBe("views");
  });
});

describe("audit viewer", () => {
  it("records a v1 write under its real area with the request id, and filters find it", async () => {
    const agent = await asOwner();
    const created = await agent.post("/api/v1/admin/views", { listKey: LIST, label: "Audit probe", query: "" });
    expect(created.status).toBe(201);

    // The generic audit row is written on response finish — wait for it.
    let row = null as Awaited<ReturnType<typeof prisma.auditLog.findFirst>>;
    for (let i = 0; i < 20 && !row; i++) {
      row = await prisma.auditLog.findFirst({ where: { entityId: created.body.id } });
      if (!row) await new Promise((r) => setTimeout(r, 50));
    }
    expect(row).toMatchObject({ entityType: "views", action: "views.create" });
    const requestId = (row!.metadata as Record<string, unknown>).requestId as string;
    expect(requestId).toEqual(expect.any(String));

    const byArea = await agent.get(`/api/audit-logs?entityType=views&action=create&adminId=${await ownerId()}`);
    expect(byArea.status).toBe(200);
    expect(byArea.body.items.map((i: { id: string }) => i.id)).toContain(row!.id);
    const byRequest = await agent.get(`/api/audit-logs?requestId=${requestId}`);
    expect(byRequest.body.items.map((i: { id: string }) => i.id)).toEqual([row!.id]);
    const byEntity = await agent.get(`/api/audit-logs?entityId=${created.body.id.slice(0, 8)}`);
    expect(byEntity.body.items.map((i: { id: string }) => i.id)).toContain(row!.id);

    const facets = await agent.get("/api/audit-logs/facets");
    expect(facets.body.entityTypes).toContain("views");
    expect(facets.body.admins.length).toBeGreaterThan(0);
  });

  it("rejects malformed filters", async () => {
    const agent = await asOwner();
    expect((await agent.get("/api/audit-logs?from=yesterday")).status).toBe(400);
  });
});
