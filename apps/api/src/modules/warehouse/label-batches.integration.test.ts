import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId } from "../../test-fixtures";
import { listProductLabelVariants } from "./warehouse.service";
import { createLabelBatch, deleteLabelBatch, getLabelBatch, listLabelBatches, updateLabelBatch } from "./label-batches.service";

// Supplier lists for product stickers (docs/WAREHOUSE_OPERATIONS.md §3). Acceptance: a list keeps what was ordered and
// what arrived, size by size; stickers print the received count once counted, else the ordered one; lines carry the
// product's sticker name/tag and colour; saving replaces the lines; nothing touches stock or money.

let owner: string;
const made: string[] = [];

beforeAll(async () => {
  owner = await ownerId();
});
afterAll(async () => {
  await prisma.labelBatch.deleteMany({ where: { id: { in: made } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("product sticker fields", () => {
  it("label variants carry the product's sticker name, tag and colour", async () => {
    const { product, variants } = await createStockedProduct({ stocks: [3, 3], basePrice: 900 });
    await prisma.product.update({ where: { id: product.id }, data: { labelName: "Haven Jacket", labelTag: "Sleeveless" } });
    await prisma.productVariant.update({ where: { id: variants[0]!.id }, data: { colorHex: "#252528" } });
    const rows = await listProductLabelVariants({ variantIds: variants.map((v) => v.id), limit: 10 });
    const first = rows.find((r) => r.variantId === variants[0]!.id)!;
    expect(first).toMatchObject({ labelName: "Haven Jacket", labelTag: "Sleeveless", colorHex: "#252528" });
    expect(typeof first.sortOrder).toBe("number");
  });
});

describe("supplier lists", () => {
  it("keeps ordered and received counts, prints received once counted, and replaces lines on save", async () => {
    const { variants } = await createStockedProduct({ stocks: [0, 0, 0], basePrice: 810 });
    const [m, l, xl] = variants.map((v) => v.id) as [string, string, string];
    const stockBefore = await prisma.productVariant.findMany({ where: { id: { in: [m, l, xl] } }, select: { id: true, stock: true } });

    const created = await createLabelBatch(owner, {
      name: "YG 20 Nov",
      supplier: "YG Fashion",
      notes: null,
      lines: [
        { variantId: m, qtyOrdered: 2, qtyReceived: null },
        { variantId: l, qtyOrdered: 3, qtyReceived: null },
      ],
    });
    made.push(created.id);
    expect(created).toMatchObject({ name: "YG 20 Nov", supplier: "YG Fashion", ordered: 5, toPrint: 5, received: false });
    expect(created.lines.map((x) => x.variant.variantId)).toEqual([m, l]);

    // Goods arrive: one L short, and an XL the supplier added.
    const updated = await updateLabelBatch(created.id, {
      name: "YG 20 Nov",
      supplier: "YG Fashion",
      notes: "1 L short",
      lines: [
        { variantId: m, qtyOrdered: 2, qtyReceived: 2 },
        { variantId: l, qtyOrdered: 3, qtyReceived: 2 },
        { variantId: xl, qtyOrdered: 0, qtyReceived: 1 },
      ],
    });
    expect(updated).toMatchObject({ ordered: 5, toPrint: 5, received: true, notes: "1 L short" });
    expect(updated.lines.find((x) => x.variantId === l)).toMatchObject({ qtyOrdered: 3, qtyReceived: 2 });

    // Dropping a line on save removes it.
    const trimmed = await updateLabelBatch(created.id, { name: "YG 20 Nov", supplier: null, notes: null, lines: [{ variantId: m, qtyOrdered: 2, qtyReceived: 2 }] });
    expect(trimmed.lines).toHaveLength(1);
    expect(trimmed.supplier).toBeNull();

    const list = await listLabelBatches();
    expect(list.find((b) => b.id === created.id)).toMatchObject({ toPrint: 2 });
    expect((await getLabelBatch(created.id)).lines).toHaveLength(1);

    // Labels only: stock untouched.
    const stockAfter = await prisma.productVariant.findMany({ where: { id: { in: [m, l, xl] } }, select: { id: true, stock: true } });
    expect(stockAfter).toEqual(stockBefore);
  });

  it("refuses unknown variants and repeated sizes, and deletes a list", async () => {
    await expect(createLabelBatch(owner, { name: "x", supplier: null, notes: null, lines: [{ variantId: "nope", qtyOrdered: 1, qtyReceived: null }] })).rejects.toThrow(/don't exist/);
    const { variants } = await createStockedProduct({ stocks: [0], basePrice: 100 });
    const b = await createLabelBatch(owner, { name: "temp", supplier: null, notes: null, lines: [{ variantId: variants[0]!.id, qtyOrdered: 1, qtyReceived: null }] });
    await deleteLabelBatch(b.id);
    await expect(getLabelBatch(b.id)).rejects.toThrow(/not found/i);
  });

  it("serves supplier lists over HTTP with the right permissions", async () => {
    const { variants } = await createStockedProduct({ stocks: [0, 0], basePrice: 100 });
    const api = await asOwner();
    const bad = await api.post("/api/warehouse/label-batches", { name: "dup", lines: [{ variantId: variants[0]!.id, qtyOrdered: 1, qtyReceived: null }, { variantId: variants[0]!.id, qtyOrdered: 1, qtyReceived: null }] });
    expect(bad.status).toBe(400);
    const res = await api.post("/api/warehouse/label-batches", { name: "HTTP list", supplier: "", lines: [{ variantId: variants[0]!.id, qtyOrdered: 4, qtyReceived: null }] });
    expect(res.status).toBe(201);
    made.push(res.body.batch.id);
    expect(res.body.batch).toMatchObject({ name: "HTTP list", supplier: null, toPrint: 4 });
    const one = await api.get(`/api/warehouse/label-batches/${res.body.batch.id}`);
    expect(one.status).toBe(200);
    expect(one.body.batch.lines[0].variant.sku).toBeTruthy();
    const put = await api.put(`/api/warehouse/label-batches/${res.body.batch.id}`, { name: "HTTP list", lines: [{ variantId: variants[1]!.id, qtyOrdered: 2, qtyReceived: 1 }] });
    expect(put.status).toBe(200);
    expect(put.body.batch.toPrint).toBe(1);
    const all = await api.get("/api/warehouse/label-batches");
    expect(all.status).toBe(200);
    expect(all.body.batches.some((b: { id: string }) => b.id === res.body.batch.id)).toBe(true);
    expect((await api.delete(`/api/warehouse/label-batches/${res.body.batch.id}`)).status).toBe(204);
    expect((await api.get(`/api/warehouse/label-batches/${res.body.batch.id}`)).status).toBe(404);
  });
});
