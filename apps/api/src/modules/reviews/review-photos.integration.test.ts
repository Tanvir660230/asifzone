import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createReviewSchema, REVIEW_IMAGE_LIMIT } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signCustomerAccessToken } from "../../lib/customer-jwt";
import { CUSTOMER_ACCESS_COOKIE } from "../../lib/cookies";
import { cleanupFixtures, createStockedProduct, RUN } from "../../test-fixtures";
import { deleteSiteImageFile } from "../uploads/upload.service";
import { createReview, listReviewsForProduct, moderateReview } from "./review.service";

// Photo reviews: a signed-in customer uploads up to four photos (re-encoded on the server, so camera metadata such as GPS
// never reaches the store) and attaches them to the review; they appear publicly only once the review is approved.

const CSRF = "vitest-csrf";
const uploaded: string[] = [];
const customerIds: string[] = [];

afterAll(async () => {
  await Promise.all(uploaded.map((url) => deleteSiteImageFile(url)));
  await prisma.productReview.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function customer() {
  const row = await prisma.customer.create({
    data: { name: `Vitest Reviewer ${RUN}`, email: `reviewer-${RUN}-${customerIds.length}@example.test`, phone: `0171${String(Date.now()).slice(-7)}` },
  });
  customerIds.push(row.id);
  return row;
}

const asCustomer = (customerId: string) => (r: request.Test) =>
  r.set("Cookie", [`${CUSTOMER_ACCESS_COOKIE}=${signCustomerAccessToken({ customerId })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);

const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: "#808080" } }).png().toBuffer();

describe("review photo schema", () => {
  const base = { productId: "ckxxxxxxxxxxxxxxxxxxxxxxx", rating: 5, body: "Lovely fabric and fit." };
  const ref = (n: number) => `/uploads/reviews/00000000-0000-4000-8000-${String(n).padStart(12, "0")}.webp`;

  it("accepts the store's own review uploads, up to the limit", () => {
    expect(createReviewSchema.parse({ ...base, images: [ref(1), ref(2)] }).images).toHaveLength(2);
    expect(createReviewSchema.parse(base).images).toEqual([]);
  });

  it("rejects other URLs and too many photos", () => {
    expect(createReviewSchema.safeParse({ ...base, images: ["https://evil.test/a.webp"] }).success).toBe(false);
    expect(createReviewSchema.safeParse({ ...base, images: ["/uploads/products/x-full.webp"] }).success).toBe(false);
    const tooMany = Array.from({ length: REVIEW_IMAGE_LIMIT + 1 }, (_, i) => ref(i));
    expect(createReviewSchema.safeParse({ ...base, images: tooMany }).success).toBe(false);
  });
});

describe("POST /api/reviews/images", () => {
  it("needs a signed-in customer", async () => {
    const res = await request(app).post("/api/reviews/images").set("Cookie", [`csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF).attach("image", await png(), "a.png");
    expect(res.status).toBe(401);
  });

  it("stores a re-encoded photo and returns its reference", async () => {
    const { id } = await customer();
    const res = await asCustomer(id)(request(app).post("/api/reviews/images")).attach("image", await png(), "a.png");
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/uploads\/reviews\/[0-9a-f-]{36}\.webp$/);
    uploaded.push(res.body.url);
  });

  it("refuses a file that is not an image", async () => {
    const { id } = await customer();
    const res = await asCustomer(id)(request(app).post("/api/reviews/images")).attach("image", Buffer.from("not an image"), { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(400);
  });
});

describe("reviews with photos", () => {
  it("keeps the photos and shows them once the review is approved", async () => {
    const { product } = await createStockedProduct({ stocks: [5] });
    const { id } = await customer();
    const images = ["/uploads/reviews/00000000-0000-4000-8000-000000000001.webp"];
    const review = await createReview(id, { productId: product.id, rating: 4, title: null, body: "Good quality, true to size.", images });
    expect(review.images).toEqual(images);

    expect((await listReviewsForProduct({ productId: product.id, page: 1, pageSize: 10 })).items).toHaveLength(0);
    await moderateReview(review.id, "APPROVED");
    const listed = await listReviewsForProduct({ productId: product.id, page: 1, pageSize: 10 });
    expect(listed.items[0]!.images).toEqual(images);
  });
});
