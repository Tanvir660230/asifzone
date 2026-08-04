"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { Category, CreateCategoryInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { CategoryForm } from "@/components/admin/category-form";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import * as categoriesApi from "@/lib/api/categories";
import { flattenCategoryTree } from "@/lib/category-tree";
import { ApiError } from "@/lib/api-client";

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["categories"], queryFn: categoriesApi.listCategories });
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories = data?.categories ?? [];
  const rows = flattenCategoryTree(categories);

  const createMutation = useMutation({
    mutationFn: categoriesApi.createCategory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categories"] }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateCategoryInput }) =>
      categoriesApi.updateCategory(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categories"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: categoriesApi.deleteCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category deleted");
    },
  });
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  async function handleSubmit(values: CreateCategoryInput) {
    setError(null);
    try {
      if (editing && editing !== "new") {
        await updateMutation.mutateAsync({ id: editing.id, input: values });
      } else {
        await createMutation.mutateAsync(values);
      }
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save category");
    }
  }

  async function handleDelete(category: Category) {
    if (!(await confirm(`Delete "${category.name}"? This cannot be undone.`))) return;
    try {
      await deleteMutation.mutateAsync(category.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete category");
    }
  }

  return (
    <div>
      <PageHeader
        title="Categories"
        action={
          <Button variant="brass" onClick={() => setEditing("new")}>
            <Plus size={16} /> Add category
          </Button>
        }
      />

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={5} cols={4} />}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-400">
                  No categories yet — add your first one.
                </td>
              </tr>
            )}
            {rows.map((cat) => (
              <tr key={cat.id} className="border-t border-ink-100">
                <td className="px-4 py-3" style={{ paddingLeft: `${16 + cat.depth * 24}px` }}>
                  {cat.depth > 0 && <span className="mr-1 text-ink-300">└</span>}
                  {cat.name}
                </td>
                <td className="px-4 py-3 text-ink-500">{cat.slug}</td>
                <td className="px-4 py-3">
                  <Badge className={cat.isActive ? "bg-success-100 text-success-700" : ""}>
                    {cat.isActive ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-3">
                    <button onClick={() => setEditing(cat)} className="text-ink-500 hover:text-ink-900" aria-label="Edit">
                      <Pencil size={16} />
                    </button>
                    <button onClick={() => handleDelete(cat)} className="text-ink-500 hover:text-danger-600" aria-label="Delete">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add category" : `Edit ${editing ? editing.name : ""}`}
      >
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {editing !== null && (
          <CategoryForm
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
