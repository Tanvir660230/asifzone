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
import * as bundlesApi from "@/lib/api/admin-bundles";
import * as categoriesApi from "@/lib/api/categories";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";

export default function BundlesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-bundles"], queryFn: () => bundlesApi.listBundles() });
  const { data: categoryData } = useQuery({ queryKey: ["categories"], queryFn: categoriesApi.listCategories });
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

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <div className="overflow-x-auto">
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
                    <div className="flex justify-end gap-3">
                      <button onClick={() => setEditing(b)} className="text-ink-500 hover:text-ink-900" aria-label="Edit">
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => handleDelete(b)} className="text-ink-500 hover:text-danger-600" aria-label="Delete">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
