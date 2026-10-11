import { apiFetch } from "../api-client";

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
  recentUnreferenced: number;
  graceDays: number;
}

export interface TrashBatch {
  batch: string;
  movedAt: string;
  expiresAt: string;
  files: UploadFileInfo[];
  bytes: number;
}

export function getUnusedUploads() {
  return apiFetch<UnusedUploadsReport>("/api/storage/unused");
}

export function moveUnusedToTrash(paths: string[]) {
  return apiFetch<{ batch: string | null; moved: number; bytes: number }>("/api/storage/unused/trash", {
    method: "POST",
    body: { paths },
  });
}

export function listTrash() {
  return apiFetch<{ batches: TrashBatch[] }>("/api/storage/trash").then((res) => res.batches);
}

export function restoreTrashBatch(batch: string) {
  return apiFetch<{ restored: number; skipped: string[] }>(`/api/storage/trash/${encodeURIComponent(batch)}/restore`, {
    method: "POST",
  });
}
