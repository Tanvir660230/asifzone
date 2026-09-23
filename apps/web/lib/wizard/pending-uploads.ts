/** Photos picked before a product existed, handed from the "new product" wizard to the product's edit page, which
 * uploads them through its normal per-file queue (progress, per-file error, Retry). Module memory, not storage: it
 * survives the client-side navigation between the two pages, and a File can't be persisted anyway. */
const pending = new Map<string, File[]>();

export function setPendingUploads(productId: string, files: File[]) {
  if (files.length) pending.set(productId, files);
}

/** Returns and forgets them, so they're only ever queued once. */
export function takePendingUploads(productId: string): File[] {
  const files = pending.get(productId) ?? [];
  pending.delete(productId);
  return files;
}
