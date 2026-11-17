"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Boxes } from "lucide-react";
import type { Bundle, CreateBundleInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { BundleForm } from "@/components/admin/bundle-form";
import { EmptyState } from "@/components/ui/empty-state";
import { ListPage } from "@/components/admin/patterns/list-page";
import { DataTable, type DataTableColumn, type DataTableRowAction } from "@/components/admin/data-table";
import * as bundlesApi from "@/lib/api/admin-bundles";
import * as categoriesApi from "@/lib/api/categories";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";

export default function BundlesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error: loadError, refetch } = useQuery({ queryKey: ["admin-bundles"], queryFn: () => bundlesApi.listBundles() });
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


  const columns: DataTableColumn<Bundle>[] = [
    { id: "name", header: "Name", card: "title", cell: (b) => <span className="font-medium text-ink-900">{b.name}</span> },
    { id: "anchor", header: "Anchor", cell: (b) => <span className="text-ink-500">{b.anchorCategory.name}</span> },
    { id: "suggests", header: "Suggests", cell: (b) => <span className="text-ink-500">{b.suggestions.map((x) => x.category.name).join(", ")}</span> },
    { id: "discount", header: "Discount", align: "right", cell: (b) => (b.discountType === "PERCENTAGE" ? `${b.discountValue}%` : formatPrice(b.discountValue)) },
    { id: "status", header: "Status", className: "w-28", cell: (b) => <Badge variant={b.isActive ? "success" : "neutral"}>{b.isActive ? "Active" : "Inactive"}</Badge> },
  ];
  const rowActions = (b: Bundle): DataTableRowAction<Bundle>[] => [
    { label: "Edit", icon: Pencil, onSelect: () => setEditing(b) },
    { label: "Delete", icon: Trash2, destructive: true, onSelect: () => void handleDelete(b) },
  ];

  return (
    <ListPage
      title="Bundles"
      action={
        <Button variant="brass" onClick={() => setEditing("new")}>
          <Plus size={16} /> Add bundle
        </Button>
      }
      intro={
        <>
          Cross-sell rules — buying from an anchor category (e.g. Panjabi) suggests products from the categories
          below it and unlocks a discount once enough of them are in the cart.
        </>
      }
    >
      <DataTable<Bundle>
        caption="Bundles"
        columns={columns}
        rows={isLoading ? undefined : data?.items}
        getRowId={(row) => row.id}
        loading={isLoading}
        error={loadError}
        onRetry={() => void refetch()}
        empty={<EmptyState icon={Boxes} title="No bundles yet" description="Suggest items from another category, with a discount when they are bought together." variant="bordered" />}
        density="dense"
        onRowOpen={setEditing}
        rowActions={rowActions}
      />

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
    </ListPage>
  );
}
