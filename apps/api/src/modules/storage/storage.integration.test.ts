import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { findUnusedUploads } from "./storage.service";

// The unused-upload scan against a real database: one query per table must find a reference in any kind of text or
// JSON column — text, varchar, json, jsonb and text[] — in any column of a many-column table, as the one-query-per-
// column scan did.

const TABLE = "zz_storage_scan_test";
const savedUploadsDir = env.uploadsDir;
let root = "";
const old = new Date(Date.now() - 30 * 86_400_000);

async function file(rel: string) {
  const full = path.join(root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, "x");
  await fs.utimes(full, old, old);
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "storage-scan-"));
  env.uploadsDir = root;
  for (const rel of ["a/text.webp", "a/varchar.webp", "b/json.webp", "b/jsonb.webp", "c/array.webp", "c/second-row.webp", "d/nested/deep.webp", "unused/orphan.webp"]) await file(rel);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${TABLE}"`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "${TABLE}" (id serial PRIMARY KEY, t text, vc varchar(200), j json, jb jsonb, arr text[], blank text)`);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "${TABLE}" (t, vc, j, jb, arr) VALUES
      ('<img src="/uploads/a/text.webp">', '/uploads/a/varchar.webp', '{"image":"/uploads/b/json.webp"}', '{"blocks":[{"src":"/uploads/b/jsonb.webp"}]}', ARRAY['/uploads/c/array.webp']),
      (NULL, NULL, NULL, '{"deep":{"x":"https://shop.example/uploads/d/nested/deep.webp"}}', ARRAY['x', '/uploads/c/second-row.webp'])`,
  );
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${TABLE}"`);
  env.uploadsDir = savedUploadsDir;
  await fs.rm(root, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("findUnusedUploads on a real database", () => {
  it("finds a reference in every kind of column and every row; only the unreferenced file is unused", async () => {
    const report = await findUnusedUploads();
    expect(report.totalFiles).toBe(8);
    expect(report.unused.map((f) => f.path)).toEqual(["unused/orphan.webp"]);
  });

  it("a file referenced again is no longer unused, and removing the reference makes it unused", async () => {
    await prisma.$executeRawUnsafe(`UPDATE "${TABLE}" SET blank = '/uploads/unused/orphan.webp' WHERE id = 1`);
    expect((await findUnusedUploads()).unused).toEqual([]);
    await prisma.$executeRawUnsafe(`UPDATE "${TABLE}" SET blank = NULL, jb = '{}'::jsonb WHERE id = 1`);
    expect((await findUnusedUploads()).unused.map((f) => f.path).sort()).toEqual(["b/jsonb.webp", "unused/orphan.webp"]);
  });
});
