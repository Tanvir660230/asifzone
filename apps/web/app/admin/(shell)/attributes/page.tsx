"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { Attribute, CreateAttributeInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { AttributeForm } from "@/components/admin/attribute-form";
import { PageHeader } from "@/components/admin/page-header";
import { ProductsSubNav } from "@/components/admin/products-subnav";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import * as attributesApi from "@/lib/api/attributes";
import { ApiError } from "@/lib/api-client";
import { cn, ICON_BUTTON_HIT } from "@/lib/utils";

export default function AttributesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["attributes"], queryFn: attributesApi.listAttributes });
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

  // Shared between the desktop table row and the mobile card (below) so the two views can't drift.
  function renderRowActions(attr: Attribute) {
    return (
      <>
        <button
          onClick={() => setEditing(attr)}
          className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")}
          aria-label="Edit"
        >
          <Pencil size={16} />
        </button>
        <button
          onClick={() => handleDelete(attr)}
          className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")}
          aria-label="Delete"
        >
          <Trash2 size={16} />
        </button>
      </>
    );
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

  return (
    <div>
      <PageHeader
        title="Attributes"
        action={
          <Button variant="brass" onClick={() => setEditing("new")}>
            <Plus size={16} /> Add attribute
          </Button>
        }
      />

      <ProductsSubNav />

      <p className="mb-4 text-sm text-ink-500">
        Define reusable option types (Color, Size, Fabric, Pattern…) and their values — used to build variant
        combinations on the product form.
      </p>

      {/* sm and up: the table below. Below sm: a card list (below that) — same split as the
          Orders/Customers/Products admin pages. */}
      <div className="hidden overflow-hidden rounded-lg border border-ink-100 bg-cream-50 sm:block">
        <HScrollShadow className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Values</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={4} cols={3} />}
            {!isLoading && attributes.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-ink-400">
                  No attributes yet — add Color, Size, or Fabric to get started.
                </td>
              </tr>
            )}
            {attributes.map((attr) => (
              <tr key={attr.id} className="border-t border-ink-100 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                <td className="px-4 py-3 font-medium text-ink-900">{attr.name}</td>
                <td className="px-4 py-3">{renderValues(attr)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-3">{renderRowActions(attr)}</div>
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
              <div className="h-3.5 w-24 rounded bg-ink-100" />
              <div className="mt-3 h-6 w-full rounded bg-ink-50" />
            </div>
          ))}
        {!isLoading && attributes.length === 0 && (
          <p className="px-4 py-6 text-center text-ink-400">No attributes yet — add Color, Size, or Fabric to get started.</p>
        )}
        {attributes.map((attr) => (
          <div key={attr.id} className="border-t border-ink-100 p-3.5 first:border-t-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-ink-900">{attr.name}</span>
              <div className="flex items-center gap-2">{renderRowActions(attr)}</div>
            </div>
            <div className="mt-2">{renderValues(attr)}</div>
          </div>
        ))}
      </div>

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
