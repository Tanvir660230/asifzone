"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { addFlashSaleItemSchema, type AddFlashSaleItemInput, type CreateFlashSaleInput, type FlashSale } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import * as flashSalesApi from "@/lib/api/admin-flash-sales";
import * as productsApi from "@/lib/api/products";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";

function statusOf(fs: FlashSale): { label: string; className: string } {
  const now = Date.now();
  if (fs.isActive && new Date(fs.startsAt).getTime() <= now && new Date(fs.endsAt).getTime() >= now) {
    return { label: "Live", className: "bg-success-100 text-success-700" };
  }
  if (new Date(fs.startsAt).getTime() > now) return { label: "Scheduled", className: "bg-info-100 text-info-700" };
  return { label: "Ended", className: "bg-ink-200 text-ink-700" };
}

function toLocalInputValue(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function FlashSalesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["flash-sales"], queryFn: flashSalesApi.listFlashSales });
  const { data: productsData } = useQuery({
    queryKey: ["products", { pageSize: 100 }],
    queryFn: () => productsApi.listProducts({ pageSize: 100 }),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: flashSalesApi.createFlashSale,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["flash-sales"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: flashSalesApi.deleteFlashSale,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flash-sales"] });
      toast.success("Flash sale deleted");
    },
  });
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const input: CreateFlashSaleInput = {
      name: String(form.get("name")),
      startsAt: new Date(String(form.get("startsAt"))),
      endsAt: new Date(String(form.get("endsAt"))),
    };
    try {
      await createMutation.mutateAsync(input);
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create flash sale");
    }
  }

  async function handleDelete(fs: FlashSale) {
    if (!(await confirm(`Delete "${fs.name}"?`))) return;
    await deleteMutation.mutateAsync(fs.id);
  }

  const managing = data?.flashSales.find((fs) => fs.id === managingId) ?? null;

  return (
    <div>
      <PageHeader
        title="Flash Sales"
        action={
          <Button variant="brass" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New flash sale
          </Button>
        }
      />

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <HScrollShadow className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Starts</th>
              <th className="px-4 py-3">Ends</th>
              <th className="px-4 py-3">Products</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={4} cols={6} />}
            {!isLoading && data?.flashSales.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-400">
                  No flash sales yet.
                </td>
              </tr>
            )}
            {data?.flashSales.map((fs) => {
              const status = statusOf(fs);
              return (
                <tr key={fs.id} className="border-t border-ink-100 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                  <td className="px-4 py-3">{fs.name}</td>
                  <td className="px-4 py-3">
                    <Badge className={status.className}>{status.label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-500">{new Date(fs.startsAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-ink-500">{new Date(fs.endsAt).toLocaleString()}</td>
                  <td className="px-4 py-3">{fs.items.length}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">
                      <button onClick={() => setManagingId(fs.id)} className="text-brass-600 hover:underline">
                        Manage
                      </button>
                      <button onClick={() => handleDelete(fs)} className="text-ink-400 hover:text-danger-600">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </HScrollShadow>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New flash sale">
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required placeholder="Weekend Flash Sale" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="startsAt">Starts</Label>
              <Input id="startsAt" name="startsAt" type="datetime-local" required defaultValue={toLocalInputValue(new Date().toISOString())} />
            </div>
            <div>
              <Label htmlFor="endsAt">Ends</Label>
              <Input id="endsAt" name="endsAt" type="datetime-local" required />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brass" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={managing !== null} onClose={() => setManagingId(null)} title={managing?.name ?? ""} widthClassName="max-w-3xl">
        {managing && (
          <FlashSaleItemsManager
            flashSale={managing}
            products={productsData?.items ?? []}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ["flash-sales"] })}
          />
        )}
      </Modal>
      {confirmDialog}
    </div>
  );
}

function FlashSaleItemsManager({
  flashSale,
  products,
  onChanged,
}: {
  flashSale: FlashSale;
  products: Array<{ id: string; name: string; basePrice: string }>;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const availableProducts = products.filter((p) => !flashSale.items.some((i) => i.productId === p.id));

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddFlashSaleItemInput>({
    resolver: zodResolver(addFlashSaleItemSchema),
    defaultValues: { discountType: "PERCENTAGE" },
  });

  async function onAdd(values: AddFlashSaleItemInput) {
    setError(null);
    try {
      await flashSalesApi.addFlashSaleItem(flashSale.id, values);
      reset({ discountType: "PERCENTAGE", productId: "", discountValue: undefined });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add product");
    }
  }

  async function handleRemove(itemId: string) {
    await flashSalesApi.removeFlashSaleItem(flashSale.id, itemId);
    onChanged();
  }

  return (
    <div>
      <div className="mb-4 space-y-2">
        {flashSale.items.map((item) => (
          <div key={item.id} className="flex items-center justify-between border border-ink-100 px-3 py-2 text-sm">
            <span>{item.product?.name}</span>
            <div className="flex items-center gap-3">
              <span className="text-ink-500">
                {item.discountType === "PERCENTAGE" ? `${item.discountValue}% off` : `${formatPrice(item.discountValue)} off`}
              </span>
              <button onClick={() => handleRemove(item.id)} className="text-ink-400 hover:text-danger-600">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {flashSale.items.length === 0 && <p className="text-sm text-ink-400">No products added yet.</p>}
      </div>

      <form onSubmit={handleSubmit(onAdd)} className="border-t border-ink-100 pt-4">
        <p className="mb-2 text-xs uppercase tracking-wide text-ink-500">Add product</p>
        {error && <p className="mb-2 text-xs text-danger-600">{error}</p>}
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2">
          <div>
            <Select {...register("productId")} defaultValue="">
              <option value="" disabled>
                Select product…
              </option>
              {availableProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({formatPrice(p.basePrice)})
                </option>
              ))}
            </Select>
            {errors.productId && <p className="mt-1 text-xs text-danger-600">Select a product</p>}
          </div>
          <Select {...register("discountType")} className="w-28">
            <option value="PERCENTAGE">% off</option>
            <option value="FIXED">৳ off</option>
          </Select>
          <div>
            <Input type="number" step="any" placeholder="Value" {...register("discountValue", { valueAsNumber: true })} className="w-24" />
            {errors.discountValue && <p className="mt-1 text-xs text-danger-600">Required</p>}
          </div>
          <Button type="submit" variant="outline" disabled={isSubmitting}>
            Add
          </Button>
        </div>
      </form>
    </div>
  );
}
