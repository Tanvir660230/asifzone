import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";

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

/** fileFilter (upload.middleware.ts) only checks the client-supplied MIME header, which is
 * trivially spoofable — this is the real check, reading the file's actual magic bytes. Called
 * before any sharp().toFile() work so a corrupt/non-image upload fails with a clean 400 instead
 * of an unhandled sharp exception (which the global error handler can only report as a raw 500). */
async function assertValidImage(buffer: Buffer): Promise<void> {
  try {
    await sharp(buffer).metadata();
  } catch {
    throw AppError.badRequest("The uploaded file isn't a valid image");
  }
}

/** Resizes an uploaded image buffer into thumb/card/full WebP variants and returns the public URL for the "full" size (others are used by the frontend's responsive srcset). Returned as an absolute same-origin URL, matching processSiteImage, so it stays eligible for next/image regardless of where it's rendered from. */
export async function processProductImage(buffer: Buffer, originalName: string): Promise<ProcessedImage> {
  await assertValidImage(buffer);
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
    url: `${env.apiOrigin}/uploads/products/${id}-full.webp`,
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

/** Deletes a single-file site image (logo/favicon/payment-methods/banner/category) previously
 * returned by processSiteImage/processFaviconImage, given its full public URL — resolves back to
 * the on-disk path via the same `uploads/<folder>/<filename>` layout those functions write to.
 * Tolerant of an already-missing file (nothing to clean up) or a non-local URL (nothing to do). */
export async function deleteSiteImageFile(url: string): Promise<void> {
  const marker = `/${env.uploadsDir}/`;
  const index = url.indexOf(marker);
  if (index === -1) return;

  const relativePath = url.slice(index + marker.length);
  if (relativePath.includes("..")) return;

  // Same containment check as ai.service.ts's generateImageAltText — belt-and-suspenders beyond
  // the ".." rejection above, since these URLs are only ever ones this server itself generated,
  // but this function's input is still an arbitrary stored string, not a hardcoded path.
  const uploadsRoot = path.resolve(process.cwd(), env.uploadsDir);
  const filePath = path.resolve(uploadsRoot, relativePath);
  if (!filePath.startsWith(uploadsRoot)) return;

  await fs.unlink(filePath).catch(() => {
    // already gone — nothing to do
  });
}

/** Shared by banner/category uploads: a single resized WebP under `uploads/<folder>`, returned as an absolute same-origin URL so it stays eligible for next/image (unlike a free-typed external URL). */
async function processSiteImage(buffer: Buffer, folder: string, width: number): Promise<string> {
  await assertValidImage(buffer);
  const id = randomUUID();
  const dir = path.join(process.cwd(), env.uploadsDir, folder);
  await ensureDir(dir);

  const filePath = path.join(dir, `${id}.webp`);
  await sharp(buffer).resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toFile(filePath);

  return `${env.apiOrigin}/uploads/${folder}/${id}.webp`;
}

export const processLogoImage = (buffer: Buffer) => processSiteImage(buffer, "branding", 600);
/** Square-cropped so it reads correctly as a browser tab icon regardless of the source image's
 * aspect ratio — unlike the logo, which keeps its natural proportions. */
export async function processFaviconImage(buffer: Buffer): Promise<string> {
  await assertValidImage(buffer);
  const id = randomUUID();
  const dir = path.join(process.cwd(), env.uploadsDir, "branding");
  await ensureDir(dir);

  const filePath = path.join(dir, `${id}-favicon.png`);
  await sharp(buffer)
    .resize({ width: 512, height: 512, fit: "cover" })
    .png()
    .toFile(filePath);

  return `${env.apiOrigin}/uploads/branding/${id}-favicon.png`;
}
export const processBannerImage = (buffer: Buffer) => processSiteImage(buffer, "banners", 1920);
export const processCategoryImage = (buffer: Buffer) => processSiteImage(buffer, "categories", 800);
export const processCategoryBannerImage = (buffer: Buffer) => processSiteImage(buffer, "category-banners", 1600);
/** Rich-text-editor image inserts (product/category descriptions) — not tied to a product id, since it must also work before a new product has been saved. */
export const processEditorImage = (buffer: Buffer) => processSiteImage(buffer, "editor", 1200);
/** Payment method badges (bKash, Nagad, Visa, ...) shown in the footer and at checkout — kept
 * small since these render at a fixed, compact height everywhere they appear. */
export const processPaymentMethodLogo = (buffer: Buffer) => processSiteImage(buffer, "payment-methods", 400);
/** A single combined "we accept" graphic (all payment logos already laid out in one image), as an
 * alternative to uploading each PaymentMethodOption logo separately. Wider than an individual
 * badge since it's meant to span the footer/checkout payment row as one image. */
export const processPaymentMethodsImage = (buffer: Buffer) => processSiteImage(buffer, "payment-methods", 900);
