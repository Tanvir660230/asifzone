"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Power, Trash2, Zap } from "lucide-react";
import { addFlashSaleItemSchema, flashSalePhase, type AddFlashSaleItemInput, type CreateFlashSaleInput, type FlashSale } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { ListPage } from "@/components/admin/patterns/list-page";
import { EmptyState } from "@/components/admin/empty-state";
import { DataTable, type DataTableColumn, type DataTableRowAction } from "@/components/admin/data-table";
import { ProductPicker } from "@/components/admin/product-picker";
import * as flashSalesApi from "@/lib/api/admin-flash-sales";
import { formatPrice, formatStoreDateTime, storeCurrencySymbol } from "@/lib/format";
import { ApiError } from "@/lib/api-client";

/** Same rule the server prices with (packages/shared flashSalePhase): live = switched on and inside the window. */
function statusOf(fs: FlashSale): { label: string; variant: "neutral" | "success" | "info" | "warning" | "danger" | "accent" } {
  switch (flashSalePhase(fs)) {
    case "LIVE":
      return { label: "Live", variant: "success" };
    case "SCHEDULED":
      return { label: "Scheduled", variant: "info" };
    case "DISABLED":
      return { label: "Off", variant: "warning" };
    default:
      return { label: "Ended", variant: "neutral" };
  }
}

function toLocalInputValue(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function FlashSalesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error: loadError, refetch } = useQuery({ queryKey: ["flash-sales"], queryFn: flashSalesApi.listFlashSales });

  const [showCreate, setShowCreate] = useState(false);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: flashSalesApi.createFlashSale,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["flash-sales"] }),
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => flashSalesApi.updateFlashSale(id, { enabled }),
    onSuccess: (_data, { enabled }) => {
      queryClient.invalidateQueries({ queryKey: ["flash-sales"] });
      toast.success(enabled ? "Flash sale switched on" : "Flash sale switched off — it stays off until you switch it on");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to update flash sale"),
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
      enabled: true,
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

  const columns: DataTableColumn<FlashSale>[] = [
    { id: "name", header: "Name", card: "title", cell: (fs) => <span className="font-medium text-ink-900">{fs.name}</span> },
    {
      id: "status",
      header: "Status",
      cell: (fs) => {
        const status = statusOf(fs);
        return <Badge variant={status.variant}>{status.label}</Badge>;
      },
    },
    { id: "starts", header: "Starts", cell: (fs) => <span className="text-ink-500">{formatStoreDateTime(fs.startsAt)}</span> },
    { id: "ends", header: "Ends", cell: (fs) => <span className="text-ink-500">{formatStoreDateTime(fs.endsAt)}</span> },
    { id: "products", header: "Products", align: "right", className: "w-24", cell: (fs) => <span className="tabular-nums">{fs.items.length}</span> },
  ];
  const rowActions = (fs: FlashSale): DataTableRowAction<FlashSale>[] => [
    { label: "Manage products", icon: Pencil, onSelect: () => setManagingId(fs.id) },
    ...(new Date(fs.endsAt).getTime() >= Date.now()
      ? [{ label: fs.enabled ? "Switch off" : "Switch on", icon: Power, disabled: toggleMutation.isPending, onSelect: () => toggleMutation.mutate({ id: fs.id, enabled: !fs.enabled }) }]
      : []),
    { label: "Delete", icon: Trash2, destructive: true, onSelect: () => void handleDelete(fs) },
  ];

  return (
    <ListPage
      title="Flash sales"
      action={
        <Button variant="brass" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New flash sale
        </Button>
      }
    >
      <DataTable<FlashSale>
        caption="Flash sales"
        columns={columns}
        rows={isLoading ? undefined : data?.flashSales}
        getRowId={(row) => row.id}
        loading={isLoading}
        error={loadError}
        onRetry={() => void refetch()}
        empty={<EmptyState
            icon={Zap}
            title="No flash sales yet"
            description="A flash sale lowers chosen products' prices for a set time, with a countdown on the storefront."
            action={<Button size="sm" onClick={() => setShowCreate(true)}><Plus size={16} /> New flash sale</Button>}
            variant="bordered"
          />}
        density="dense"
        onRowOpen={(fs) => setManagingId(fs.id)}
        rowActions={rowActions}
      />

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
            onChanged={() => queryClient.invalidateQueries({ queryKey: ["flash-sales"] })}
          />
        )}
      </Modal>
      {confirmDialog}
    </ListPage>
  );
}

function FlashSaleItemsManager({
  flashSale,
  onChanged,
}: {
  flashSale: FlashSale;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // A single product "selected" via the same searchable ProductPicker used elsewhere in the admin
  // (coupon-form) — search is real (server-side, debounced) rather than a flat <select> of every
  // product in the catalog, and the parent no longer needs to eagerly fetch up to 100 products on
  // every page load just in case this modal gets opened.
  const [selectedProduct, setSelectedProduct] = useState<{ id: string; name: string } | null>(null);

  const {
    handleSubmit,
    register,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddFlashSaleItemInput>({
    resolver: zodResolver(addFlashSaleItemSchema),
    defaultValues: { discountType: "PERCENTAGE", productId: "" },
  });

  function pickProduct(next: Array<{ id: string; name: string }>) {
    // ProductPicker is built for multi-select (chips); picking a second product here replaces the
    // first rather than adding to it, since this form only ever submits one productId at a time.
    const product = next[next.length - 1] ?? null;
    setSelectedProduct(product);
    setValue("productId", product?.id ?? "", { shouldValidate: true });
  }

  async function onAdd(values: AddFlashSaleItemInput) {
    setError(null);
    try {
      await flashSalesApi.addFlashSaleItem(flashSale.id, values);
      reset({ discountType: "PERCENTAGE", productId: "", discountValue: undefined });
      setSelectedProduct(null);
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
        <ProductPicker selected={selectedProduct ? [selectedProduct] : []} onChange={pickProduct} />
        {errors.productId && <p className="ui-field-error">Select a product</p>}

        <div className="mt-3 grid grid-cols-[auto_auto_auto] items-start gap-2">
          <Select {...register("discountType")} className="w-28">
            <option value="PERCENTAGE">% off</option>
            <option value="FIXED">{storeCurrencySymbol()} off</option>
          </Select>
          <div>
            <Input type="number" step="any" placeholder="Value" {...register("discountValue", { valueAsNumber: true })} className="w-24" />
            {errors.discountValue && <p className="ui-field-error">Required</p>}
          </div>
          <Button type="submit" variant="outline" disabled={isSubmitting}>
            Add
          </Button>
        </div>
      </form>
    </div>
  );
}
