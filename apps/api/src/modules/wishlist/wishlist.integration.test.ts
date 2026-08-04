import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";

const email = `vitest_wishlist_${Date.now()}@example.com`;
let cookies: string[] | undefined;
let productId: string;

describe("wishlist", () => {
  beforeAll(async () => {
    const registerRes = await request(app)
      .post("/api/customers/register")
      .send({ name: "Vitest Wishlist User", email, password: "SomePass123" });
    cookies = registerRes.get("Set-Cookie");

    const product = await prisma.product.findFirst();
    if (!product) throw new Error("Seed at least one product before running wishlist tests");
    productId = product.id;
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("starts empty", async () => {
    const res = await request(app).get("/api/wishlist").set("Cookie", cookies!);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("adds a product and lists it back with product details", async () => {
    const addRes = await request(app).post("/api/wishlist").set("Cookie", cookies!).send({ productId });
    expect(addRes.status).toBe(201);

    const listRes = await request(app).get("/api/wishlist").set("Cookie", cookies!);
    expect(listRes.body.items).toHaveLength(1);
    expect(listRes.body.items[0].product.id).toBe(productId);
  });

  it("is idempotent when the same product is added twice", async () => {
    await request(app).post("/api/wishlist").set("Cookie", cookies!).send({ productId });
    const listRes = await request(app).get("/api/wishlist").set("Cookie", cookies!);
    expect(listRes.body.items).toHaveLength(1);
  });

  it("removes a product", async () => {
    const removeRes = await request(app).delete(`/api/wishlist/${productId}`).set("Cookie", cookies!);
    expect(removeRes.status).toBe(204);

    const listRes = await request(app).get("/api/wishlist").set("Cookie", cookies!);
    expect(listRes.body.items).toEqual([]);
  });

  it("rejects requests without a customer session", async () => {
    const res = await request(app).get("/api/wishlist");
    expect(res.status).toBe(401);
  });
});
