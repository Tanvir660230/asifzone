"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { Table, TableCell, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as mfg from "@/lib/api/manufacturing";
import { formatPrice } from "@/lib/format";
import { formatUnitCost } from "@/components/admin/manufacturing/format";

/** Materials (docs/MANUFACTURING.md §3): fabric, trims, labels and packaging production uses. They are stock like any item —
 * bought on purchase orders, issued to production — but never sold. Quantities are whole stock units (cm, g, pcs…). */
export default function MaterialsPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("manufacturing.view");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const query = { q: q.trim() || undefined };
  const list = useQuery({ queryKey: mfg.manufacturingKeys.materials(query), queryFn: () => mfg.listMaterials(query), enabled: allowed });
  const showCost = can("costing.view");

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Layers} title="Manufacturing isn't available to your role" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Materials"
        description="What production uses — fabric, thread, trims, labels, packaging. Bought on purchase orders and issued to production orders; never sold in the shop."
        action={can("manufacturing.manage") && <Button size="sm" onClick={() => setCreating(true)} data-testid="new-material"><Plus className="h-4 w-4" /> New material</Button>}
      />
      <SearchInput value={q} onChange={setQ} placeholder="Search name or SKU" wrapperClassName="w-full sm:w-72" />
      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>SKU</TableHeaderCell>
                <TableHeaderCell>Material</TableHeaderCell>
                <TableHeaderCell align="right">In stock</TableHeaderCell>
                {showCost && <TableHeaderCell align="right">Average cost</TableHeaderCell>}
                {showCost && <TableHeaderCell align="right">Value</TableHeaderCell>}
              </tr>
            </TableHead>
            <tbody>
              {list.isLoading && <TableSkeleton rows={4} cols={showCost ? 5 : 3} />}
              {list.isError && <TableMessageRow colSpan={5}>Materials couldn&apos;t be loaded. <Button size="sm" variant="ghost" onClick={() => list.refetch()}>Retry</Button></TableMessageRow>}
              {list.data?.materials.flatMap((m) =>
                m.variants.map((v, i) => (
                  <TableRow key={v.id} data-testid="material-row">
                    <TableCell className="whitespace-nowrap font-mono text-xs">{v.sku}</TableCell>
                    <TableCell>
                      {i === 0 ? <span className="font-medium text-ink-900">{m.name}</span> : <span className="sr-only">{m.name}</span>}
                      <span className="block text-sm text-ink-600">{[v.spec, v.color].filter(Boolean).join(" · ")}</span>
                    </TableCell>
                    <TableCell align="right" className="whitespace-nowrap tabular-nums">{v.stock.toLocaleString()} {m.stockUnit}</TableCell>
                    {showCost && <TableCell align="right" className="tabular-nums">{v.averageCost === null ? "—" : formatUnitCost(v.averageCost, m.stockUnit)}</TableCell>}
                    {showCost && <TableCell align="right" className="tabular-nums">{v.value === null ? "—" : formatPrice(v.value)}</TableCell>}
                  </TableRow>
                )),
              )}
            </tbody>
          </Table>
        </HScrollShadow>
        {list.data?.materials.length === 0 && <EmptyState icon={Layers} title="No materials yet" description="Add the fabric, trims and packaging your products are made from." />}
      </Card>
      {creating && <MaterialModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function MaterialModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("cm");
  const [variants, setVariants] = useState([{ key: 1, sku: "", spec: "Standard", color: "" }]);
  const valid = name.trim().length >= 2 && unit.trim() && variants.every((v) => /^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(v.sku.trim()));
  const save = useMutation({
    mutationFn: () => mfg.createMaterial({ name: name.trim(), stockUnit: unit.trim(), variants: variants.map((v) => ({ sku: v.sku.trim(), spec: v.spec.trim() || "Standard", color: v.color.trim() || null })) }),
    onSuccess: (m) => { void queryClient.invalidateQueries({ queryKey: mfg.manufacturingKeys.all }); toast.success(`${m.name} added`); onClose(); },
    onError: (err) => toast.error(getErrorMessage(err, "The material couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title="New material" description="Stock is counted in whole stock units — pick the smallest unit you issue (cm rather than m)." widthClassName="max-w-2xl" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="save-material">Save</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field htmlFor="mat-name" label="Name" required><Input id="mat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="Cotton twill" /></Field>
          <Field htmlFor="mat-unit" label="Stock unit" required><Input id="mat-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={16} placeholder="cm, g, pcs" /></Field>
        </div>
        <Alert variant="info">Stock arrives on a goods receipt (a purchase order) or an inventory adjustment, valued at its cost.</Alert>
        {variants.map((v, i) => (
          <div key={v.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
            <Field htmlFor={`mv-sku-${v.key}`} label={i === 0 ? "SKU" : undefined}><Input id={`mv-sku-${v.key}`} aria-label={`Variant ${i + 1} SKU`} value={v.sku} onChange={(e) => setVariants((vs) => vs.map((x) => (x.key === v.key ? { ...x, sku: e.target.value } : x)))} /></Field>
            <Field htmlFor={`mv-spec-${v.key}`} label={i === 0 ? "Specification" : undefined}><Input id={`mv-spec-${v.key}`} aria-label={`Variant ${i + 1} specification`} value={v.spec} onChange={(e) => setVariants((vs) => vs.map((x) => (x.key === v.key ? { ...x, spec: e.target.value } : x)))} /></Field>
            <Field htmlFor={`mv-color-${v.key}`} label={i === 0 ? "Colour" : undefined}><Input id={`mv-color-${v.key}`} aria-label={`Variant ${i + 1} colour`} value={v.color} onChange={(e) => setVariants((vs) => vs.map((x) => (x.key === v.key ? { ...x, color: e.target.value } : x)))} /></Field>
            <IconButton aria-label={`Remove variant ${i + 1}`} disabled={variants.length === 1} onClick={() => setVariants((vs) => vs.filter((x) => x.key !== v.key))}><Trash2 className="h-4 w-4" /></IconButton>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setVariants((vs) => [...vs, { key: Math.max(...vs.map((x) => x.key)) + 1, sku: "", spec: "Standard", color: "" }])}><Plus className="h-4 w-4" /> Variant</Button>
      </div>
    </Modal>
  );
}
