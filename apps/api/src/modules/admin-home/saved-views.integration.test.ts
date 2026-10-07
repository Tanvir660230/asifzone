import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/prisma";
import { asOwner, ownerId } from "../../test-fixtures";
import { createSavedView, deleteSavedView, listSavedViews } from "./saved-views.service";

// Admin V2 DR-18: saved list views live in the database — personal by default, optionally shared with the team.

const LIST = `vt-orders-${Date.now().toString(36)}`;
let owner: string;
let other: string;

beforeAll(async () => {
  owner = await ownerId();
  other = (await prisma.adminUser.create({ data: { name: "DR18 Other", email: `dr18-${LIST}@example.com`, passwordHash: await bcrypt.hash("x", 4), role: "STAFF" } })).id;
});

afterAll(async () => {
  await prisma.savedView.deleteMany({ where: { listKey: LIST } });
  await prisma.adminUser.delete({ where: { id: other } });
  await prisma.$disconnect();
});

describe("saved views (DR-18)", () => {
  it("a personal view is the creator's only; a shared one reaches the team", async () => {
    const personal = await createSavedView(owner, { listKey: LIST, label: "Dhaka COD", query: "f.district=Dhaka&f.payment=COD" });
    const shared = await createSavedView(owner, { listKey: LIST, label: "Big orders", query: "f.minTotal=5000", shared: true });
    expect((await listSavedViews(owner, LIST)).map((v) => v.id)).toEqual([personal.id, shared.id]);
    const theirs = await listSavedViews(other, LIST);
    expect(theirs.map((v) => v.id)).toEqual([shared.id]);
    expect(theirs[0]).toMatchObject({ mine: false, shared: true, createdBy: expect.any(String) });
  });

  it("only the creator deletes a view", async () => {
    const [shared] = (await listSavedViews(other, LIST)).filter((v) => v.shared);
    await expect(deleteSavedView(other, shared!.id)).rejects.toMatchObject({ statusCode: 404 });
    await deleteSavedView(owner, shared!.id);
    expect(await listSavedViews(other, LIST)).toEqual([]);
  });

  it("serves the views over HTTP and validates the input", async () => {
    const agent = await asOwner();
    const created = await agent.post("/api/v1/admin/views", { listKey: LIST, label: "  Unpaid  ", query: "f.queue=unpaid" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ label: "Unpaid", mine: true, shared: false });
    expect((await agent.post("/api/v1/admin/views", { listKey: LIST, label: "", query: "" })).status).toBe(400);
    expect((await agent.post("/api/v1/admin/views", { listKey: "Bad Key!", label: "x", query: "" })).status).toBe(400);
    const listed = await agent.get(`/api/v1/admin/views?list=${LIST}`);
    expect(listed.body.items.map((v: { label: string }) => v.label)).toContain("Unpaid");
    expect((await agent.delete(`/api/v1/admin/views/${created.body.id}`)).status).toBe(204);
  });
});
