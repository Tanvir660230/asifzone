"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette, Plus, Pencil, Trash2 } from "lucide-react";
import type { Attribute, CreateAttributeInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { AttributeForm } from "@/components/admin/attribute-form";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { DataTable, type DataTableColumn, type DataTableRowAction } from "@/components/admin/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import * as attributesApi from "@/lib/api/attributes";
import { ApiError } from "@/lib/api-client";

export default function AttributesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error: loadError, refetch } = useQuery({ queryKey: ["attributes"], queryFn: attributesApi.listAttributes });
  const [editing, setEditing] = useState<Attribute | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attributes = data?.attributes ?? [];

  const createMutation = useMutation({
    mutationFn: attributesApi.createAttribute,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attributes"] }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateAttributeInput }) => attributesApi.updateAttribute(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attributes"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: attributesApi.deleteAttribute,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attributes"] });
      toast.success("Attribute deleted");
    },
  });
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  async function handleSubmit(values: CreateAttributeInput) {
    setError(null);
    try {
      if (editing && editing !== "new") {
        await updateMutation.mutateAsync({ id: editing.id, input: values });
      } else {
        await createMutation.mutateAsync(values);
      }
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save attribute");
    }
  }

  async function handleDelete(attribute: Attribute) {
    if (!(await confirm(`Delete "${attribute.name}"? This cannot be undone.`))) return;
    try {
      await deleteMutation.mutateAsync(attribute.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete attribute");
    }
  }

  function renderValues(attr: Attribute) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {attr.values.length === 0 && <span className="text-ink-400">—</span>}
        {attr.values.map((v) => (
          <Badge key={v.id} className="gap-1.5">
            {v.colorHex && <span className="h-2.5 w-2.5 rounded-full border border-ink-200" style={{ backgroundColor: v.colorHex }} />}
            {v.value}
          </Badge>
        ))}
      </div>
    );
  }

  const columns: DataTableColumn<Attribute>[] = [
    { id: "name", header: "Name", card: "title", className: "w-56", cell: (a) => <span className="font-medium text-ink-900">{a.name}</span> },
    { id: "values", header: "Values", cell: (a) => renderValues(a) },
  ];
  const rowActions = (a: Attribute): DataTableRowAction<Attribute>[] => [
    { label: "Edit", icon: Pencil, onSelect: () => setEditing(a) },
    { label: "Delete", icon: Trash2, destructive: true, onSelect: () => void handleDelete(a) },
  ];

  return (
    <div>
      <PageHeader
        title="Variant options"
        action={
          <Button variant="brass" onClick={() => setEditing("new")}>
            <Plus size={16} /> Add option type
          </Button>
        }
      />

      <ModuleTabs />

      <p data-page-intro="" className="mb-4 text-sm text-ink-500">
        Define reusable option types (Color, Size, Fabric, Pattern…) and their values — used to build variant
        combinations on the product form. (Product fields like &ldquo;Material&rdquo; or &ldquo;Movement&rdquo; are
        managed under Catalog setup → Attributes.)
      </p>

      <DataTable<Attribute>
        caption="Variant options"
        columns={columns}
        rows={isLoading ? undefined : attributes}
        getRowId={(row) => row.id}
        loading={isLoading}
        error={loadError}
        onRetry={() => void refetch()}
        empty={<EmptyState icon={Palette} title="No option types yet" description="Add Color, Size or Fabric to get started." variant="bordered" />}
        density="dense"
        onRowOpen={setEditing}
        rowActions={rowActions}
      />

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add attribute" : `Edit ${editing ? editing.name : ""}`}
      >
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {editing !== null && (
          <AttributeForm
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
