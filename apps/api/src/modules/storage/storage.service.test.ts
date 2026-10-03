import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ values: [] as string[] }));

vi.mock("../../config/prisma", () => ({
  prisma: {
    // One fake text column whose rows are whatever the test put in db.values.
    $queryRaw: vi.fn(async () => [{ table_name: "Banner", column_name: "imageUrl" }]),
    $queryRawUnsafe: vi.fn(async () => db.values.map((v) => ({ v }))),
  },
}));

import { env } from "../../config/env";
import { findUnusedUploads, listTrash, moveUnusedToTrash, purgeExpiredTrash, restoreTrashBatch } from "./storage.service";

const OLD = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const PRODUCT_ID = "11111111-2222-3333-4444-555555555555";
let root: string;
const savedUploadsDir = env.uploadsDir;

async function addFile(rel: string, modifiedAt = OLD) {
  const full = path.join(root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, "x".repeat(10));
  await fs.utimes(full, modifiedAt, modifiedAt);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uploads-"));
  env.uploadsDir = root;
  db.values = [];
});

afterEach(async () => {
  env.uploadsDir = savedUploadsDir;
  await fs.rm(root, { recursive: true, force: true });
});

describe("findUnusedUploads", () => {
  it("keeps referenced files, every size of a referenced product image, and recent uploads", async () => {
    for (const label of ["thumb", "card", "full"]) await addFile(`products/${PRODUCT_ID}-${label}.webp`);
    await addFile("banners/in-use.webp");
    await addFile("banners/old-banner.webp");
    await addFile("editor/just-uploaded.webp", new Date());
    db.values = [
      `https://asifzone.com/uploads/products/${PRODUCT_ID}-full.webp`,
      '<p><img src="https://asifzone.com/uploads/banners/in-use.webp?v=2"></p>',
    ];

    const report = await findUnusedUploads();

    expect(report.totalFiles).toBe(6);
    expect(report.unused.map((f) => f.path)).toEqual(["banners/old-banner.webp"]);
    expect(report.recentUnreferenced).toBe(1);
  });
});

describe("trash", () => {
  it("moves unused files to trash, lists them, and restores them", async () => {
    await addFile("banners/old-banner.webp");
    await addFile("categories/old-category.webp");

    const moved = await moveUnusedToTrash(["banners/old-banner.webp"]);
    expect(moved.moved).toBe(1);
    await expect(fs.stat(path.join(root, "banners/old-banner.webp"))).rejects.toThrow();
    await expect(fs.stat(path.join(root, "categories/old-category.webp"))).resolves.toBeTruthy();

    // Trash is never itself reported as an upload.
    expect((await findUnusedUploads()).unused.map((f) => f.path)).toEqual(["categories/old-category.webp"]);

    const [batch] = await listTrash();
    expect(batch!.files.map((f) => f.path)).toEqual(["banners/old-banner.webp"]);

    await expect(restoreTrashBatch(batch!.batch)).resolves.toEqual({ restored: 1, skipped: [] });
    await expect(fs.stat(path.join(root, "banners/old-banner.webp"))).resolves.toBeTruthy();
    expect(await listTrash()).toEqual([]);
  });

  it("never moves a file that became referenced after the page was loaded", async () => {
    await addFile("banners/old-banner.webp");
    db.values = ["https://asifzone.com/uploads/banners/old-banner.webp"];
    await expect(moveUnusedToTrash(["banners/old-banner.webp"])).resolves.toMatchObject({ moved: 0 });
  });

  it("rejects batch names that escape the trash folder", async () => {
    await expect(restoreTrashBatch("../banners")).rejects.toThrow(/Invalid path/);
  });

  it("purges only batches past retention", async () => {
    await addFile("banners/a.webp");
    const { batch } = await moveUnusedToTrash();
    expect(await purgeExpiredTrash()).toBe(0);

    const expired = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await fs.utimes(path.join(root, ".trash", batch!), expired, expired);
    expect(await purgeExpiredTrash()).toBe(1);
    expect(await listTrash()).toEqual([]);
  });
});
