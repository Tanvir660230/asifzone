"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveX, Copy, FileSpreadsheet, ImageOff, LayoutGrid, List, MoreHorizontal, Package, Pencil, Plus, RotateCcw, Trash2, XCircle } from "lucide-react";
import { PRODUCT_STATUSES, type Product, type ProductListExtras, type ProductStatus } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/tabs";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { FilterBar, useFilterState } from "@/components/admin/filters";
import { ProductStatusBadge, PRODUCT_STATUS_LABELS } from "@/components/admin/product-status-badge";
import { DuplicateProductDialog } from "@/components/admin/duplicate-product-dialog";
import type { FilterDefinition } from "@/lib/admin/filters";
import { useCapability } from "@/hooks/use-capability";
import { useUrlState } from "@/hooks/use-url-state";
import { urlParam } from "@/lib/url-state";
import * as productsApi from "@/lib/api/products";
import * as categoriesApi from "@/lib/api/categories";
import * as catalogApi from "@/lib/api/catalog";
import { describeApiError } from "@/lib/api-client";
import { PRODUCT_NEW_HREF, productEditHref } from "@/lib/admin-routes";
import { formatCount, formatPrice, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Thumbnail } from "@/components/admin/thumbnail";

type ListedProduct = Product & ProductListExtras & { type?: { id: string; name: string } | null };

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "updated", label: "Recently edited" },
  { value: "name", label: "Name A–Z" },
  { value: "price", label: "Price: low to high" },
  { value: "-price", label: "Price: high to low" },
] as const;

/** List-level state that isn't a filter: active/trash, sort and list/grid — in the URL next to the filters. */
const VIEW_SCHEMA = {
  view: urlParam.enum(["active", "trash"], "active"),
  sort: urlParam.enum(["newest", "updated", "name", "price", "-price"], "newest"),
  layout: urlParam.enum(["list", "grid"], "list"),
};

const STOCK_BADGE: Record<ProductListExtras["stockState"], { variant: "success" | "warning" | "danger" | "neutral"; label: (n: number) => string }> = {
  IN_STOCK: { variant: "success", label: (n) => `${formatCount(n)} in stock` },
  LOW_STOCK: { variant: "warning", label: (n) => `Low · ${formatCount(n)}` },
  OUT_OF_STOCK: { variant: "danger", label: () => "Out of stock" },
  UNLIMITED: { variant: "neutral", label: () => "Not tracked" },
};

/** "৳719" or "৳690 – ৳890" when variants are priced differently. */
function priceLabel(p: ListedProduct) {
  const prices = p.variants.filter((v) => v.isActive !== false).map((v) => Number(v.price ?? p.basePrice));
  if (prices.length === 0) return formatPrice(p.basePrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatPrice(min) : `${formatPrice(min)} – ${formatPrice(max)}`;
}

function Thumb({ p, className }: { p: ListedProduct; className?: string }) {
  const image = p.images[0];
  return (
    <div className={cn("flex shrink-0 items-center justify-center overflow-hidden bg-ink-900/[0.04]", className)}>
      {image ? (
        <Thumbnail src={image.url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <ImageOff size={18} className="text-fg-subtle" aria-label="No image" />
      )}
    </div>
  );
}

/** How complete the product is (the editor's meter): a ring, its score, and what's missing on hover/focus. */
function Completeness({ value }: { value: ListedProduct["completeness"] }) {
  if (!value) return <span className="text-fg-subtle">—</span>;
  const title = value.missing.length ? `Missing: ${value.missing.join(", ")}` : "Everything filled in";
  const tone = value.score >= 90 ? "bg-success-500" : value.score >= 60 ? "bg-warning-500" : "bg-danger-500";
  return (
    <span className="flex items-center gap-2" title={title}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-ink-900/[0.08]" role="meter" aria-valuenow={value.score} aria-valuemin={0} aria-valuemax={100} aria-label={`Completeness. ${title}`}>
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${value.score}%` }} />
      </span>
      <span className="text-[13px] tabular-nums text-fg-muted">{value.score}%</span>
    </span>
  );
}

function StockBadge({ p }: { p: ListedProduct }) {
  const s = STOCK_BADGE[p.stockState];
  return (
    <Badge variant={s.variant} dot>
      {s.label(p.totalStock)}
    </Badge>
  );
}

function RowMenu({ items }: { items: DropdownMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-full text-fg-muted transition-colors duration-fast hover:bg-ink-900/[0.06] hover:text-fg"
      >
        <MoreHorizontal size={17} aria-hidden="true" />
      </button>
      <DropdownMenu open={open} onClose={() => setOpen(false)} anchorRef={ref} items={items} />
    </>
  );
}

/** Catalog › Products (Blueprint V2 P4): every product with its price, stock state and completeness, as a list or a
 * grid; filters, sort, layout and the trash live in the URL. */
export default function ProductsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const canPurge = useCapability("catalog.purge");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [duplicating, setDuplicating] = useState<{ id: string; name: string } | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const { data: typesData } = useQuery({ queryKey: ["catalog-types", "all"], queryFn: () => catalogApi.listTypes(true) });
  const { data: categoriesData } = useQuery({ queryKey: ["categories"], queryFn: () => categoriesApi.listCategories() });
  const types = useMemo(() => typesData?.types ?? [], [typesData]);
  const categories = useMemo(() => categoriesData?.categories ?? [], [categoriesData]);

  const filterDefs = useMemo<readonly FilterDefinition[]>(
    () => [
      { key: "f.status", label: "Status", kind: "select", placement: "quick", options: PRODUCT_STATUSES.map((s) => ({ value: s, label: PRODUCT_STATUS_LABELS[s] })) },
      {
        key: "f.stock",
        label: "Stock",
        kind: "select",
        placement: "quick",
        options: [
          { value: "low", label: "Running low" },
          { value: "out", label: "Out of stock" },
        ],
      },
      { key: "f.type", label: "Product type", kind: "select", options: () => types.map((t) => ({ value: t.typeId, label: t.name })), chip: (label) => `Type: ${label}` },
      { key: "f.category", label: "Category", kind: "select", options: () => categories.map((c) => ({ value: c.id, label: c.name })), chip: (label) => `Category: ${label}` },
    ],
    [types, categories],
  );
  const filters = useFilterState(filterDefs, { pageSizes: [20, 50, 100], defaultPageSize: 20 });
  const [view, setView] = useUrlState(VIEW_SCHEMA);
  const { values } = filters;
  const trash = view.view === "trash";

  const params = {
    page: values.page,
    pageSize: values.size,
    search: values.q || undefined,
    trashed: trash,
    status: ((values["f.status"] as string) || undefined) as ProductStatus | undefined,
    stock: ((values["f.stock"] as string) || undefined) as "low" | "out" | undefined,
    typeId: (values["f.type"] as string) || undefined,
    categoryId: (values["f.category"] as string) || undefined,
    sort: view.sort,
  };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["products", params],
    queryFn: ({ signal }) => productsApi.listProducts(params, { signal }),
    placeholderData: (prev) => prev,
  });
  const items = (data?.items ?? []) as ListedProduct[];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const allSelected = items.length > 0 && items.every((p) => selected.has(p.id));

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["products"] });
    setSelected(new Set());
  }
  const onError = (fallback: string) => (err: unknown) => toast.error(describeApiError(err, fallback));
  const remove = useMutation({ mutationFn: productsApi.deleteProduct, onSuccess: () => (invalidate(), toast.success("Moved to Trash")), onError: onError("Couldn't move it to Trash") });
  const restore = useMutation({ mutationFn: productsApi.restoreProduct, onSuccess: () => (invalidate(), toast.success("Product restored")), onError: onError("Couldn't restore it") });
  const purge = useMutation({ mutationFn: productsApi.permanentlyDeleteProduct, onSuccess: () => (invalidate(), toast.success("Product permanently deleted")), onError: onError("Couldn't delete it") });
  const bulkDelete = useMutation({ mutationFn: productsApi.bulkDeleteProducts, onSuccess: invalidate, onError: onError("Couldn't move them to Trash") });
  const bulkStatus = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: ProductStatus }) => productsApi.bulkUpdateProductStatus(ids, status),
    onSuccess: invalidate,
    onError: onError("Couldn't change the status"),
  });
  const bulkCategory = useMutation({
    mutationFn: ({ ids, categoryId }: { ids: string[]; categoryId: string }) => productsApi.bulkUpdateProductCategory(ids, categoryId),
    onSuccess: invalidate,
    onError: onError("Couldn't move them"),
  });

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkStatus(status: ProductStatus) {
    const ids = [...selected];
    const result = await bulkStatus.mutateAsync({ ids, status });
    const label = PRODUCT_STATUS_LABELS[status].toLowerCase();
    if (result.updated > 0) toast.success(`${result.updated} product${result.updated === 1 ? "" : "s"} set to ${label}`);
    // Products that can't go ready/live aren't an error for the batch — say exactly what each is missing.
    if (result.blocked.length > 0) {
      const first = result.blocked.slice(0, 3).map((b) => `${b.name} (missing ${b.missing.join(", ")})`).join("; ");
      toast.error(`${result.blocked.length} not moved: ${first}${result.blocked.length > 3 ? "…" : ""}`);
    }
    if (result.updated === 0 && result.blocked.length === 0) toast.success(`Already ${label}`);
  }

  function rowMenu(p: ListedProduct): DropdownMenuItem[] {
    if (trash)
      return [
        { label: "Restore", icon: RotateCcw, onClick: () => restore.mutate(p.id) },
        ...(canPurge
          ? [{ label: "Delete permanently", icon: Trash2, destructive: true, onClick: async () => (await confirm(`Permanently delete "${p.name}"? This can't be undone.`)) && purge.mutate(p.id) }]
          : []),
      ];
    return [
      { label: "Edit", icon: Pencil, onClick: () => router.push(productEditHref(p.id)) },
      { label: "Duplicate", icon: Copy, onClick: () => setDuplicating({ id: p.id, name: p.name }) },
      { label: "Move to Trash", icon: Trash2, destructive: true, onClick: async () => (await confirm(`Move "${p.name}" to Trash?`)) && remove.mutate(p.id) },
    ];
  }

  const open = (p: ListedProduct) => !trash && router.push(productEditHref(p.id));
  const renderGrid = () => (
          <div>
            {isLoading && !data && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-ink-900/[0.04]" />
                ))}
              </div>
            )}
            {data && items.length === 0 && <div className="rounded-2xl border border-line bg-surface">{empty}</div>}
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {items.map((p) => {
                const on = selected.has(p.id);
                return (
                  <li key={p.id} className={cn("group relative overflow-hidden rounded-2xl border bg-surface shadow-xs transition-shadow duration-fast hover:shadow-sm", on ? "border-accent ring-2 ring-accent/30" : "border-line")}>
                    <button type="button" onClick={() => open(p)} className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40" disabled={trash} aria-label={`Edit ${p.name}`}>
                      <Thumb p={p} className="aspect-square w-full" />
                      <div className="space-y-1.5 p-3">
                        <p className="line-clamp-2 min-h-[2.5em] text-[13px] font-medium leading-snug text-fg">{p.name}</p>
                        <p className="text-[14px] font-semibold tabular-nums text-fg">{priceLabel(p)}</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StockBadge p={p} />
                        </div>
                      </div>
                    </button>
                    <div className="absolute left-2 top-2 flex items-center gap-1.5">
                      <span className={cn("rounded-md bg-surface/90 p-1 shadow-xs transition-opacity [@media(hover:none)]:opacity-100", on ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100")}>
                        <Checkbox checked={on} onChange={() => toggleOne(p.id)} aria-label={`Select ${p.name}`} />
                      </span>
                    </div>
                    <div className="absolute right-2 top-2 flex items-center gap-1">
                      <ProductStatusBadge status={p.status} className="shadow-xs" />
                    </div>
                    <div className="flex items-center justify-between border-t border-line-subtle px-3 py-2">
                      <Completeness value={p.completeness} />
                      <RowMenu items={rowMenu(p)} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
  );
  const empty = (
    <EmptyState
      icon={trash ? ArchiveX : Package}
      title={trash ? "Trash is empty" : values.q || Object.keys(values).some((k) => k.startsWith("f.") && values[k]) ? "No products match" : "No products yet"}
      description={trash ? undefined : values.q ? "Try another name or SKU, or clear the filters." : undefined}
      action={
        !trash && !values.q ? (
          <Link href={PRODUCT_NEW_HREF}>
            <Button size="sm">
              <Plus size={15} /> Add product
            </Button>
          </Link>
        ) : undefined
      }
    />
  );

  return (
    <div>
      <PageHeader
        title="Products"
        description={data ? `${formatCount(data.total)} ${trash ? "in Trash" : `product${data.total === 1 ? "" : "s"}`}` : undefined}
        action={
          <div className="flex items-center gap-2">
            <Link href="/admin/products/import">
              <Button variant="outline">
                <FileSpreadsheet size={16} /> Import / export
              </Button>
            </Link>
            <Link href={PRODUCT_NEW_HREF}>
              <Button>
                <Plus size={16} /> Add product
              </Button>
            </Link>
          </div>
        }
      />
      <ModuleTabs />
      <DuplicateProductDialog product={duplicating} onClose={() => setDuplicating(null)} />

      <div className="space-y-3">
        <FilterBar
          defs={filterDefs}
          values={values}
          onChange={filters.setFilters}
          search={filters.search}
          onSearchChange={filters.setSearch}
          searchPlaceholder="Search name or SKU…"
          onClearAll={filters.clearAll}
          leading={
            <SegmentedControl
              aria-label="Products or Trash"
              value={view.view}
              onChange={(v) => {
                setSelected(new Set());
                setView({ view: v });
                filters.setPage(1);
              }}
              options={[
                { value: "active", label: "Products" },
                { value: "trash", label: "Trash" },
              ]}
            />
          }
          actions={
            <>
              <Select className="h-9 w-44" value={view.sort} onChange={(e) => setView({ sort: e.target.value as (typeof SORTS)[number]["value"] })} aria-label="Sort products">
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <SegmentedControl
                aria-label="Layout"
                value={view.layout}
                onChange={(v) => setView({ layout: v })}
                options={[
                  { value: "list", label: <List size={16} aria-hidden="true" />, ariaLabel: "List" },
                  { value: "grid", label: <LayoutGrid size={16} aria-hidden="true" />, ariaLabel: "Grid" },
                ]}
              />
            </>
          }
        />

        {isError && !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : view.layout === "grid" ? (
          renderGrid()
        ) : (
          <>
          <div className="sm:hidden">{renderGrid()}</div>
          <TableContainer className="hidden sm:block">
            <Table aria-label="Products">
              <TableHead>
                <tr>
                  <TableHeaderCell className="w-10">
                    <Checkbox checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((p) => p.id)))} aria-label="Select all on this page" />
                  </TableHeaderCell>
                  <TableHeaderCell>Product</TableHeaderCell>
                  <TableHeaderCell className="hidden md:table-cell">Category</TableHeaderCell>
                  <TableHeaderCell align="right">Price</TableHeaderCell>
                  <TableHeaderCell>Stock</TableHeaderCell>
                  <TableHeaderCell className="hidden lg:table-cell">Complete</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell className="hidden xl:table-cell">Edited</TableHeaderCell>
                  <TableHeaderCell className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </tr>
              </TableHead>
              <tbody>
                {isLoading && !data && <TableSkeleton rows={8} cols={9} />}
                {data && items.length === 0 && <TableMessageRow colSpan={9}>{empty}</TableMessageRow>}
                {items.map((p) => {
                  const variantCount = p.variants.filter((v) => v.isActive !== false).length;
                  return (
                    <TableRow key={p.id} className={cn(!trash && "cursor-pointer", selected.has(p.id) && "bg-accent/[0.04]")} onClick={() => open(p)}>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} aria-label={`Select ${p.name}`} />
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-[220px] items-center gap-3">
                          <Thumb p={p} className="h-11 w-11 rounded-lg" />
                          <div className="min-w-0">
                            {trash ? (
                              <p className="truncate font-medium text-fg">{p.name}</p>
                            ) : (
                              <Link href={productEditHref(p.id)} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-fg hover:text-accent">
                                {p.name}
                              </Link>
                            )}
                            <p className="truncate text-[12px] text-fg-subtle">
                              {[p.type?.name, `${variantCount} variant${variantCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-fg-muted md:table-cell">{p.category.name}</TableCell>
                      <TableCell align="right" className="whitespace-nowrap font-medium tabular-nums text-fg">
                        {priceLabel(p)}
                      </TableCell>
                      <TableCell>
                        <StockBadge p={p} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Completeness value={p.completeness} />
                      </TableCell>
                      <TableCell>
                        <ProductStatusBadge status={p.status} />
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-fg-muted xl:table-cell">{timeAgo(p.updatedAt)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <RowMenu items={rowMenu(p)} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </Table>
          </TableContainer>
          </>
        )}

        {data && data.total > data.pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
            <span className="tabular-nums">
              {formatCount((data.page - 1) * data.pageSize + 1)}–{formatCount(Math.min(data.page * data.pageSize, data.total))} of {formatCount(data.total)}
            </span>
            <Pagination page={values.page} totalPages={totalPages} onChange={filters.setPage} className="mt-0" />
          </div>
        )}
      </div>

      <BulkActionBar count={selected.size} itemLabel="products">
        {trash ? (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                await Promise.all([...selected].map((id) => productsApi.restoreProduct(id)));
                toast.success("Products restored");
              } catch (err) {
                toast.error(describeApiError(err, "Couldn't restore every product"));
              } finally {
                invalidate();
              }
            }}
          >
            <RotateCcw size={14} /> Restore
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => handleBulkStatus("PUBLISHED")}>
              Publish
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleBulkStatus("UNPUBLISHED")}>
              Unpublish
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleBulkStatus("DRAFT")}>
              Move to draft
            </Button>
            <Select className="h-8 w-44" value={bulkCategoryId} onChange={(e) => setBulkCategoryId(e.target.value)} aria-label="Move to category">
              <option value="">Move to category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={!bulkCategoryId}
              onClick={async () => {
                await bulkCategory.mutateAsync({ ids: [...selected], categoryId: bulkCategoryId });
                toast.success("Category changed");
                setBulkCategoryId("");
              }}
            >
              Apply
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                const ids = [...selected];
                if (!(await confirm(`Move ${ids.length} product${ids.length === 1 ? "" : "s"} to Trash?`))) return;
                await bulkDelete.mutateAsync(ids);
                toast.success("Moved to Trash");
              }}
            >
              <Trash2 size={14} /> Move to Trash
            </Button>
          </>
        )}
        <button type="button" onClick={() => setSelected(new Set())} className="ml-1 rounded-full p-1 text-fg-subtle hover:text-fg" aria-label="Clear selection">
          <XCircle size={16} aria-hidden="true" />
        </button>
      </BulkActionBar>
      {confirmDialog}
    </div>
  );
}
