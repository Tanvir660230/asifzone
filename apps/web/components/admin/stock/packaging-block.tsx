"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as books from "@/lib/api/finance-books";
import * as stockApi from "@/lib/api/stock";
import { cn } from "@/lib/utils";

/**
 * Packaging (docs/MATERIALS_PURCHASING.md §5): what this product's parcels take — tupi packet and sticker, polybag, hangtag,
 * size sticker — as packing rules that reach it (its own, a size, its category, every parcel). Taken from stock when the
 * courier is booked. A material already in the product's recipe can't be added here (the API refuses it: counted twice).
 */
export function PackagingBlock({ productId, sizes }: { productId: string; sizes: Array<{ variantId: string; label: string }> }) {
  const { can } = useCapabilities();
  const qc = useQueryClient();
  const canEdit = can("finance.configure");
  const key = [...stockApi.stockKeys.all, "packaging", productId] as const;
  const q = useQuery({ queryKey: key, queryFn: () => stockApi.getProductPackaging(productId) });
  const materials = useQuery({ queryKey: stockApi.stockKeys.overview(), queryFn: stockApi.getStockOverview, enabled: canEdit });
  const [adding, setAdding] = useState(false);
  const [material, setMaterial] = useState("");
  const [qty, setQty] = useState("1");
  const [per, setPer] = useState<"UNIT" | "PARCEL">("UNIT");
  const [scope, setScope] = useState("product");
  const refresh = () => { void qc.invalidateQueries({ queryKey: stockApi.stockKeys.all }); void qc.invalidateQueries({ queryKey: books.booksKeys.packaging() }); };
  const add = useMutation({
    mutationFn: () => books.createPackingRule({ scope: scope === "product" ? "PRODUCT" : "VARIANT", scopeId: scope === "product" ? productId : scope, materialVariantId: material, quantity: Number(qty), per }),
    onSuccess: () => { toast.success("Packaging added"); setAdding(false); setMaterial(""); setQty("1"); refresh(); },
    onError: (e) => toast.error(getErrorMessage(e, "The packaging couldn't be added")),
  });
  const toggle = useMutation({
    mutationFn: (r: { id: string; isActive: boolean }) => books.setPackingRuleActive(r.id, r.isActive),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(getErrorMessage(e, "That didn't work")),
  });

  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (q.isError) return <Alert variant="warning" title="Packaging couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>;
  const rules = q.data?.rules ?? [];
  const choices = (materials.data?.groups.find((g) => g.key === "MATERIAL")?.items ?? []);
  const qtyOk = /^\d+$/.test(qty.trim()) && Number(qty) >= 1;

  return (
    <section aria-labelledby={`pack-${productId}`} className="space-y-3" data-testid="packaging-block">
      <div className="flex items-center justify-between gap-3">
        <h3 id={`pack-${productId}`} className="text-sm font-medium text-fg">Packaging <span className="font-normal text-fg-muted">— taken when the courier is booked</span></h3>
        {canEdit && !adding && <Button size="sm" variant="ghost" onClick={() => setAdding(true)} data-testid="packaging-add"><Plus className="h-4 w-4" aria-hidden="true" /> Add</Button>}
      </div>
      {rules.length === 0 && !adding && <p className="text-sm text-fg-muted">No packaging set for this product. Add the packet, polybag or sticker each one goes out in.</p>}
      {rules.length > 0 && (
        <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle">
          {rules.map((r) => (
            <li key={r.id} className={cn("flex flex-wrap items-center justify-between gap-2 px-4 py-2.5", !r.isActive && "opacity-60")} data-testid="packaging-rule">
              <span className="min-w-0 text-sm">
                <span className="font-medium text-fg">{r.material.name}</span>
                <span className="text-fg-muted"> · {r.quantity} {r.material.unit} a {r.per === "UNIT" ? "unit sold" : "parcel"} · {r.appliesTo}</span>
                {!r.isActive && <Badge variant="neutral" className="ml-2">Off</Badge>}
              </span>
              {canEdit && (r.scope === "PRODUCT" || r.scope === "VARIANT") && (
                <Button size="sm" variant="ghost" loading={toggle.isPending && toggle.variables?.id === r.id} onClick={() => toggle.mutate({ id: r.id, isActive: !r.isActive })}>{r.isActive ? "Turn off" : "Turn on"}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="space-y-3 rounded-xl border border-line-subtle p-3 sm:p-4" data-testid="packaging-form">
          <Field htmlFor={`pk-m-${productId}`} label="Material">
            <Select id={`pk-m-${productId}`} value={material} onChange={(e) => setMaterial(e.target.value)} disabled={materials.isLoading} data-testid="packaging-material">
              <option value="">{materials.isLoading ? "Loading…" : "Choose…"}</option>
              {choices.map((m) => <option key={m.variantId} value={m.variantId}>{m.productName}{m.size && m.size !== "Standard" ? ` · ${m.size}` : ""}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field htmlFor={`pk-q-${productId}`} label="How many" error={!qtyOk ? "A whole number" : undefined}>
              <Input id={`pk-q-${productId}`} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field htmlFor={`pk-p-${productId}`} label="For each">
              <Select id={`pk-p-${productId}`} value={per} onChange={(e) => setPer(e.target.value as "UNIT" | "PARCEL")}>
                <option value="UNIT">Unit sold</option>
                <option value="PARCEL">Parcel</option>
              </Select>
            </Field>
            <Field htmlFor={`pk-s-${productId}`} label="Sizes" className="col-span-2 sm:col-span-1">
              <Select id={`pk-s-${productId}`} value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="product">Every size</option>
                {sizes.map((s) => <option key={s.variantId} value={s.variantId}>{s.label} only</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex gap-2">
            <Button size="sm" loading={add.isPending} disabled={!material || !qtyOk} onClick={() => add.mutate()} data-testid="packaging-save">Add packaging</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}
