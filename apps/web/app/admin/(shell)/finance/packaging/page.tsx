"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { ProductPicker } from "@/components/admin/product-picker";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import { listCategories } from "@/lib/api/categories";
import * as booksApi from "@/lib/api/finance-books";
import type { PackagingOverview, PackingScope } from "@/lib/api/finance-books";
import { formatBookDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const SCOPE_LABEL: Record<PackingScope, string> = { EVERY_PARCEL: "Every parcel", CATEGORY: "Category", PRODUCT: "Product", VARIANT: "Variant" };

/** Owner's books §6.2: what a parcel uses (poly, box, sticker), taken from stock when it leaves at its real cost, and how
 * long each material lasts at the current pace. */
export default function PackagingPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const data = useQuery({ queryKey: booksApi.booksKeys.packaging(), queryFn: booksApi.getPackaging, enabled: allowed });
  const [adding, setAdding] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: booksApi.booksKeys.all });
  const run = useMutation({
    mutationFn: booksApi.syncOwnerBooks,
    onSuccess: (r) => { refresh(); toast.success(r.packaging.short.length ? `${r.packaging.movements} taken; ${r.packaging.short.length} short — buy more` : `${r.packaging.movements} packaging use${r.packaging.movements === 1 ? "" : "s"} recorded`); },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't run it now")),
  });
  const toggle = useMutation({ mutationFn: (v: { id: string; on: boolean }) => booksApi.setPackingRuleActive(v.id, v.on), onSuccess: refresh, onError: (e) => toast.error(getErrorMessage(e, "Couldn't change the rule")) });

  if (ready && !allowed) return <div><ModuleTabs /><EmptyState icon={Package} title="Packaging isn't available to your role" /></div>;
  const d = data.data;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Packaging"
        description="Poly bags, boxes and stickers are bought like stock. Each parcel takes what its rule says when it leaves — at its real cost — so every order's profit carries its packaging."
        action={(
          <div className="flex flex-wrap gap-2" data-phone-row>
            {can("finance.reconcile") && <Button size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate()}><RefreshCw className="h-4 w-4" /> Run now</Button>}
            {can("finance.configure") && <Button size="sm" onClick={() => setAdding(true)} disabled={!d?.materials.length} data-testid="new-packing-rule"><Plus className="h-4 w-4" /> Rule</Button>}
          </div>
        )}
      />
      {data.isLoading && <Skeleton className="h-40 w-full" />}
      {data.isError && <Alert variant="danger" title="Packaging couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => data.refetch()}>Retry</Button>}>{getErrorMessage(data.error, "")}</Alert>}
      {d && (
        <>
          {d.materials.length === 0 && (
            <Alert variant="info" title="Add your packaging as materials first">
              In <Link href="/admin/manufacturing/materials" className="text-accent hover:underline">Inventory › Materials</Link> (e.g. “Poly bag 10×14”, unit pcs), then buy it on a purchase order so it has a real cost.
            </Alert>
          )}
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-fg">Rules</h2>
            {d.rules.length === 0 ? (
              <p className="text-sm text-fg-muted">No rules yet. Start with “every parcel: 1 poly bag”, then add one per product that needs its own box.</p>
            ) : (
              <Card className="divide-y divide-line p-0 text-sm">
                {d.rules.map((r) => (
                  <div key={r.id} className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", !r.isActive && "opacity-60")} data-testid="packing-rule">
                    <span className="min-w-0">
                      <span className="block text-fg">{r.quantity} × {r.material.product.name}{r.material.size && r.material.size !== "Default" ? ` (${r.material.size})` : ""} {r.per === "UNIT" ? "per item" : "per parcel"}</span>
                      <span className="block text-xs text-fg-muted">{SCOPE_LABEL[r.scope]}{r.scopeName ? `: ${r.scopeName}` : ""} · from {formatBookDate(r.createdOn)}{r.notes ? ` · ${r.notes}` : ""}</span>
                    </span>
                    {can("finance.configure") && <Switch checked={r.isActive} onChange={(on) => toggle.mutate({ id: r.id, on })} aria-label={r.isActive ? "Switch the rule off" : "Switch the rule on"} />}
                  </div>
                ))}
              </Card>
            )}
          </section>
          {d.materials.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-fg">Materials and how long they last</h2>
              <Card className="overflow-hidden p-0">
                <Table>
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Material</TableHeaderCell>
                      <TableHeaderCell align="right">In stock</TableHeaderCell>
                      <TableHeaderCell align="right">Used, last 30 days</TableHeaderCell>
                      <TableHeaderCell align="right">Lasts until</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <tbody>
                    {d.materials.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell><span className="block text-fg">{m.name}</span><span className="block text-xs text-fg-muted">{m.sku}</span></TableCell>
                        <TableCell align="right" className="tabular-nums">{m.stock} {m.unit ?? ""}</TableCell>
                        <TableCell align="right" className="tabular-nums">{m.usedLast30Days}</TableCell>
                        <TableCell align="right">{m.runsOutOn ? <span className="flex items-center justify-end gap-2">{m.low && <Badge variant="warning">buy soon</Badge>}{formatBookDate(m.runsOutOn)}</span> : <span className="text-fg-muted">—</span>}</TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </section>
          )}
        </>
      )}
      {adding && d && <RuleModal materials={d.materials} onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />}
    </div>
  );
}

function RuleModal({ materials, onClose, onDone }: { materials: PackagingOverview["materials"]; onClose: () => void; onDone: () => void }) {
  const [scope, setScope] = useState<PackingScope>("EVERY_PARCEL");
  const [categoryId, setCategoryId] = useState("");
  const [product, setProduct] = useState<Array<{ id: string; name: string }>>([]);
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [per, setPer] = useState<"PARCEL" | "UNIT">("PARCEL");
  const categories = useQuery({ queryKey: ["categories", "list"], queryFn: () => listCategories(), enabled: scope === "CATEGORY" });
  const scopeId = scope === "CATEGORY" ? categoryId : scope === "PRODUCT" ? product[0]?.id ?? "" : null;
  const valid = Boolean(materialId) && Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && (scope === "EVERY_PARCEL" || Boolean(scopeId));
  const save = useMutation({
    mutationFn: () => booksApi.createPackingRule({ scope, scopeId, materialVariantId: materialId, quantity: Number(quantity), per }),
    onSuccess: () => { toast.success("Rule added — parcels leaving from now on use it"); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The rule couldn't be added")),
  });
  return (
    <Modal open onClose={onClose} title="Packing rule" description="Applies to parcels that leave from now on. To change a rule, switch it off and add a new one." widthClassName="max-w-lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-packing-rule">Add rule</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="pr-scope" label="For">
          <Select id="pr-scope" value={scope} onChange={(e) => setScope(e.target.value as PackingScope)}>
            <option value="EVERY_PARCEL">Every parcel</option>
            <option value="CATEGORY">A category</option>
            <option value="PRODUCT">A product</option>
          </Select>
        </Field>
        <Field htmlFor="pr-per" label="Counted">
          <Select id="pr-per" value={per} onChange={(e) => setPer(e.target.value as "PARCEL" | "UNIT")}><option value="PARCEL">Once per parcel</option><option value="UNIT">For each item in it</option></Select>
        </Field>
        {scope === "CATEGORY" && (
          <Field htmlFor="pr-cat" label="Category" required className="sm:col-span-2">
            <Select id="pr-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Choose…</option>{(categories.data?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </Field>
        )}
        {scope === "PRODUCT" && (
          <div className="sm:col-span-2"><p className="mb-1.5 text-sm font-medium text-fg">Product</p><ProductPicker selected={product} onChange={(s) => setProduct(s.slice(-1))} /></div>
        )}
        <Field htmlFor="pr-mat" label="Uses" required>
          <Select id="pr-mat" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>{materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.sku})</option>)}</Select>
        </Field>
        <Field htmlFor="pr-qty" label="How many" required><Input id="pr-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
