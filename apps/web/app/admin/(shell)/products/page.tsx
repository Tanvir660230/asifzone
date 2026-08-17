"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, Download, RotateCcw, XCircle, ArchiveX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { PageSizeSelect } from "@/components/admin/page-size-select";
import { Pagination } from "@/components/admin/pagination";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import * as productsApi from "@/lib/api/products";
import * as categoriesApi from "@/lib/api/categories";
import { resolveImageUrl } from "@/lib/image-url";
import { cn, ICON_BUTTON_HIT } from "@/lib/utils";
import { ApiError } from "@/lib/api-client";

function ProductRowCardSkeleton({ first = false }: { first?: boolean }) {
  return (
    <div className={cn("flex animate-pulse items-center gap-3 border-t border-ink-100 p-3.5", first && "border-t-0")}>
      <div className="h-10 w-10 shrink-0 rounded bg-ink-100" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3.5 w-2/3 rounded bg-ink-100" />
        <div className="h-3 w-1/3 rounded bg-ink-50" />
      </div>
    </div>
  );
}

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"active" | "trash">("active");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["products", { page, pageSize, search, tab }],
    queryFn: () => productsApi.listProducts({ page, pageSize, search: search || undefined, trashed: tab === "trash" }),
  });
  const { data: categoriesData } = useQuery({ queryKey: ["categories"], queryFn: () => categoriesApi.listCategories() });
  const categories = categoriesData?.categories ?? [];

  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["products"] });
    setSelected(new Set());
  }

  const deleteMutation = useMutation({
    mutationFn: productsApi.deleteProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Moved to Trash");
    },
  });
  const restoreMutation = useMutation({
    mutationFn: productsApi.restoreProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product restored");
    },
  });
  const permanentDeleteMutation = useMutation({
    mutationFn: productsApi.permanentlyDeleteProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product permanently deleted");
    },
  });
  const bulkDeleteMutation = useMutation({ mutationFn: productsApi.bulkDeleteProducts, onSuccess: invalidate });
  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, isActive }: { ids: string[]; isActive: boolean }) => productsApi.bulkUpdateProductStatus(ids, isActive),
    onSuccess: invalidate,
  });
  const bulkCategoryMutation = useMutation({
    mutationFn: ({ ids, categoryId }: { ids: string[]; categoryId: string }) => productsApi.bulkUpdateProductCategory(ids, categoryId),
    onSuccess: invalidate,
  });

  async function handleDelete(id: string, name: string) {
    if (!(await confirm(`Move "${name}" to Trash?`))) return;
    try {
      await deleteMutation.mutateAsync(id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete product");
    }
  }

  async function handlePermanentDelete(id: string, name: string) {
    if (!(await confirm(`Permanently delete "${name}"? This cannot be undone.`))) return;
    try {
      await permanentDeleteMutation.mutateAsync(id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete product");
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected);
    if (!(await confirm(`Move ${ids.length} product(s) to Trash?`))) return;
    try {
      await bulkDeleteMutation.mutateAsync(ids);
      toast.success(`${ids.length} product(s) moved to Trash`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Bulk delete failed");
    }
  }

  async function handleBulkStatus(isActive: boolean) {
    const ids = Array.from(selected);
    try {
      await bulkStatusMutation.mutateAsync({ ids, isActive });
      toast.success(`${ids.length} product(s) set ${isActive ? "active" : "inactive"}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Bulk update failed");
    }
  }

  async function handleBulkCategory() {
    const ids = Array.from(selected);
    if (!bulkCategoryId) return;
    try {
      await bulkCategoryMutation.mutateAsync({ ids, categoryId: bulkCategoryId });
      toast.success(`${ids.length} product(s) moved to a new category`);
      setBulkCategoryId("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Bulk category change failed");
    }
  }

  const items = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((p) => selected.has(p.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((p) => p.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const csvUrl = useMemo(() => productsApi.downloadProductsCsvUrl(), []);

  // Shared between the desktop table row and the mobile card (below) so the two views can't drift —
  // same reasoning as the Orders/Customers admin pages' renderRowActions split.
  function renderRowActions(p: (typeof items)[number]) {
    return tab === "trash" ? (
      <>
        <button
          onClick={() => restoreMutation.mutate(p.id)}
          className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")}
          aria-label="Restore"
          title="Restore"
        >
          <RotateCcw size={16} />
        </button>
        <button
          onClick={() => handlePermanentDelete(p.id, p.name)}
          className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")}
          aria-label="Delete permanently"
          title="Delete permanently"
        >
          <Trash2 size={16} />
        </button>
      </>
    ) : (
      <>
        <Link
          href={`/admin/products/${p.id}/edit`}
          className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")}
          aria-label="Edit"
          title="Edit"
        >
          <Pencil size={16} />
        </Link>
        <button
          onClick={() => handleDelete(p.id, p.name)}
          className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")}
          aria-label="Delete"
          title="Move to trash"
        >
          <Trash2 size={16} />
        </button>
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="Products"
        action={
          <div className="flex items-center gap-2">
            <a href={csvUrl}>
              <Button variant="outline">
                <Download size={16} /> Export CSV
              </Button>
            </a>
            <Link href="/admin/products/new">
              <Button variant="brass">
                <Plus size={16} /> Add product
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-1 border-b border-ink-100">
        {(["active", "trash"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setPage(1);
              setSelected(new Set());
            }}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors",
              tab === t ? "border-ink-900 text-ink-900" : "border-transparent text-ink-400 hover:text-ink-600",
            )}
          >
            {t === "trash" ? "Trash" : "Active"}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-ink-400" />
          <Input
            placeholder="Search products…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="max-w-xs"
          />
        </div>
        <PageSizeSelect
          value={pageSize}
          onChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brass-300 bg-brass-50/60 px-3 py-2 text-sm">
          <span className="font-medium text-ink-800">{selected.size} selected</span>
          {tab === "active" ? (
            <>
              <Button variant="outline" size="sm" onClick={() => handleBulkStatus(true)}>
                Set active
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleBulkStatus(false)}>
                Set inactive
              </Button>
              <div className="flex items-center gap-1.5">
                <Select className="h-8 w-44" value={bulkCategoryId} onChange={(e) => setBulkCategoryId(e.target.value)}>
                  <option value="">Move to category…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Button variant="outline" size="sm" disabled={!bulkCategoryId} onClick={handleBulkCategory}>
                  Apply
                </Button>
              </div>
              <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                <Trash2 size={14} /> Move to Trash
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!(await confirm(`Restore ${selected.size} product(s)?`))) return;
                await Promise.all(Array.from(selected).map((id) => restoreMutation.mutateAsync(id)));
                invalidate();
              }}
            >
              <RotateCcw size={14} /> Restore selected
            </Button>
          )}
          <button
            onClick={() => setSelected(new Set())}
            className={cn(ICON_BUTTON_HIT, "ml-auto text-ink-400 hover:text-ink-700")}
            aria-label="Clear selection"
          >
            <XCircle size={16} />
          </button>
        </div>
      )}

      {/* sm and up: the table below. Below sm: a card list (below that) — same split as the
          Orders/Customers admin pages. */}
      <div className="hidden overflow-hidden rounded-lg border border-ink-100 bg-cream-50 sm:block">
        <HScrollShadow className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="w-10 px-4 py-3">
                <Checkbox checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="sticky left-0 z-[1] bg-ink-50 px-4 py-3">Product</th>
              <th className="hidden px-4 py-3 sm:table-cell">Category</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={6} cols={7} />}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-400">
                  {tab === "trash" ? (
                    <span className="flex flex-col items-center gap-2">
                      <ArchiveX size={24} className="text-ink-300" />
                      Trash is empty.
                    </span>
                  ) : (
                    "No products yet — add your first one."
                  )}
                </td>
              </tr>
            )}
            {items.map((p) => {
              const totalStock = p.variants.reduce((sum, v) => sum + v.stock, 0);
              const thumb = p.images[0];
              return (
                <tr key={p.id} className="group border-t border-ink-100 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                  <td className="px-4 py-3">
                    <Checkbox checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} aria-label={`Select ${p.name}`} />
                  </td>
                  <td className="sticky left-0 z-[1] bg-cream-50 px-4 py-3 group-hover:bg-ink-50">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-ink-100">
                        {thumb && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={resolveImageUrl(thumb.url)} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                      <span>{p.name}</span>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-ink-500 sm:table-cell">{p.category.name}</td>
                  <td className="px-4 py-3">৳{Number(p.basePrice).toLocaleString()}</td>
                  <td className="px-4 py-3">{totalStock}</td>
                  <td className="px-4 py-3">
                    <Badge className={p.isActive ? "bg-success-100 text-success-700" : ""}>
                      {p.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">{renderRowActions(p)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </HScrollShadow>
      </div>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50 sm:hidden">
        {isLoading && Array.from({ length: 4 }).map((_, i) => <ProductRowCardSkeleton key={i} first={i === 0} />)}
        {!isLoading && items.length === 0 && (
          <div className="px-4 py-10 text-center text-ink-400">
            {tab === "trash" ? (
              <span className="flex flex-col items-center gap-2">
                <ArchiveX size={24} className="text-ink-300" />
                Trash is empty.
              </span>
            ) : (
              "No products yet — add your first one."
            )}
          </div>
        )}
        {!isLoading && items.length > 0 && (
          <div className="flex items-center gap-2 border-b border-ink-100 px-3.5 py-2 text-xs text-ink-500">
            <Checkbox checked={allSelected} onChange={toggleAll} aria-label="Select all" />
            Select all on this page
          </div>
        )}
        {items.map((p) => {
          const totalStock = p.variants.reduce((sum, v) => sum + v.stock, 0);
          const thumb = p.images[0];
          return (
            <div key={p.id} className="border-t border-ink-100 p-3.5 first:border-t-0">
              <div className="flex items-start gap-2.5">
                <Checkbox checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} className="mt-1" aria-label={`Select ${p.name}`} />
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-ink-100">
                  {thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={resolveImageUrl(thumb.url)} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink-900">{p.name}</p>
                  <p className="truncate text-xs text-ink-400">{p.category.name}</p>
                </div>
                <Badge className={cn("shrink-0", p.isActive ? "bg-success-100 text-success-700" : "")}>
                  {p.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>

              <div className="mt-2.5 flex items-center justify-between border-t border-ink-100 pt-2.5 text-sm">
                <span className="font-medium text-ink-900">৳{Number(p.basePrice).toLocaleString()}</span>
                <span className="text-ink-500">{totalStock} in stock</span>
              </div>

              <div className="mt-2.5 flex items-center justify-end gap-3 border-t border-ink-100 pt-2.5">{renderRowActions(p)}</div>
            </div>
          );
        })}
      </div>

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      {confirmDialog}
    </div>
  );
}
