"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HardDrive, ImageOff, RotateCcw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { StatTile } from "@/components/admin/stat-tile";
import { EmptyState } from "@/components/admin/empty-state";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { adminCan } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import * as storageApi from "@/lib/api/storage";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function daysLeft(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

const FOLDER_LABEL: Record<string, string> = {
  products: "Product",
  banners: "Banner",
  categories: "Category",
  editor: "Text editor",
  branding: "Branding",
  "payment-methods": "Payment method",
};

function folderOf(filePath: string) {
  const folder = filePath.split("/")[0] ?? "";
  return FOLDER_LABEL[folder] ?? folder;
}

export default function StoragePage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirmDialog();
  const { data: currentAdmin } = useCurrentAdmin();
  const canManage = adminCan(currentAdmin?.admin, "settings.manage");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const unusedQuery = useQuery({ queryKey: ["storage", "unused"], queryFn: storageApi.getUnusedUploads, enabled: canManage });
  const trashQuery = useQuery({ queryKey: ["storage", "trash"], queryFn: storageApi.listTrash, enabled: canManage });
  const report = unusedQuery.data;

  const selectedBytes = useMemo(
    () => report?.unused.filter((f) => selected.has(f.path)).reduce((sum, f) => sum + f.size, 0) ?? 0,
    [report, selected],
  );

  function refresh() {
    setSelected(new Set());
    void queryClient.invalidateQueries({ queryKey: ["storage"] });
  }

  const trashMutation = useMutation({
    mutationFn: storageApi.moveUnusedToTrash,
    onSuccess: (res) => {
      toast.success(`${res.moved} file(s) moved to trash (${formatBytes(res.bytes)})`);
      refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const restoreMutation = useMutation({
    mutationFn: storageApi.restoreTrashBatch,
    onSuccess: (res) => {
      toast.success(
        res.skipped.length ? `${res.restored} restored, ${res.skipped.length} skipped` : `${res.restored} file(s) restored`,
      );
      refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function handleTrash() {
    const paths = [...selected];
    const ok = await confirm(
      `Move ${paths.length} unused file(s) (${formatBytes(selectedBytes)}) to trash? They stop being served right away, ` +
        "but can be restored from the trash below for 30 days.",
      "Move to trash",
    );
    if (ok) trashMutation.mutate(paths);
  }

  function toggle(filePath: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }

  const allSelected = Boolean(report?.unused.length) && selected.size === report?.unused.length;

  if (currentAdmin && !canManage) {
    return (
      <div>
        <PageHeader title="Storage" />
        <ModuleTabs />
        <p className="text-sm text-ink-500">Only store owners can clean up uploaded files.</p>
      </div>
    );
  }

  return (
    <div>
      {dialog}
      <PageHeader title="Storage" />
      <ModuleTabs />
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-ink-500">
        Images uploaded to the site that nothing uses any more — an old banner, a replaced category image, a photo removed
        from a description, or an upload that was never saved. A file counts as in use if it appears anywhere in the store&apos;s
        data, including past orders and email campaigns. Uploads from the last {report?.graceDays ?? 7} days are never listed.
      </p>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Uploaded files" value={report ? `${report.totalFiles} · ${formatBytes(report.totalBytes)}` : "—"} icon={<HardDrive size={18} />} />
        <StatTile
          label="Unused"
          value={report ? `${report.unused.length} · ${formatBytes(report.unusedBytes)}` : "—"}
          icon={<ImageOff size={18} />}
          tone={report && report.unused.length > 0 ? "warning" : "default"}
        />
        <StatTile
          label="In trash"
          value={trashQuery.data ? `${trashQuery.data.reduce((n, b) => n + b.files.length, 0)} files` : "—"}
          icon={<Trash2 size={18} />}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-800">Unused files</h2>
        <Button variant="destructive" size="sm" disabled={selected.size === 0 || trashMutation.isPending} onClick={handleTrash}>
          <Trash2 size={14} />
          {trashMutation.isPending ? "Moving…" : `Move ${selected.size || ""} to trash`}
        </Button>
      </div>

      <div className="mb-8 overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <HScrollShadow className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    aria-label="Select all"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(report?.unused.map((f) => f.path)))}
                  />
                </th>
                <th className="px-4 py-3">Preview</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {unusedQuery.isLoading && <TableSkeleton rows={6} cols={6} />}
              {!unusedQuery.isLoading && report?.unused.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState icon={ImageOff} title="No unused files" description="Every uploaded image is in use." />
                  </td>
                </tr>
              )}
              {report?.unused.map((file) => (
                <tr key={file.path} className="border-t border-ink-100 hover:bg-ink-50/60">
                  <td className="px-4 py-2">
                    <Checkbox aria-label={`Select ${file.path}`} checked={selected.has(file.path)} onChange={() => toggle(file.path)} />
                  </td>
                  <td className="px-4 py-2">
                    <a href={resolveImageUrl(`/uploads/${file.path}`)} target="_blank" rel="noreferrer" className="block h-12 w-12 overflow-hidden rounded bg-ink-50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={resolveImageUrl(`/uploads/${file.path}`)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </a>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-ink-700">{folderOf(file.path)}</td>
                  <td className="max-w-[18rem] truncate px-4 py-2 text-ink-500" title={file.path}>
                    {file.path}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-ink-500">{formatBytes(file.size)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-ink-500">{formatDate(file.modifiedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScrollShadow>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-ink-800">Trash</h2>
      <p className="-mt-2 mb-3 text-sm text-ink-500">Restore a batch to put its files back exactly where they were. Each batch is deleted for good after 30 days.</p>
      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        {trashQuery.data?.length === 0 && <EmptyState icon={Trash2} title="Trash is empty" />}
        {trashQuery.data?.map((batch) => (
          <div key={batch.batch} className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-4 py-3 first:border-t-0">
            <div className="text-sm">
              <div className="font-medium text-ink-800">
                {batch.files.length} file(s) · {formatBytes(batch.bytes)}
              </div>
              <div className="text-ink-500">
                Moved {formatDate(batch.movedAt)} · deleted for good in {daysLeft(batch.expiresAt)} day(s)
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={restoreMutation.isPending}
              onClick={() => restoreMutation.mutate(batch.batch)}
            >
              <RotateCcw size={14} />
              Restore
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
