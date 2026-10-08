"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw, Trash2, ArchiveX, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Category, CreateCategoryInput, ReorderCategoriesInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableMessageRow, TableRow } from "@/components/ui/table";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { CategoryForm } from "@/components/admin/category-form";
import { CategoryTree } from "@/components/admin/category-tree";
import { PageHeader } from "@/components/admin/page-header";
import * as categoriesApi from "@/lib/api/categories";
import { ApiError } from "@/lib/api-client";
import { useCapability } from "@/hooks/use-capability";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const canPurge = useCapability("catalog.purge"); // PD-10.1: permanent delete is OWNER-only
  const [tab, setTab] = useState<"active" | "trash">("active");
  const CATEGORIES_KEY = ["categories", tab] as const;
  const { data, isLoading } = useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: () => categoriesApi.listCategories({ trashed: tab === "trash" }),
  });
  const { data: stockData } = useQuery({
    queryKey: ["categories", "stock-map"],
    queryFn: categoriesApi.getCategoryStockMap,
    enabled: tab === "active",
  });
  // Wide screens: tree + inspector, the selection in the URL (?category=<id> | new). Phones: the same form in a modal.
  const wide = useMediaQuery("(min-width: 1024px)");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [editingState, setEditingState] = useState<Category | "new" | null>(null);
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories = data?.categories ?? [];
  const selectedParam = searchParams.get("category");
  const editing: Category | "new" | null = wide
    ? selectedParam === "new"
      ? "new"
      : (categories.find((c) => c.id === selectedParam) ?? null)
    : editingState;
  function setEditing(next: Category | "new" | null) {
    if (!wide) return setEditingState(next);
    const q = new URLSearchParams(searchParams.toString());
    if (next === null) q.delete("category");
    else q.set("category", next === "new" ? "new" : next.id);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["categories"] });
  }

  const createMutation = useMutation({
    mutationFn: categoriesApi.createCategory,
    onSuccess: invalidateAll,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateCategoryInput }) =>
      categoriesApi.updateCategory(id, input),
    onSuccess: invalidateAll,
  });
  const deleteMutation = useMutation({
    mutationFn: categoriesApi.deleteCategory,
    onSuccess: () => {
      invalidateAll();
      toast.success("Moved to Trash");
    },
  });
  const restoreMutation = useMutation({
    mutationFn: categoriesApi.restoreCategory,
    onSuccess: () => {
      invalidateAll();
      toast.success("Category restored");
    },
  });
  const permanentDeleteMutation = useMutation({
    mutationFn: categoriesApi.permanentlyDeleteCategory,
    onSuccess: () => {
      invalidateAll();
      toast.success("Category permanently deleted");
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

  // Drag-and-drop reparent — optimistically flips the moved category's parentId so the tree jumps
  // to its new spot immediately; onSettled always refetches for the authoritative sortOrder.
  const moveMutation = useMutation({
    mutationFn: ({ id, newParentId, sortOrder }: { id: string; newParentId: string; sortOrder: number }) =>
      categoriesApi.moveCategory(id, { newParentId, sortOrder }),
    onMutate: async ({ id, newParentId }) => {
      await queryClient.cancelQueries({ queryKey: CATEGORIES_KEY });
      const previous = queryClient.getQueryData<{ categories: Category[] }>(CATEGORIES_KEY);
      queryClient.setQueryData<{ categories: Category[] } | undefined>(CATEGORIES_KEY, (old) =>
        old ? { categories: old.categories.map((c) => (c.id === id ? { ...c, parentId: newParentId } : c)) } : old,
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(CATEGORIES_KEY, context.previous);
      toast.error(err instanceof ApiError ? err.message : "Failed to move category");
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
    if (!(await confirm(`Move "${category.name}" to Trash?`))) return;
    try {
      await deleteMutation.mutateAsync(category.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete category");
    }
  }

  async function handlePermanentDelete(category: Category) {
    if (!(await confirm(`Permanently delete "${category.name}"? This cannot be undone.`))) return;
    try {
      await permanentDeleteMutation.mutateAsync(category.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to permanently delete category");
    }
  }

  function openNew(parentId: string | null = null) {
    setNewParentId(parentId);
    setEditing("new");
  }

  function closeModal() {
    setEditing(null);
    setNewParentId(null);
    setError(null);
  }

  const editingCategory = editing && editing !== "new" ? editing : null;
  const childCount = editingCategory ? categories.filter((c) => c.parentId === editingCategory.id).length : 0;
  const form =
    editing !== null ? (
      <>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <CategoryForm
          key={editing === "new" ? `new-${newParentId ?? "root"}` : editing.id}
          categories={categories}
          initial={editing === "new" ? undefined : editing}
          defaultParentId={editing === "new" ? newParentId : undefined}
          onSubmit={handleSubmit}
          onCancel={closeModal}
        />
      </>
    ) : null;

  return (
    <div>
      <PageHeader
        title="Categories"
        action={
          tab === "active" && (
            <Button variant="brass" onClick={() => openNew(null)}>
              <Plus size={16} /> Add category
            </Button>
          )
        }
      />

      <div className="mb-4 flex items-center gap-1 border-b border-ink-100">
        {(["active", "trash"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors",
              tab === t ? "border-ink-900 text-ink-900" : "border-transparent text-ink-400 hover:text-ink-600",
            )}
          >
            {t === "trash" ? "Trash" : "Active"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl border border-ink-100 bg-cream-50" />
          ))}
        </div>
      ) : tab === "trash" ? (
        <TableContainer>
          <Table aria-label="Categories in trash">
            <TableHead>
              <tr>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Slug</TableHeaderCell>
                <TableHeaderCell align="right">Actions</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {categories.length === 0 && (
                <TableMessageRow colSpan={3}>
                  <EmptyState icon={ArchiveX} title="Trash is empty" />
                </TableMessageRow>
              )}
              {categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell className="text-fg-muted">{c.slug}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => restoreMutation.mutate(c.id)}
                        className="text-ink-500 hover:text-ink-900"
                        aria-label="Restore"
                        title="Restore"
                      >
                        <RotateCcw size={16} />
                      </button>
                      {canPurge && (
                        <button
                          onClick={() => handlePermanentDelete(c)}
                          className="text-ink-500 hover:text-danger-600"
                          aria-label="Delete permanently"
                          title="Delete permanently"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </TableContainer>
      ) : (
        <div className={cn(wide && "grid grid-cols-[minmax(420px,1fr)_minmax(400px,520px)] items-start gap-6")}>
        <CategoryTree
          categories={categories}
          stock={stockData?.stock}
          onToggleActive={(category, next) => toggleActiveMutation.mutate({ id: category.id, isActive: next })}
          onEdit={setEditing}
          onDelete={handleDelete}
          onAddChild={(parentId) => openNew(parentId)}
          onReorder={(parentId, orderedIds) =>
            reorderMutation.mutate({ items: orderedIds.map((id, index) => ({ id, sortOrder: index })) })
          }
          onMove={(id, newParentId, sortOrder) => moveMutation.mutate({ id, newParentId, sortOrder })}
          selectedId={wide && editing && editing !== "new" ? editing.id : null}
        />
        {wide && (
          <aside aria-label="Category details" className="sticky top-chrome rounded-2xl border border-line bg-surface p-5 shadow-xs">
            {editing === null ? (
              <div className="py-12 text-center">
                <p className="text-[15px] font-medium text-fg">Select a category</p>
                <p className="mt-1 text-[13px] text-fg-muted">Its details open here. Drag in the list to reorder or move it under another.</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => openNew(null)}>
                  <Plus size={14} aria-hidden="true" /> Add category
                </Button>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-start justify-between gap-3 border-b border-line-subtle pb-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold tracking-tight text-fg">
                      {editing === "new" ? "New category" : editing.name}
                    </h2>
                    {editingCategory && (
                      <p className="mt-0.5 text-[13px] text-fg-muted">
                        /{editingCategory.slug} · {childCount} subcategor{childCount === 1 ? "y" : "ies"}
                        {stockData?.stock?.[editingCategory.id] && (
                          <> · {stockData.stock[editingCategory.id]!.inStockProducts} of {stockData.stock[editingCategory.id]!.totalProducts} products in stock</>
                        )}
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={closeModal} className="rounded-full p-1.5 text-fg-subtle hover:bg-ink-900/[0.05] hover:text-fg" aria-label="Close details">
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
                {form}
              </>
            )}
          </aside>
        )}
        </div>
      )}

      <Modal
        open={!wide && editing !== null}
        onClose={closeModal}
        title={editing === "new" ? "Add category" : `Edit ${editing ? editing.name : ""}`}
      >
        {!wide && form}
      </Modal>
      {confirmDialog}
    </div>
  );
}
