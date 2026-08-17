"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { Bundle, CreateBundleInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { BundleForm } from "@/components/admin/bundle-form";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import * as bundlesApi from "@/lib/api/admin-bundles";
import * as categoriesApi from "@/lib/api/categories";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";
import { cn, ICON_BUTTON_HIT } from "@/lib/utils";

export default function BundlesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-bundles"], queryFn: () => bundlesApi.listBundles() });
  const { data: categoryData } = useQuery({ queryKey: ["categories"], queryFn: () => categoriesApi.listCategories() });
  const [editing, setEditing] = useState<Bundle | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories = categoryData?.categories ?? [];

  const createMutation = useMutation({
    mutationFn: bundlesApi.createBundle,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-bundles"] }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateBundleInput }) => bundlesApi.updateBundle(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-bundles"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: bundlesApi.deleteBundle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-bundles"] });
      toast.success("Bundle deleted");
    },
  });
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  async function handleSubmit(values: CreateBundleInput) {
    setError(null);
    try {
      if (editing && editing !== "new") {
        await updateMutation.mutateAsync({ id: editing.id, input: values });
      } else {
        await createMutation.mutateAsync(values);
      }
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save bundle");
    }
  }

  async function handleDelete(bundle: Bundle) {
    if (!(await confirm(`Delete bundle "${bundle.name}"?`))) return;
    try {
      await deleteMutation.mutateAsync(bundle.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete bundle");
    }
  }

  // Shared between the desktop table row and the mobile card (below) so the two views can't drift.
  function renderRowActions(b: Bundle) {
    return (
      <>
        <button onClick={() => setEditing(b)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")} aria-label="Edit">
          <Pencil size={16} />
        </button>
        <button onClick={() => handleDelete(b)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")} aria-label="Delete">
          <Trash2 size={16} />
        </button>
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="Bundles"
        action={
          <Button variant="brass" onClick={() => setEditing("new")}>
            <Plus size={16} /> Add bundle
          </Button>
        }
      />
      <p className="mb-4 -mt-2 text-sm text-ink-500">
        Cross-sell rules — buying from an anchor category (e.g. Panjabi) suggests products from the categories
        below it and unlocks a discount once enough of them are in the cart.
      </p>

      {/* sm and up: the table below. Below sm: a card list (below that) — same split as the other
          admin list pages. */}
      <div className="hidden overflow-hidden rounded-lg border border-ink-100 bg-cream-50 sm:block">
        <HScrollShadow className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Anchor</th>
                <th className="px-4 py-3">Suggests</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={5} cols={6} />}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-400">
                    No bundles yet — add your first one.
                  </td>
                </tr>
              )}
              {data?.items.map((b) => (
                <tr key={b.id} className="border-t border-ink-100 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                  <td className="px-4 py-3 font-medium">{b.name}</td>
                  <td className="px-4 py-3 text-ink-500">{b.anchorCategory.name}</td>
                  <td className="px-4 py-3 text-ink-500">{b.suggestions.map((s) => s.category.name).join(", ")}</td>
                  <td className="px-4 py-3">{b.discountType === "PERCENTAGE" ? `${b.discountValue}%` : formatPrice(b.discountValue)}</td>
                  <td className="px-4 py-3">
                    <Badge className={b.isActive ? "bg-success-100 text-success-700" : ""}>
                      {b.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">{renderRowActions(b)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScrollShadow>
      </div>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50 sm:hidden">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={cn("animate-pulse border-t border-ink-100 p-3.5", i === 0 && "border-t-0")}>
              <div className="h-3.5 w-32 rounded bg-ink-100" />
              <div className="mt-3 h-3 w-full rounded bg-ink-50" />
            </div>
          ))}
        {!isLoading && data?.items.length === 0 && (
          <p className="px-4 py-6 text-center text-ink-400">No bundles yet — add your first one.</p>
        )}
        {data?.items.map((b) => (
          <div key={b.id} className="border-t border-ink-100 p-3.5 first:border-t-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink-900">{b.name}</p>
                <p className="truncate text-xs text-ink-400">
                  {b.anchorCategory.name} → {b.suggestions.map((s) => s.category.name).join(", ")}
                </p>
              </div>
              <Badge className={cn("shrink-0", b.isActive ? "bg-success-100 text-success-700" : "")}>
                {b.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div className="mt-2.5 flex items-center justify-between border-t border-ink-100 pt-2.5">
              <span className="text-sm font-medium text-ink-900">
                {b.discountType === "PERCENTAGE" ? `${b.discountValue}%` : formatPrice(b.discountValue)} off
              </span>
              <div className="flex items-center gap-2">{renderRowActions(b)}</div>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add bundle" : `Edit ${editing ? editing.name : ""}`}
      >
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {editing !== null && (
          <BundleForm
            categories={categories}
            initial={editing === "new" ? undefined : editing}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
      {confirmDialog}
    </div>
  );
}
