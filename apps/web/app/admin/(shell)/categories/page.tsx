"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import type { Category, CreateCategoryInput, ReorderCategoriesInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { CategoryForm } from "@/components/admin/category-form";
import { CategoryTree } from "@/components/admin/category-tree";
import { PageHeader } from "@/components/admin/page-header";
import * as categoriesApi from "@/lib/api/categories";
import { ApiError } from "@/lib/api-client";

const CATEGORIES_KEY = ["categories"] as const;

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: CATEGORIES_KEY, queryFn: categoriesApi.listCategories });
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories = data?.categories ?? [];

  const createMutation = useMutation({
    mutationFn: categoriesApi.createCategory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateCategoryInput }) =>
      categoriesApi.updateCategory(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY }),
  });
  const deleteMutation = useMutation({
    mutationFn: categoriesApi.deleteCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
      toast.success("Category deleted");
    },
  });

  // Instant feedback on the switch, not a spinner — the cache is patched immediately and only
  // rolled back if the PATCH actually fails, so toggling a category on/off feels free.
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      categoriesApi.updateCategory(id, { isActive }),
    onMutate: async ({ id, isActive }) => {
      await queryClient.cancelQueries({ queryKey: CATEGORIES_KEY });
      const previous = queryClient.getQueryData<{ categories: Category[] }>(CATEGORIES_KEY);
      queryClient.setQueryData<{ categories: Category[] } | undefined>(CATEGORIES_KEY, (old) =>
        old ? { categories: old.categories.map((c) => (c.id === id ? { ...c, isActive } : c)) } : old,
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(CATEGORIES_KEY, context.previous);
      toast.error("Failed to update category status");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY }),
  });

  // Same optimistic pattern for drag reorder — the tree re-sorts the instant you drop, the network
  // call just makes it durable.
  const reorderMutation = useMutation({
    mutationFn: (input: ReorderCategoriesInput) => categoriesApi.reorderCategories(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: CATEGORIES_KEY });
      const previous = queryClient.getQueryData<{ categories: Category[] }>(CATEGORIES_KEY);
      const nextSortOrder = new Map(input.items.map((item) => [item.id, item.sortOrder]));
      queryClient.setQueryData<{ categories: Category[] } | undefined>(CATEGORIES_KEY, (old) =>
        old
          ? { categories: old.categories.map((c) => (nextSortOrder.has(c.id) ? { ...c, sortOrder: nextSortOrder.get(c.id)! } : c)) }
          : old,
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(CATEGORIES_KEY, context.previous);
      toast.error("Failed to save the new order");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY }),
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

  function openNew(parentId: string | null = null) {
    setNewParentId(parentId);
    setEditing("new");
  }

  function closeModal() {
    setEditing(null);
    setNewParentId(null);
  }

  return (
    <div>
      <PageHeader
        title="Categories"
        action={
          <Button variant="brass" onClick={() => openNew(null)}>
            <Plus size={16} /> Add category
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl border border-ink-100 bg-cream-50" />
          ))}
        </div>
      ) : (
        <CategoryTree
          categories={categories}
          onToggleActive={(category, next) => toggleActiveMutation.mutate({ id: category.id, isActive: next })}
          onEdit={setEditing}
          onDelete={handleDelete}
          onAddChild={(parentId) => openNew(parentId)}
          onReorder={(parentId, orderedIds) =>
            reorderMutation.mutate({ items: orderedIds.map((id, index) => ({ id, sortOrder: index })) })
          }
        />
      )}

      <Modal
        open={editing !== null}
        onClose={closeModal}
        title={editing === "new" ? "Add category" : `Edit ${editing ? editing.name : ""}`}
      >
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {editing !== null && (
          <CategoryForm
            categories={categories}
            initial={editing === "new" ? undefined : editing}
            defaultParentId={editing === "new" ? newParentId : undefined}
            onSubmit={handleSubmit}
            onCancel={closeModal}
          />
        )}
      </Modal>
      {confirmDialog}
    </div>
  );
}
