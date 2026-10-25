"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { Table, TableCell, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as mfg from "@/lib/api/manufacturing";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatUnitCost } from "@/components/admin/manufacturing/format";

const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]+$/;

/** Materials (docs/MANUFACTURING.md §3): oil, bottles, boxes, fabric, trims, labels and packaging production uses. They are
 * stock like any item — bought on Stock › Received goods, counted, issued to fills and production — but never sold.
 * Quantities are whole stock units (ml, cm, g, pcs…). */
export default function MaterialsPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("manufacturing.view");
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<mfg.Material | null>(null);
  const query = { q: q.trim() || undefined, includeArchived: showArchived || undefined };
  const list = useQuery({ queryKey: mfg.manufacturingKeys.materials(query), queryFn: () => mfg.listMaterials(query), enabled: allowed });
  const showCost = can("costing.view");
  const canManage = can("manufacturing.manage");
  const canBuy = can("purchasing.receive");
  const canCount = can("inventory.adjust");
  const cols = 4 + (showCost ? 2 : 0);

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Layers} title="Manufacturing isn't available to your role" />
      </div>
    );
  }
  const materials = list.data?.materials ?? [];
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Materials"
        description="What you make products from — oil, bottles, boxes, stickers, fabric, trims, packaging. Bought on Received goods and used by recipes; never sold in the shop."
        action={canManage && <Button size="sm" onClick={() => setCreating(true)} data-testid="new-material"><Plus className="h-4 w-4" /> New material</Button>}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={q} onChange={setQ} placeholder="Search name or SKU" wrapperClassName="w-full sm:w-72" />
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
          <Checkbox checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} data-testid="show-archived" />
          Show archived
        </label>
      </div>
      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Material</TableHeaderCell>
                <TableHeaderCell>SKU</TableHeaderCell>
                <TableHeaderCell align="right">In stock</TableHeaderCell>
                {showCost && <TableHeaderCell align="right">Average cost</TableHeaderCell>}
                {showCost && <TableHeaderCell align="right">Value</TableHeaderCell>}
                <TableHeaderCell align="right"><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {list.isLoading && <TableSkeleton rows={4} cols={cols} />}
              {list.isError && <TableMessageRow colSpan={cols}>Materials couldn&apos;t be loaded. <Button size="sm" variant="ghost" onClick={() => list.refetch()}>Retry</Button></TableMessageRow>}
              {materials.flatMap((m) =>
                m.variants.map((v, i) => (
                  <TableRow key={v.id} data-testid="material-row" className={cn(m.archived && "opacity-60")}>
                    <TableCell>
                      {i === 0 ? (
                        <span className="flex flex-wrap items-center gap-2 font-medium text-ink-900">
                          {m.name}
                          {m.archived && <Badge variant="neutral">Archived</Badge>}
                        </span>
                      ) : <span className="sr-only">{m.name}</span>}
                      <span className="block text-sm text-ink-600">{[v.spec, v.color].filter(Boolean).join(" · ")}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{v.sku}</TableCell>
                    <TableCell align="right" className="whitespace-nowrap tabular-nums">{v.stock.toLocaleString()} {m.stockUnit}</TableCell>
                    {showCost && <TableCell align="right" className="whitespace-nowrap tabular-nums">{v.averageCost === null ? "—" : formatUnitCost(v.averageCost, m.stockUnit)}</TableCell>}
                    {showCost && <TableCell align="right" className="tabular-nums">{v.value === null ? "—" : formatPrice(v.value)}</TableCell>}
                    <TableCell align="right">
                      <div className="flex justify-end gap-1 whitespace-nowrap">
                        {!m.archived && canBuy && <Link href={`/admin/stock?bought=${v.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })} data-testid="material-add-stock">Add stock</Link>}
                        {!m.archived && canCount && <Link href={`/admin/stock?count=${v.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Count</Link>}
                        {i === 0 && canManage && <Button size="sm" variant="outline" onClick={() => setEditing(m)} data-testid="material-edit">Edit</Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                )),
              )}
            </tbody>
          </Table>
        </HScrollShadow>
        {list.isSuccess && materials.length === 0 && (
          <EmptyState
            icon={Layers}
            title={q.trim() ? "No material matches" : "No materials yet"}
            description={q.trim() ? "Try another name or SKU." : "Add the oil, bottles, boxes and packaging your products are made from."}
          />
        )}
      </Card>
      {creating && <MaterialModal onClose={() => setCreating(false)} />}
      {editing && <EditMaterialModal material={editing} showCost={showCost} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MaterialModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [variants, setVariants] = useState([{ key: 1, sku: "", spec: "Standard", color: "" }]);
  const valid = name.trim().length >= 2 && unit.trim() && variants.every((v) => SKU_RE.test(v.sku.trim()));
  const save = useMutation({
    mutationFn: () => mfg.createMaterial({ name: name.trim(), stockUnit: unit.trim(), variants: variants.map((v) => ({ sku: v.sku.trim(), spec: v.spec.trim() || "Standard", color: v.color.trim() || null })) }),
    onSuccess: (m) => { void queryClient.invalidateQueries({ queryKey: mfg.manufacturingKeys.all }); toast.success(`${m.name} added`); onClose(); },
    onError: (err) => toast.error(getErrorMessage(err, "The material couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title="New material" description="Stock is counted in whole stock units — pick the smallest unit you use (ml rather than litre, cm rather than m)." widthClassName="max-w-2xl" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="save-material">Save</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field htmlFor="mat-name" label="Name" required><Input id="mat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="Attar oil — AMBER" /></Field>
          <Field htmlFor="mat-unit" label="Stock unit" required><Input id="mat-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={16} placeholder="ml, g, pcs" /></Field>
        </div>
        <Alert variant="info">It starts at 0. Add stock with Received goods (Stock › Received goods), valued at what you paid.</Alert>
        <SizeRows rows={variants} onChange={setVariants} />
        <Button size="sm" variant="outline" onClick={() => setVariants((vs) => [...vs, { key: Math.max(...vs.map((x) => x.key)) + 1, sku: "", spec: "Standard", color: "" }])}><Plus className="h-4 w-4" /> Size</Button>
      </div>
    </Modal>
  );
}

interface SizeRow { key: number; id?: string; sku: string; spec: string; color: string; stock?: number }

/** SKU · spec · colour per size; a size that already exists (has an id) can be renamed but not removed. */
function SizeRows({ rows, onChange }: { rows: SizeRow[]; onChange: (fn: (rows: SizeRow[]) => SizeRow[]) => void }) {
  const set = (key: number, patch: Partial<SizeRow>) => onChange((vs) => vs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const removable = rows.filter((r) => !r.id).length > (rows.some((r) => r.id) ? 0 : 1);
  return (
    <div className="space-y-2">
      {rows.map((v, i) => (
        <div key={v.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
          <Field htmlFor={`mv-sku-${v.key}`} label={i === 0 ? "SKU" : undefined}><Input id={`mv-sku-${v.key}`} aria-label={`Size ${i + 1} SKU`} value={v.sku} onChange={(e) => set(v.key, { sku: e.target.value })} /></Field>
          <Field htmlFor={`mv-spec-${v.key}`} label={i === 0 ? "Size / spec" : undefined}><Input id={`mv-spec-${v.key}`} aria-label={`Size ${i + 1} specification`} value={v.spec} onChange={(e) => set(v.key, { spec: e.target.value })} /></Field>
          <Field htmlFor={`mv-color-${v.key}`} label={i === 0 ? "Colour" : undefined}><Input id={`mv-color-${v.key}`} aria-label={`Size ${i + 1} colour`} value={v.color} onChange={(e) => set(v.key, { color: e.target.value })} /></Field>
          <IconButton aria-label={`Remove size ${i + 1}`} disabled={Boolean(v.id) || !removable} onClick={() => onChange((vs) => vs.filter((x) => x.key !== v.key))}><Trash2 className="h-4 w-4" /></IconButton>
        </div>
      ))}
    </div>
  );
}

function EditMaterialModal({ material, showCost, onClose }: { material: mfg.Material; showCost: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirmDialog();
  const [name, setName] = useState(material.name);
  const [unit, setUnit] = useState(material.stockUnit ?? "");
  const [description, setDescription] = useState(material.description ?? "");
  const [refCost, setRefCost] = useState(material.referenceCost === null ? "" : String(material.referenceCost));
  const [rows, setRows] = useState<SizeRow[]>(material.variants.map((v, i) => ({ key: i + 1, id: v.id, sku: v.sku, spec: v.spec, color: v.color, stock: v.stock })));
  const [units, setUnits] = useState(material.purchaseUnits.map((u, i) => ({ key: i + 1, label: u.label, factor: String(u.factor) })));
  const unitsOk = units.every((u) => u.label.trim() && Number(u.factor) > 0 && /^\d{1,7}(\.\d{1,4})?$/.test(u.factor.trim()) && u.label.trim().toLowerCase() !== unit.trim().toLowerCase())
    && new Set(units.map((u) => u.label.trim().toLowerCase())).size === units.length;
  const unitsChanged = units.length !== material.purchaseUnits.length || units.some((u, i) => u.label.trim() !== material.purchaseUnits[i]?.label || Number(u.factor) !== material.purchaseUnits[i]?.factor);
  const hasStock = material.variants.some((v) => v.stock !== 0);
  const refNumber = refCost.trim() === "" ? null : Number(refCost);
  const valid = name.trim().length >= 2 && unit.trim().length > 0 && rows.every((r) => SKU_RE.test(r.sku.trim()) && r.spec.trim()) && (refNumber === null || (Number.isFinite(refNumber) && refNumber >= 0)) && unitsOk;
  const done = (msg: string) => { void queryClient.invalidateQueries({ queryKey: mfg.manufacturingKeys.all }); toast.success(msg); onClose(); };

  const save = useMutation({
    mutationFn: () => {
      const renames = rows.filter((r) => r.id).flatMap((r) => {
        const was = material.variants.find((v) => v.id === r.id)!;
        const patch = { id: r.id!, ...(r.sku.trim() !== was.sku ? { sku: r.sku.trim() } : {}), ...(r.spec.trim() !== was.spec ? { spec: r.spec.trim() } : {}), ...(r.color.trim() !== was.color ? { color: r.color.trim() } : {}) };
        return Object.keys(patch).length > 1 ? [patch] : [];
      });
      const added = rows.filter((r) => !r.id).map((r) => ({ sku: r.sku.trim(), spec: r.spec.trim() || "Standard", color: r.color.trim() || null }));
      return mfg.updateMaterial(material.id, {
        ...(name.trim() !== material.name ? { name: name.trim() } : {}),
        ...(unit.trim() !== (material.stockUnit ?? "") ? { stockUnit: unit.trim() } : {}),
        ...(description.trim() !== (material.description ?? "") ? { description: description.trim() || null } : {}),
        ...(showCost && refNumber !== material.referenceCost ? { referenceCost: refNumber } : {}),
        ...(renames.length ? { variants: renames } : {}),
        ...(added.length ? { addVariants: added } : {}),
        ...(unitsChanged ? { purchaseUnits: units.map((u) => ({ label: u.label.trim(), factor: Number(u.factor) })) } : {}),
      });
    },
    onSuccess: (m) => done(`${m.name} saved`),
    onError: (err) => toast.error(getErrorMessage(err, "The material couldn't be saved")),
  });
  const archive = useMutation({
    mutationFn: () => (material.archived ? mfg.materialAction(material.id, "restore") : mfg.materialAction(material.id, "archive")),
    onSuccess: (m) => done(m.archived ? `${m.name} archived` : `${m.name} is back`),
    onError: (err) => toast.error(getErrorMessage(err, "That didn't work")),
  });
  async function onArchive() {
    if (material.archived) return archive.mutate();
    const ok = await confirm(`Archive ${material.name}? It leaves the lists and pickers; its history stays and you can bring it back.`, { confirmLabel: "Archive", title: "Archive material", tone: "default" });
    if (ok) archive.mutate();
  }
  // nothing changed → nothing to send (the API refuses an empty change)
  const dirty = name.trim() !== material.name || unit.trim() !== (material.stockUnit ?? "") || description.trim() !== (material.description ?? "") || (showCost && refNumber !== material.referenceCost)
    || unitsChanged || rows.some((r) => !r.id) || rows.some((r) => { const was = material.variants.find((v) => v.id === r.id); return was && (r.sku.trim() !== was.sku || r.spec.trim() !== was.spec || r.color.trim() !== was.color); });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${material.name}`}
      widthClassName="max-w-2xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={onArchive} loading={archive.isPending} data-testid="material-archive" className={cn(!material.archived && "text-danger-700")}>{material.archived ? "Restore" : "Archive"}</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button loading={save.isPending} disabled={!valid || !dirty} onClick={() => save.mutate()} data-testid="save-material-edit">Save</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field htmlFor="edit-mat-name" label="Name" required><Input id="edit-mat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} /></Field>
          <Field htmlFor="edit-mat-unit" label="Stock unit" required hint={hasStock ? "Locked while it has stock" : undefined}>
            <Input id="edit-mat-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={16} disabled={hasStock} />
          </Field>
        </div>
        {showCost && (
          <Field htmlFor="edit-mat-ref" label={`Reference cost per ${unit || "unit"}`} hint="Used only until the first purchase gives it a real average.">
            <Input id="edit-mat-ref" inputMode="decimal" value={refCost} onChange={(e) => setRefCost(e.target.value)} placeholder="e.g. 38" className="sm:w-48" />
          </Field>
        )}
        <Field htmlFor="edit-mat-desc" label="Notes"><Textarea id="edit-mat-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={2} placeholder="Supplier, grade, how it is stored…" /></Field>
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink-900">Sizes</p>
          <SizeRows rows={rows} onChange={setRows} />
          <Button size="sm" variant="outline" onClick={() => setRows((vs) => [...vs, { key: Math.max(...vs.map((x) => x.key)) + 1, sku: "", spec: "Standard", color: "" }])}><Plus className="h-4 w-4" /> Size</Button>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink-900">You buy it as</p>
          <p className="text-xs text-ink-600">Received goods lets you enter it in these and turns it into {unit || "the stock unit"} — e.g. 1 litre = 1000 ml, 1 dozen = 12 pcs.</p>
          {units.map((u, i) => (
            <div key={u.key} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-end gap-2" data-testid="purchase-unit-row">
              <Field htmlFor={`pu-label-${u.key}`} label={i === 0 ? "Unit" : undefined}><Input id={`pu-label-${u.key}`} aria-label={`Purchase unit ${i + 1}`} value={u.label} maxLength={24} placeholder="litre" onChange={(e) => setUnits((us) => us.map((x) => (x.key === u.key ? { ...x, label: e.target.value } : x)))} /></Field>
              <span className="pb-2.5 text-sm text-ink-600">=</span>
              <Field htmlFor={`pu-factor-${u.key}`} label={i === 0 ? `In ${unit || "stock units"}` : undefined}><Input id={`pu-factor-${u.key}`} aria-label={`${u.label || "Unit"} in ${unit || "stock units"}`} inputMode="decimal" value={u.factor} placeholder="1000" onChange={(e) => setUnits((us) => us.map((x) => (x.key === u.key ? { ...x, factor: e.target.value } : x)))} /></Field>
              <IconButton aria-label={`Remove purchase unit ${i + 1}`} onClick={() => setUnits((us) => us.filter((x) => x.key !== u.key))}><Trash2 className="h-4 w-4" /></IconButton>
            </div>
          ))}
          {!unitsOk && units.length > 0 && <p className="text-sm text-danger-700">Each unit needs a name (not the stock unit itself) and how many {unit || "stock units"} it holds, up to 4 decimals.</p>}
          <Button size="sm" variant="outline" disabled={units.length >= 10} onClick={() => setUnits((us) => [...us, { key: Math.max(0, ...us.map((x) => x.key)) + 1, label: "", factor: "" }])}><Plus className="h-4 w-4" /> Unit</Button>
        </div>
        {material.archived && <Alert variant="info">Archived — restore it to buy, count or use it again.</Alert>}
      </div>
      {dialog}
    </Modal>
  );
}
