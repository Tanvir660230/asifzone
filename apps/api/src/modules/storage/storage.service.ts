import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";

/**
 * Unused-upload cleanup. Instead of every feature having to remember to delete its old image (banners,
 * category images, homepage sections and rich-text editor images never did, and an upload abandoned
 * before saving is never referenced at all), this decides what's unused by looking at the data itself:
 * a file is in use if its `/uploads/...` path appears anywhere in the database — any text or JSON
 * column of any table. New tables and features are covered automatically, with no list to maintain.
 *
 * Nothing is deleted outright. Unused files are moved into `uploads/.trash/<batch>/` (not served
 * publicly) where they can be restored for TRASH_RETENTION_DAYS, after which the daily cron purges them.
 */

/** Never treat a recent upload as unused: it may belong to a form an admin hasn't saved yet. */
export const UNUSED_GRACE_DAYS = 7;
export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRASH_DIR = ".trash";

/** Product images are stored as one `<id>-full.webp` URL, but processProductImage writes thumb/card/full
 * siblings — the whole set is in use when any one of them is referenced. */
const PRODUCT_IMAGE_SET = /^(products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[a-z]+\.webp$/i;
const UPLOAD_REF = /\/uploads\/([^\s"'<>()\\?#,]+)/g;

function uploadsRoot() {
  return path.resolve(process.cwd(), env.uploadsDir);
}

function referenceKey(relativePath: string) {
  return PRODUCT_IMAGE_SET.exec(relativePath)?.[1] ?? relativePath;
}

/** Resolves a client-supplied relative path, refusing anything that escapes `base`. */
function safeResolve(base: string, relativePath: string) {
  const resolved = path.resolve(base, relativePath);
  if (!resolved.startsWith(base + path.sep)) throw AppError.badRequest(`Invalid path: ${relativePath}`);
  return resolved;
}

async function walk(dir: string, prefix = ""): Promise<Array<{ path: string; size: number; modifiedAt: Date }>> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: Array<{ path: string; size: number; modifiedAt: Date }> = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // .trash and any dotfiles
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, rel)));
    else if (entry.isFile()) {
      const stat = await fs.stat(full);
      files.push({ path: rel, size: stat.size, modifiedAt: stat.mtime });
    }
  }
  return files;
}

/** Pure history/analytics tables: a URL in an audit diff or a page-view log is a record of the past, not
 * something the site still displays, so it mustn't keep a deleted banner's file alive forever. (Order
 * line items are NOT listed — their image snapshot is shown on old orders and must keep working.) */
const HISTORY_TABLES = ["_prisma_migrations", "AuditLog", "Notification", "PageView", "FunnelEvent", "ProductViewLog", "SearchLog"];

/** Every `/uploads/...` path mentioned anywhere in the database, normalised to referenceKey form. */
async function collectReferences(): Promise<Set<string>> {
  const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND NOT (table_name = ANY(${HISTORY_TABLES}))
      AND (data_type IN ('text', 'character varying', 'json', 'jsonb') OR udt_name IN ('_text', '_varchar'))
  `;

  const refs = new Set<string>();
  for (const { table_name, column_name } of columns) {
    // Identifiers come from the catalog, not from a request; quoted the way Postgres requires.
    const table = `"${table_name.replace(/"/g, '""')}"`;
    const column = `"${column_name.replace(/"/g, '""')}"`;
    const rows = await prisma.$queryRawUnsafe<Array<{ v: string }>>(
      `SELECT DISTINCT ${column}::text AS v FROM ${table} WHERE ${column}::text LIKE '%/uploads/%'`,
    );
    for (const { v } of rows) {
      for (const match of v.matchAll(UPLOAD_REF)) {
        let rel = match[1]!;
        try {
          rel = decodeURIComponent(rel);
        } catch {
          // keep the raw form
        }
        refs.add(referenceKey(rel));
      }
    }
  }
  return refs;
}

export interface UploadFileInfo {
  path: string;
  size: number;
  modifiedAt: string;
}

export interface UnusedUploadsReport {
  totalFiles: number;
  totalBytes: number;
  unused: UploadFileInfo[];
  unusedBytes: number;
  /** Unreferenced but younger than UNUSED_GRACE_DAYS — left alone for now. */
  recentUnreferenced: number;
  graceDays: number;
}

export async function findUnusedUploads(): Promise<UnusedUploadsReport> {
  const [files, refs] = await Promise.all([walk(uploadsRoot()), collectReferences()]);
  const cutoff = Date.now() - UNUSED_GRACE_DAYS * DAY_MS;

  const unused: UploadFileInfo[] = [];
  let recentUnreferenced = 0;
  for (const file of files) {
    if (refs.has(referenceKey(file.path))) continue;
    if (file.modifiedAt.getTime() > cutoff) {
      recentUnreferenced++;
      continue;
    }
    unused.push({ path: file.path, size: file.size, modifiedAt: file.modifiedAt.toISOString() });
  }
  unused.sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt));

  return {
    totalFiles: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    unused,
    unusedBytes: unused.reduce((sum, f) => sum + f.size, 0),
    recentUnreferenced,
    graceDays: UNUSED_GRACE_DAYS,
  };
}

/** Moves unused files into a new trash batch. The unused set is recomputed here rather than trusted
 * from the client, so a file that became referenced since the admin loaded the page is never moved.
 * `onlyPaths` narrows the move to the admin's selection. */
export async function moveUnusedToTrash(onlyPaths?: string[]) {
  const report = await findUnusedUploads();
  const wanted = onlyPaths ? new Set(onlyPaths) : null;
  const toMove = report.unused.filter((f) => !wanted || wanted.has(f.path));
  if (toMove.length === 0) return { batch: null, moved: 0, bytes: 0 };

  const root = uploadsRoot();
  const batch = new Date().toISOString().replace(/[:.]/g, "-");
  const batchDir = path.join(root, TRASH_DIR, batch);

  let moved = 0;
  let bytes = 0;
  for (const file of toMove) {
    const target = safeResolve(batchDir, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(safeResolve(root, file.path), target);
    moved++;
    bytes += file.size;
  }
  return { batch, moved, bytes };
}

export interface TrashBatch {
  batch: string;
  movedAt: string;
  expiresAt: string;
  files: UploadFileInfo[];
  bytes: number;
}

async function readBatches(): Promise<TrashBatch[]> {
  const trashRoot = path.join(uploadsRoot(), TRASH_DIR);
  const entries = await fs.readdir(trashRoot, { withFileTypes: true }).catch(() => []);
  const batches: TrashBatch[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(trashRoot, entry.name);
    const movedAt = (await fs.stat(dir)).mtime;
    const files = (await walk(dir)).map((f) => ({ path: f.path, size: f.size, modifiedAt: f.modifiedAt.toISOString() }));
    batches.push({
      batch: entry.name,
      movedAt: movedAt.toISOString(),
      expiresAt: new Date(movedAt.getTime() + TRASH_RETENTION_DAYS * DAY_MS).toISOString(),
      files,
      bytes: files.reduce((sum, f) => sum + f.size, 0),
    });
  }
  return batches.sort((a, b) => b.movedAt.localeCompare(a.movedAt));
}

export function listTrash() {
  return readBatches();
}

/** Puts a trash batch's files back where they were. A file whose original path has since been taken
 * (shouldn't happen — upload names are random UUIDs) is left in the trash rather than overwritten. */
export async function restoreTrashBatch(batch: string) {
  const root = uploadsRoot();
  const batchDir = safeResolve(path.join(root, TRASH_DIR), batch);
  const files = await walk(batchDir);
  if (files.length === 0) throw AppError.notFound("Trash batch not found");

  let restored = 0;
  const skipped: string[] = [];
  for (const file of files) {
    const target = safeResolve(root, file.path);
    const exists = await fs.stat(target).then(() => true, () => false);
    if (exists) {
      skipped.push(file.path);
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(path.join(batchDir, file.path), target);
    restored++;
  }
  if (skipped.length === 0) await fs.rm(batchDir, { recursive: true, force: true });
  return { restored, skipped };
}

/** Permanently deletes trash batches older than TRASH_RETENTION_DAYS. Run daily by storage-trash-cron. */
export async function purgeExpiredTrash() {
  const now = Date.now();
  let purged = 0;
  for (const batch of await readBatches()) {
    if (new Date(batch.expiresAt).getTime() > now) continue;
    await fs.rm(path.join(uploadsRoot(), TRASH_DIR, batch.batch), { recursive: true, force: true });
    purged++;
  }
  return purged;
}
