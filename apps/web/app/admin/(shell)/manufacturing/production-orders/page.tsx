"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Factory, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Table, TableCell, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { ProductPicker } from "@/components/admin/manufacturing/product-picker";
import { SizeColorGrid } from "@/components/admin/manufacturing/size-color-grid";
import { MO_STATUS_BADGE, MO_STATUS_LABEL } from "@/components/admin/manufacturing/status";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as mfg from "@/lib/api/manufacturing";
import type { ProducibleProduct, ProductionOrderStatus } from "@/lib/api/manufacturing";
import * as purchasingApi from "@/lib/api/purchasing";
import { formatPrice } from "@/lib/format";
import { PermissionState } from "@/components/admin/permission-state";

/** Production orders (docs/MANUFACTURING.md §5): what is being made, by whom, in which sizes and colours, from which
 * materials, at what planned cost. */
export default function ProductionOrdersPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("manufacturing.view");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const query = { status: status || undefined, q: q.trim() || undefined, pageSize: 100 };
  const list = useQuery({ queryKey: mfg.manufacturingKeys.orders(query), queryFn: () => mfg.listProductionOrders(query), enabled: allowed });
  const setup = useQuery({ queryKey: mfg.manufacturingKeys.status(), queryFn: mfg.manufacturingStatus, enabled: allowed });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <PermissionState icon={Factory} page="Manufacturing" />
      </div>
    );
  }
  const showCost = can("costing.view");
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Production runs"
        description="Products you commission from a factory or make in-house — planned by size and colour, with the materials and costs they need."
        action={can("manufacturing.manage") && <Button size="sm" onClick={() => setCreating(true)} data-testid="new-mo"><Plus className="h-4 w-4" /> New production run</Button>}
      />
      {setup.data && !setup.data.readiness.ready && <SetupNotice canSetUp={can("finance.configure")} />}
      <div className="flex flex-wrap gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search number, product or producer" wrapperClassName="w-full sm:w-72" />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-48">
          <option value="">Every status</option>
          {(Object.keys(MO_STATUS_LABEL) as ProductionOrderStatus[]).map((s) => <option key={s} value={s}>{MO_STATUS_LABEL[s]}</option>)}
        </Select>
      </div>
      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Order</TableHeaderCell>
                <TableHeaderCell>Product</TableHeaderCell>
                <TableHeaderCell>Producer</TableHeaderCell>
                <TableHeaderCell align="right">Units</TableHeaderCell>
                <TableHeaderCell>Expected</TableHeaderCell>
                {showCost && <TableHeaderCell align="right">Planned cost</TableHeaderCell>}
                <TableHeaderCell>Status</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {list.isLoading && <TableSkeleton rows={5} cols={showCost ? 7 : 6} />}
              {list.isError && <TableMessageRow colSpan={7}>Production orders couldn&apos;t be loaded. <Button size="sm" variant="ghost" onClick={() => list.refetch()}>Retry</Button></TableMessageRow>}
              {list.data?.productionOrders.map((o) => (
                <TableRow key={o.id} interactive data-testid="mo-row">
                  <TableCell className="whitespace-nowrap font-mono text-xs"><Link href={`/admin/manufacturing/production-orders/${o.id}`} className="underline-offset-4 hover:underline">{o.number}</Link></TableCell>
                  <TableCell>{o.product.name}</TableCell>
                  <TableCell>{o.inHouse ? "In-house" : o.producer?.displayName}</TableCell>
                  <TableCell align="right" className="tabular-nums">{o.plannedUnits.toLocaleString()}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{o.expectedDate ?? "—"}</TableCell>
                  {showCost && <TableCell align="right" className="tabular-nums">{o.planned ? formatPrice(o.planned.totalCost) : "—"}</TableCell>}
                  <TableCell><Badge variant={MO_STATUS_BADGE[o.status]}>{MO_STATUS_LABEL[o.status]}</Badge></TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
        {list.data?.productionOrders.length === 0 && <EmptyState icon={Factory} title="No production runs" description={status || q ? "Nothing matches these filters." : "Plan your first production run."} />}
      </Card>
      {creating && <ProductionOrderModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function SetupNotice({ canSetUp }: { canSetUp: boolean }) {
  const queryClient = useQueryClient();
  const run = useMutation({
    mutationFn: mfg.setupManufacturing,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: mfg.manufacturingKeys.all }); toast.success("Manufacturing is set up"); },
    onError: (err) => toast.error(getErrorMessage(err, "Set-up failed")),
  });
  return (
    <Alert variant="warning" title="Manufacturing isn't set up yet" action={canSetUp ? <Button size="sm" loading={run.isPending} onClick={() => run.mutate()} data-testid="mfg-setup">Set up</Button> : undefined}>
      It adds the work-in-progress and production-cost accounts and the default cost categories.{canSetUp ? "" : " Ask the owner to set it up."}
    </Alert>
  );
}

let k = 0;

function ProductionOrderModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [product, setProduct] = useState<ProducibleProduct | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [producer, setProducer] = useState("");
  const [bomId, setBomId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [terms, setTerms] = useState("");
  const [costs, setCosts] = useState<Array<{ key: number; categoryId: string; amount: string; basis: string }>>([]);
  const suppliers = useQuery({ queryKey: purchasingApi.purchasingKeys.suppliers({ status: "ACTIVE" }), queryFn: () => purchasingApi.listSuppliers({ status: "ACTIVE", pageSize: 200 }) });
  const boms = useQuery({ queryKey: mfg.manufacturingKeys.boms({ productId: product?.id, status: "APPROVED" }), queryFn: () => mfg.listBoms({ productId: product!.id, status: "APPROVED" }), enabled: Boolean(product) });
  const categories = useQuery({ queryKey: mfg.manufacturingKeys.categories(), queryFn: () => mfg.listCostCategories(true) });
  const lines = Object.entries(qty).filter(([, n]) => n > 0).map(([variantId, plannedQty]) => ({ variantId, plannedQty }));
  const valid = product && lines.length > 0 && costs.every((c) => c.categoryId && c.amount.trim() !== "" && Number(c.amount) >= 0);
  const create = useMutation({
    mutationFn: () =>
      mfg.createProductionOrder({
        productId: product!.id,
        producerSupplierId: producer && producer !== "IN_HOUSE" ? producer : null,
        bomId: bomId || null,
        expectedDate: expectedDate || null,
        terms: terms.trim() || null,
        lines,
        plannedCosts: costs.map((c) => ({ categoryId: c.categoryId, amount: Number(c.amount), basis: c.basis.trim() || null })),
      }),
    onSuccess: (o) => { void queryClient.invalidateQueries({ queryKey: mfg.manufacturingKeys.all }); toast.success(`${o.number} saved as a draft`); router.push(`/admin/manufacturing/production-orders/${o.id}`); },
    onError: (err) => toast.error(getErrorMessage(err, "The production run couldn't be saved")),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="New production run"
      description="Saved as a draft: materials are worked out from the bill of materials; approve it to start."
      widthClassName="max-w-4xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={create.isPending} disabled={!valid} onClick={() => create.mutate()} data-testid="save-mo">Save draft</Button></>}
    >
      <div className="space-y-5">
        <Field htmlFor="mo-product" label="Product to make" required><ProductPicker value={product} onChange={(p) => { setProduct(p); setQty({}); setBomId(""); }} /></Field>
        {product && (
          <>
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink-900">Quantities by size and colour</p>
              <SizeColorGrid product={product} quantities={qty} onChange={(id, n) => setQty((q) => ({ ...q, [id]: n }))} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field htmlFor="mo-producer" label="Made by">
                <Select id="mo-producer" value={producer} onChange={(e) => setProducer(e.target.value)}>
                  <option value="">Choose…</option>
                  <option value="IN_HOUSE">In-house</option>
                  {suppliers.data?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.displayName} ({s.code})</option>)}
                </Select>
              </Field>
              <Field htmlFor="mo-bom" label="Bill of materials" hint={boms.data && !boms.data.boms.length ? "No approved version yet — materials can be planned by hand later." : undefined}>
                <Select id="mo-bom" value={bomId} onChange={(e) => setBomId(e.target.value)}>
                  <option value="">None</option>
                  {boms.data?.boms.map((b) => <option key={b.id} value={b.id}>Version {b.version}{b.name ? ` · ${b.name}` : ""}</option>)}
                </Select>
              </Field>
              <Field htmlFor="mo-expected" label="Expected delivery"><Input id="mo-expected" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></Field>
            </div>
            <Field htmlFor="mo-terms" label="Agreed rate & terms" hint="As agreed with the producer, e.g. 45 per piece, 50% advance."><Textarea id="mo-terms" rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink-900">Planned costs (besides materials)</p>
              {costs.map((c) => (
                <div key={c.key} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_auto] items-end gap-2">
                  <Select aria-label="Cost category" value={c.categoryId} onChange={(e) => setCosts((cs) => cs.map((x) => (x.key === c.key ? { ...x, categoryId: e.target.value } : x)))}>
                    <option value="">Category…</option>
                    {categories.data?.categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                  </Select>
                  <Input aria-label="Amount" inputMode="decimal" value={c.amount} onChange={(e) => setCosts((cs) => cs.map((x) => (x.key === c.key ? { ...x, amount: e.target.value } : x)))} placeholder="Amount" />
                  <Input aria-label="How it was estimated" value={c.basis} onChange={(e) => setCosts((cs) => cs.map((x) => (x.key === c.key ? { ...x, basis: e.target.value } : x)))} placeholder="e.g. 1,000 × 45" />
                  <IconButton aria-label="Remove cost" onClick={() => setCosts((cs) => cs.filter((x) => x.key !== c.key))}><Trash2 className="h-4 w-4" /></IconButton>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setCosts((cs) => [...cs, { key: ++k, categoryId: "", amount: "", basis: "" }])}><Plus className="h-4 w-4" /> Planned cost</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
