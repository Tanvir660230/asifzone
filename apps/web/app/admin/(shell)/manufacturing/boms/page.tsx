"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListTree, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
        <EmptyState icon={ListTree} title="Manufacturing isn't available to your role" />
      </div>
    );
  }
  const byProduct = new Map<string, Bom[]>();
  for (const b of list.data?.boms ?? []) byProduct.set(b.product.id, [...(byProduct.get(b.product.id) ?? []), b]);
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Bills of materials"
        description="The materials one finished unit takes, with expected wastage. Approve a version to plan production from it; to change it later, copy it to a new version."
        action={can("manufacturing.manage") && <Button size="sm" onClick={() => setEditing("new")} data-testid="new-bom"><Plus className="h-4 w-4" /> New bill of materials</Button>}
      />
      {list.isLoading && <Skeleton className="h-40 w-full" />}
      {list.isError && <Alert variant="danger" title="Bills of materials couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => list.refetch()}>Retry</Button>}>{getErrorMessage(list.error, "")}</Alert>}
      {list.data?.boms.length === 0 && <EmptyState icon={ListTree} title="No bills of materials yet" description="Describe what a product is made of to plan its production." />}
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
  const [name, setName] = useState(bom?.name ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    bom
      ? bom.lines.map((l) => ({ key: ++k, material: { id: l.material.variantId, sku: l.material.sku, name: l.material.name, stock: 0 }, finishedVariantId: l.finishedVariant?.id ?? "", qtyPerUnit: l.qtyPerUnit.replace(/\.?0+$/, ""), wastagePct: l.wastagePct.replace(/\.?0+$/, ""), suppliedBy: l.suppliedBy }))
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
    onError: (err) => toast.error(getErrorMessage(err, "The bill of materials couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={bom ? `Edit version ${bom.version}` : "New bill of materials"} description="Quantities are per finished unit, in each material's stock unit." widthClassName="max-w-3xl" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="save-bom">Save draft</Button></>}>
      <div className="space-y-4">
        {bom ? <p className="text-sm font-medium text-ink-900">{bom.product.name}</p> : <Field htmlFor="bom-product" label="Finished product" required><ProductPicker value={product} onChange={setProduct} /></Field>}
        <Field htmlFor="bom-name" label="Name"><Input id="bom-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Classic cap — cotton" /></Field>
        {lines.map((l, i) => (
          <Card key={l.key} className="space-y-3 p-4" data-testid="bom-line">
            <div className="flex items-center justify-between"><span className="text-sm font-medium">Material {i + 1}</span>{lines.length > 1 && <IconButton aria-label={`Remove material ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="h-4 w-4" /></IconButton>}</div>
            <VariantPicker value={l.material} onChange={(material) => set(l.key, { material })} label={`Material ${i + 1}`} />
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
                <Select id={`f-${l.key}`} value={l.finishedVariantId} onChange={(e) => set(l.key, { finishedVariantId: e.target.value })} disabled={!product?.variants.length}>
                  <option value="">Every variant</option>
                  {product?.variants.map((v) => <option key={v.id} value={v.id}>{v.size} / {v.color}</option>)}
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
