"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { PageSizeSelect } from "@/components/admin/page-size-select";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import * as productsApi from "@/lib/api/products";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/api-client";

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ["products", { page, pageSize, search }],
    queryFn: () => productsApi.listProducts({ page, pageSize, search: search || undefined }),
  });

  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const deleteMutation = useMutation({
    mutationFn: productsApi.deleteProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product deleted");
    },
  });

  async function handleDelete(id: string, name: string) {
    if (!(await confirm(`Delete "${name}"? This cannot be undone.`))) return;
    try {
      await deleteMutation.mutateAsync(id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete product");
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div>
      <PageHeader
        title="Products"
        action={
          <Link href="/admin/products/new">
            <Button variant="brass">
              <Plus size={16} /> Add product
            </Button>
          </Link>
        }
      />

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

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={6} cols={6} />}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-400">
                  No products yet — add your first one.
                </td>
              </tr>
            )}
            {data?.items.map((p) => {
              const totalStock = p.variants.reduce((sum, v) => sum + v.stock, 0);
              const thumb = p.images[0];
              return (
                <tr key={p.id} className="border-t border-ink-100">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-ink-100">
                        {thumb && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`${env.apiUrl}${thumb.url}`} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                      <span>{p.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-500">{p.category.name}</td>
                  <td className="px-4 py-3">৳{Number(p.basePrice).toLocaleString()}</td>
                  <td className="px-4 py-3">{totalStock}</td>
                  <td className="px-4 py-3">
                    <Badge className={p.isActive ? "bg-success-100 text-success-700" : ""}>
                      {p.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">
                      <Link href={`/admin/products/${p.id}/edit`} className="text-ink-500 hover:text-ink-900" aria-label="Edit">
                        <Pencil size={16} />
                      </Link>
                      <button
                        onClick={() => handleDelete(p.id, p.name)}
                        className="text-ink-500 hover:text-danger-600"
                        aria-label="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-ink-500">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
