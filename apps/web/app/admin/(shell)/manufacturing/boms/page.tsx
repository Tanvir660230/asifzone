"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListTree, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { VariantPicker } from "@/components/admin/purchasing/variant-picker";
import { ProductPicker } from "@/components/admin/manufacturing/product-picker";
import { BOM_STATUS_BADGE, BOM_STATUS_LABEL } from "@/components/admin/manufacturing/status";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as mfg from "@/lib/api/manufacturing";
import type { Bom, MaterialSupplier, ProducibleProduct } from "@/lib/api/manufacturing";
import type { PurchasableVariant } from "@/lib/api/purchasing";
import { PermissionState } from "@/components/admin/permission-state";

/** Bills of materials (docs/MANUFACTURING.md §4): what one finished unit takes. Versioned — an approved version is frozen
 * and plans production orders; a change is a new version. */
export default function BomsPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("manufacturing.view");
  const list = useQuery({ queryKey: mfg.manufacturingKeys.boms({}), queryFn: () => mfg.listBoms(), enabled: allowed });
  const [editing, setEditing] = useState<Bom | "new" | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: mfg.manufacturingKeys.all });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "archive" | "copy" }) => mfg.bomAction(id, action),
    onSuccess: (b, v) => { refresh(); toast.success(v.action === "copy" ? `Version ${b.version} created as a draft` : `Version ${b.version} ${BOM_STATUS_LABEL[b.status]}`); },
    onError: (err) => toast.error(getErrorMessage(err, "That didn't work")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => mfg.deleteBom(id),
    onSuccess: () => { refresh(); toast.success("Draft deleted"); },
    onError: (err) => toast.error(getErrorMessage(err, "The draft couldn't be deleted")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <PermissionState icon={ListTree} page="Manufacturing" />
      </div>
    );
  }
  const byProduct = new Map<string, Bom[]>();
  for (const b of list.data?.boms ?? []) byProduct.set(b.product.id, [...(byProduct.get(b.product.id) ?? []), b]);
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Recipes"
        description="What one finished unit takes — oil, bottle, box, sticker, fabric — with expected wastage. An approved version is what filling and production use; approving a new one retires the old."
        action={can("manufacturing.manage") && <Button size="sm" onClick={() => setEditing("new")} data-testid="new-bom"><Plus className="h-4 w-4" /> New recipe</Button>}
      />
      {list.isLoading && <Skeleton className="h-40 w-full" />}
      {list.isError && <Alert variant="danger" title="Recipes couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => list.refetch()}>Retry</Button>}>{getErrorMessage(list.error, "")}</Alert>}
      {list.data?.boms.length === 0 && <EmptyState icon={ListTree} title="No recipes yet" description="Describe what a product is made of so it can be filled or produced." />}
      <div className="space-y-4">
        {[...byProduct.values()].map((versions) => (
          <section key={versions[0]!.product.id} className="space-y-2">
            <h2 className="text-base font-semibold text-ink-900">{versions[0]!.product.name}</h2>
            {versions.map((b) => (
              <Card key={b.id} className="space-y-3 p-4" data-testid="bom-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900">Version {b.version}{b.name ? ` · ${b.name}` : ""}</p>
                  <Badge variant={BOM_STATUS_BADGE[b.status]}>{BOM_STATUS_LABEL[b.status]}</Badge>
                </div>
                <ul className="divide-y divide-line text-sm">
                  {b.lines.map((l) => (
                    <li key={l.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span className="min-w-0"><span className="font-mono text-xs text-ink-600">{l.material.sku}</span> {l.material.name}{l.finishedVariant ? <span className="text-xs text-ink-500"> · only {l.finishedVariant.label}</span> : null}{l.suppliedBy === "PRODUCER" ? <span className="text-xs text-ink-500"> · supplied by the producer</span> : null}</span>
                      <span className="whitespace-nowrap tabular-nums text-ink-700">{Number(l.qtyPerUnit).toLocaleString(undefined, { maximumFractionDigits: 6 })} {l.material.stockUnit}{Number(l.wastagePct) ? ` + ${Number(l.wastagePct)}%` : ""}</span>
                    </li>
                  ))}
                </ul>
                {b.status === "APPROVED" && <RealWastage bom={b} canChange={can("manufacturing.manage")} onDone={refresh} />}
                <div className="flex flex-wrap gap-2">
                  {b.status === "DRAFT" && can("manufacturing.manage") && <Button size="sm" variant="outline" onClick={() => setEditing(b)}>Edit</Button>}
                  {b.status === "DRAFT" && can("manufacturing.approve") && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ id: b.id, action: "approve" })} data-testid="approve-bom">Approve</Button>}
                  {b.status !== "DRAFT" && can("manufacturing.manage") && <Button size="sm" variant="outline" loading={act.isPending} onClick={() => act.mutate({ id: b.id, action: "copy" })}>Copy to new version</Button>}
                  {b.status === "APPROVED" && can("manufacturing.approve") && <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: b.id, action: "archive" })}>Archive</Button>}
                  {b.status === "DRAFT" && can("manufacturing.manage") && <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(b.id)}>Delete draft</Button>}
                </div>
              </Card>
            ))}
          </section>
        ))}
      </div>
      {editing && <BomModal bom={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { refresh(); setEditing(null); }} />}
    </div>
  );
}

interface DraftLine { key: number; material: PurchasableVariant | null; finishedVariantId: string; qtyPerUnit: string; wastagePct: string; suppliedBy: MaterialSupplier }
let k = 0;
const QTY = /^\d{1,12}(\.\d{1,6})?$/;
const PCT = /^\d{1,2}(\.\d{1,2})?$/;

function BomModal({ bom, onClose, onDone }: { bom: Bom | null; onClose: () => void; onDone: () => void }) {
  const [product, setProduct] = useState<ProducibleProduct | null>(bom ? { id: bom.product.id, name: bom.product.name, variants: [] } : null);
  const [anyItem, setAnyItem] = useState(() => Boolean(bom?.lines.some((l) => !l.material.isMaterial)));
  // editing a draft: the product's sizes come from the producible-products lookup, so "Applies to" shows the real size
  const sizesQ = useQuery({ queryKey: mfg.manufacturingKeys.products(bom?.product.name ?? ""), queryFn: () => mfg.searchProducts(bom!.product.name), enabled: Boolean(bom) });
  const sizes = product?.variants.length ? product.variants : sizesQ.data?.products.find((p) => p.id === bom?.product.id)?.variants ?? [];
  const [name, setName] = useState(bom?.name ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    bom
      ? bom.lines.map((l) => ({ key: ++k, material: { id: l.material.variantId, sku: l.material.sku, name: l.material.name, stock: 0 }, finishedVariantId: l.finishedVariant?.id ?? "", qtyPerUnit: String(Number(l.qtyPerUnit)), wastagePct: String(Number(l.wastagePct)), suppliedBy: l.suppliedBy }))
      : [{ key: ++k, material: null, finishedVariantId: "", qtyPerUnit: "", wastagePct: "0", suppliedBy: "BUSINESS" }],
  );
  const set = (key: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const valid = product && lines.length > 0 && lines.every((l) => l.material && QTY.test(l.qtyPerUnit) && Number(l.qtyPerUnit) > 0 && PCT.test(l.wastagePct || "0"));
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim() || null, lines: lines.map((l) => ({ materialVariantId: l.material!.id, finishedVariantId: l.finishedVariantId || null, qtyPerUnit: l.qtyPerUnit, wastagePct: l.wastagePct || "0", suppliedBy: l.suppliedBy })) };
      return bom ? mfg.updateBom(bom.id, body) : mfg.createBom({ ...body, productId: product!.id });
    },
    onSuccess: (b) => { toast.success(`Version ${b.version} saved as a draft`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The recipe couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={bom ? `Edit version ${bom.version}` : "New recipe"} description="Quantities are per finished unit, in each material's stock unit." widthClassName="max-w-3xl" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="save-bom">Save draft</Button></>}>
      <div className="space-y-4">
        {bom ? <p className="text-sm font-medium text-ink-900">{bom.product.name}</p> : <Field htmlFor="bom-product" label="Finished product" required><ProductPicker value={product} onChange={setProduct} /></Field>}
        <Field htmlFor="bom-name" label="Name"><Input id="bom-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. 6 ml bottle with box" /></Field>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
          <Checkbox checked={anyItem} onChange={(e) => setAnyItem(e.target.checked)} data-testid="bom-any-item" />
          Also pick finished products (a part made from another product)
        </label>
        {lines.map((l, i) => (
          <Card key={l.key} className="space-y-3 p-4" data-testid="bom-line">
            <div className="flex items-center justify-between"><span className="text-sm font-medium">Material {i + 1}</span>{lines.length > 1 && <IconButton aria-label={`Remove material ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="h-4 w-4" /></IconButton>}</div>
            <VariantPicker value={l.material} onChange={(material) => set(l.key, { material })} label={`Material ${i + 1}`} kind={anyItem ? undefined : "MATERIAL"} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field htmlFor={`q-${l.key}`} label="Per unit"><Input id={`q-${l.key}`} inputMode="decimal" value={l.qtyPerUnit} onChange={(e) => set(l.key, { qtyPerUnit: e.target.value })} placeholder="37.5" /></Field>
              <Field htmlFor={`w-${l.key}`} label="Wastage %"><Input id={`w-${l.key}`} inputMode="decimal" value={l.wastagePct} onChange={(e) => set(l.key, { wastagePct: e.target.value })} /></Field>
              <Field htmlFor={`s-${l.key}`} label="Supplied by">
                <Select id={`s-${l.key}`} value={l.suppliedBy} onChange={(e) => set(l.key, { suppliedBy: e.target.value as MaterialSupplier })}>
                  <option value="BUSINESS">Us (issued)</option>
                  <option value="PRODUCER">Producer</option>
                </Select>
              </Field>
              <Field htmlFor={`f-${l.key}`} label="Applies to">
                <Select id={`f-${l.key}`} value={l.finishedVariantId} onChange={(e) => set(l.key, { finishedVariantId: e.target.value })} disabled={!sizes.length}>
                  <option value="">Every size</option>
                  {sizes.map((v) => <option key={v.id} value={v.id}>{[v.size, v.color].filter(Boolean).join(" / ")}</option>)}
                  {l.finishedVariantId && !sizes.some((v) => v.id === l.finishedVariantId) && <option value={l.finishedVariantId}>{bom?.lines.find((x) => x.finishedVariant?.id === l.finishedVariantId)?.finishedVariant?.label ?? "This size"}</option>}
                </Select>
              </Field>
            </div>
          </Card>
        ))}
        <Button size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, { key: ++k, material: null, finishedVariantId: "", qtyPerUnit: "", wastagePct: "0", suppliedBy: "BUSINESS" }])}><Plus className="h-4 w-4" /> Material</Button>
      </div>
    </Modal>
  );
}

/** Real wastage (docs/MANUFACTURING.md §4): what the last 90 days' fills and production really used of each material
 * against the recipe. When a material's real wastage differs, a new draft version with the real figures is one tap — the
 * owner still approves it. */
function RealWastage({ bom, canChange, onDone }: { bom: Bom; canChange: boolean; onDone: () => void }) {
  const q = useQuery({ queryKey: [...mfg.manufacturingKeys.boms({}), "wastage", bom.id], queryFn: () => mfg.getBomWastage(bom.id) });
  const used = (q.data?.lines ?? []).filter((l) => l.orders > 0 && l.actualPct !== null);
  // the recipe's wastage per material (the largest when a material has a line per size)
  const recipePct = (materialVariantId: string) => Math.max(0, ...bom.lines.filter((l) => l.material.variantId === materialVariantId).map((l) => Number(l.wastagePct)));
  const differ = used.filter((l) => Math.abs(l.actualPct! - recipePct(l.materialVariantId)) >= 0.5);
  const make = useMutation({
    mutationFn: async () => {
      const copy = await mfg.bomAction(bom.id, "copy");
      const real = new Map(differ.map((l) => [l.materialVariantId, Math.max(0, Math.min(99, l.actualPct!))]));
      return mfg.updateBom(copy.id, { lines: copy.lines.map((l) => ({ materialVariantId: l.material.variantId, finishedVariantId: l.finishedVariant?.id ?? null, qtyPerUnit: l.qtyPerUnit, wastagePct: real.has(l.material.variantId) ? real.get(l.material.variantId)!.toFixed(2) : l.wastagePct, suppliedBy: l.suppliedBy })) });
    },
    onSuccess: (b) => { toast.success(`Version ${b.version} saved as a draft with the real wastage — check and approve it`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The new version couldn't be made")),
  });
  if (q.isLoading || q.isError || !used.length) return null;
  return (
    <div className="rounded-xl bg-surface-muted px-3 py-2.5 text-sm" data-testid="bom-real-wastage">
      <p className="font-medium text-ink-900">Real wastage, last {q.data!.days} days</p>
      <ul className="mt-1 space-y-0.5">
        {used.map((l) => {
          const name = bom.lines.find((x) => x.material.variantId === l.materialVariantId)?.material.name ?? "Material";
          const off = Math.abs(l.actualPct! - recipePct(l.materialVariantId)) >= 0.5;
          return <li key={l.materialVariantId} className="flex flex-wrap justify-between gap-2"><span className="min-w-0 text-ink-700">{name}</span><span className={off ? "tabular-nums text-warning-700" : "tabular-nums text-ink-600"}>recipe {recipePct(l.materialVariantId)}% · real {l.actualPct}% ({l.orders} {l.orders === 1 ? "fill" : "fills"})</span></li>;
        })}
      </ul>
      {differ.length > 0 && canChange && <Button size="sm" variant="outline" className="mt-2" loading={make.isPending} onClick={() => make.mutate()} data-testid="bom-use-real-wastage">New version with the real wastage</Button>}
    </div>
  );
}
