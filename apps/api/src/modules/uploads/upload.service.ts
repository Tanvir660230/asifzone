import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { env } from "../../config/env";

const SIZES = {
  thumb: 300,
  card: 600,
  full: 1600,
} as const;

export interface ProcessedImage {
  url: string;
  altText?: string;
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

/** Resizes an uploaded image buffer into thumb/card/full WebP variants and returns the public URL for the "full" size (others are used by the frontend's responsive srcset). */
export async function processProductImage(buffer: Buffer, originalName: string): Promise<ProcessedImage> {
  const id = randomUUID();
  const dir = path.join(process.cwd(), env.uploadsDir, "products");
  await ensureDir(dir);

  await Promise.all(
    Object.entries(SIZES).map(async ([label, width]) => {
      const filePath = path.join(dir, `${id}-${label}.webp`);
      await sharp(buffer).resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toFile(filePath);
    }),
  );

  return {
    url: `/uploads/products/${id}-full.webp`,
    altText: originalName,
  };
}

/** Removes the thumb/card/full files on disk for a "full" URL previously returned by processProductImage. */
export async function deleteProductImageFiles(fullUrl: string): Promise<void> {
  const filename = path.basename(fullUrl);
  const id = filename.replace(/-full\.webp$/, "");
  const dir = path.join(process.cwd(), env.uploadsDir, "products");

  await Promise.all(
    Object.keys(SIZES).map((label) =>
      fs.unlink(path.join(dir, `${id}-${label}.webp`)).catch(() => {
        // already gone — nothing to do
      }),
    ),
  );
}

/** Shared by banner/category uploads: a single resized WebP under `uploads/<folder>`, returned as an absolute same-origin URL so it stays eligible for next/image (unlike a free-typed external URL). */
async function processSiteImage(buffer: Buffer, folder: string, width: number): Promise<string> {
  const id = randomUUID();
  const dir = path.join(process.cwd(), env.uploadsDir, folder);
  await ensureDir(dir);

  const filePath = path.join(dir, `${id}.webp`);
  await sharp(buffer).resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toFile(filePath);

  return `${env.apiOrigin}/uploads/${folder}/${id}.webp`;
}

export const processLogoImage = (buffer: Buffer) => processSiteImage(buffer, "branding", 600);
export const processBannerImage = (buffer: Buffer) => processSiteImage(buffer, "banners", 1920);
export const processCategoryImage = (buffer: Buffer) => processSiteImage(buffer, "categories", 800);
export const processCategoryBannerImage = (buffer: Buffer) => processSiteImage(buffer, "category-banners", 1600);
/** Rich-text-editor image inserts (product/category descriptions) — not tied to a product id, since it must also work before a new product has been saved. */
export const processEditorImage = (buffer: Buffer) => processSiteImage(buffer, "editor", 1200);
