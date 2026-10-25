"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Table, TableCell, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as api from "@/lib/api/cost-sheets";
import type { CostLineKind, CostLineMode, CostProfile } from "@/lib/api/cost-sheets";
import { formatPrice, storeCurrencySymbol } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Product costs (docs/COST_SHEET.md): every size's cost per sale, profit and margin before ads, worst first — and the shop
 * and category defaults the sheets inherit. A plan, not the books. */
export default function ProductCostsPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("costing.view");
  const q = useQuery({ queryKey: api.costSheetKeys.list(), queryFn: api.listProductCosts, enabled: allowed });
  const [search, setSearch] = useState("");
  const [defaultsOpen, setDefaultsOpen] = useState(false);

  if (ready && !allowed) return <EmptyState icon={Calculator} title="Product costs need costing access" description="Ask the owner for costing access." />;

  const rows = (q.data?.products ?? []).flatMap((p) => p.sizes.map((s) => ({ p, s })))
    .filter(({ p, s }) => `${p.name} ${s.label} ${s.sku}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => (a.s.marginPct ?? -1e9) - (b.s.marginPct ?? -1e9));
  const unknown = rows.filter((r) => !r.s.complete).length;
  const below = rows.filter((r) => r.s.belowTarget).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product costs"
        description="What one sale of each size costs — making, packing, delivery, fees, returns, ads — and the profit left. A plan to price by; the books keep what things really cost."
        action={can("costing.adjust") && <Button size="sm" variant="outline" onClick={() => setDefaultsOpen(true)} data-testid="cost-defaults-open">Shop & category defaults</Button>}
      />
      {q.data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="p-4"><p className="text-sm text-fg-muted">Sizes with every cost known</p><p className="text-2xl font-semibold tabular-nums text-fg">{rows.length - unknown} of {rows.length}</p></Card>
          <Card className="p-4"><p className="text-sm text-fg-muted">Below their target</p><p className={cn("text-2xl font-semibold tabular-nums", below ? "text-warning-700" : "text-fg")}>{below}</p></Card>
          <Card className="p-4"><p className="text-sm text-fg-muted">Returns, last 60 days</p><p className="text-2xl font-semibold tabular-nums text-fg">{q.data.returnRateActual === null ? "—" : `${q.data.returnRateActual}%`}</p></Card>
        </div>
      )}
      <SearchInput value={search} onChange={setSearch} placeholder="Search product, size or SKU" wrapperClassName="w-full sm:w-80" />
      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Product</TableHeaderCell>
                <TableHeaderCell align="right">Price</TableHeaderCell>
                <TableHeaderCell align="right">Making</TableHeaderCell>
                <TableHeaderCell align="right">Selling</TableHeaderCell>
                <TableHeaderCell align="right">Profit / sale</TableHeaderCell>
                <TableHeaderCell align="right">Margin</TableHeaderCell>
                <TableHeaderCell>Note</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {q.isLoading && <TableSkeleton rows={6} cols={7} />}
              {q.isError && <TableMessageRow colSpan={7}>Product costs couldn&apos;t be loaded. <Button size="sm" variant="ghost" onClick={() => q.refetch()}>Retry</Button></TableMessageRow>}
              {q.isSuccess && rows.length === 0 && <TableMessageRow colSpan={7}>{search ? "No product matches." : "No products on sale yet."}</TableMessageRow>}
              {rows.map(({ p, s }) => (
                <TableRow key={s.variantId} data-testid="product-cost-row">
                  <TableCell><Link href={`/admin/products/${p.productId}/edit?step=pricing`} className="font-medium text-fg hover:underline">{p.name}</Link> <span className="text-fg-muted">{s.label}</span></TableCell>
                  <TableCell align="right" className="tabular-nums">{formatPrice(s.price)}</TableCell>
                  <TableCell align="right" className={cn("tabular-nums", s.making === null && "text-warning-700")}>{s.making === null ? "unknown" : formatPrice(s.making)}</TableCell>
                  <TableCell align="right" className="tabular-nums">{formatPrice(s.selling)}</TableCell>
                  <TableCell align="right" className={cn("font-semibold tabular-nums", s.profit < 0 ? "text-danger-700" : "text-fg")}>{formatPrice(s.profit)}{!s.complete && " −?"}</TableCell>
                  <TableCell align="right" className="tabular-nums">{s.marginPct === null ? "—" : `${s.marginPct.toFixed(1)}%`}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {s.profit < 0 && <Badge variant="danger">Loss</Badge>}
                      {s.profit >= 0 && s.belowTarget && <Badge variant="warning">Below target</Badge>}
                      {!s.complete && <Badge variant="warning">{s.unknown.map((k) => api.KIND_LABEL[k]).join(", ")} unknown</Badge>}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
      </Card>
      {defaultsOpen && <DefaultsModal onClose={() => setDefaultsOpen(false)} />}
    </div>
  );
}

const EDITABLE: CostLineKind[] = ["PACKAGING", "COURIER", "PAYMENT_FEE", "RETURN_RESERVE", "ADS", "LABOUR", "OTHER"];
type Draft = { insideDhakaPct: string; codPct: string; returnRatePct: string; targetMarginPct: string; lines: Record<string, { mode: CostLineMode; amount: string }> };
const draftOf = (p: CostProfile | null): Draft => ({
  insideDhakaPct: p?.insideDhakaPct?.toString() ?? "", codPct: p?.codPct?.toString() ?? "", returnRatePct: p?.returnRatePct?.toString() ?? "", targetMarginPct: p?.targetMarginPct?.toString() ?? "",
  lines: Object.fromEntries((p?.lines ?? []).map((l) => [l.kind, { mode: l.mode, amount: String(l.amount ?? "") }])),
});
const n = (s: string) => (s.trim() === "" ? null : Number(s));

/** The shop's defaults and each category's: assumptions and any cost set for every product under them. */
function DefaultsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: api.costSheetKeys.defaults(), queryFn: api.getCostDefaults });
  const [target, setTarget] = useState("shop");
  const [draft, setDraft] = useState<Draft | null>(null);
  const profile = target === "shop" ? q.data?.shop ?? null : q.data?.categories.find((c) => c.id === target)?.profile ?? null;
  const d = draft ?? draftOf(profile);
  const save = useMutation({
    mutationFn: () => api.saveCostProfile(target === "shop" ? "BUSINESS" : "CATEGORY", target === "shop" ? "" : target, {
      insideDhakaPct: n(d.insideDhakaPct), codPct: n(d.codPct), returnRatePct: n(d.returnRatePct), targetMarginPct: n(d.targetMarginPct),
      lines: Object.entries(d.lines).filter(([, l]) => l.mode !== "AUTO").map(([kind, l]) => ({ kind: kind as CostLineKind, mode: l.mode, amount: Number(l.amount) })),
    }),
    onSuccess: () => { toast.success("Defaults saved"); setDraft(null); void qc.invalidateQueries({ queryKey: api.costSheetKeys.all }); },
    onError: (e) => toast.error(getErrorMessage(e, "The defaults couldn't be saved")),
  });
  const set = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });
  const fields = [
    { key: "insideDhakaPct" as const, label: "Parcels inside Dhaka", placeholder: q.data?.defaults.insideDhakaPct },
    { key: "codPct" as const, label: "Paid cash on delivery", placeholder: q.data?.defaults.codPct },
    { key: "returnRatePct" as const, label: "Parcels that come back", placeholder: "actual" },
    { key: "targetMarginPct" as const, label: "Target profit", placeholder: q.data?.defaults.targetMarginPct },
  ];
  return (
    <Modal open onClose={onClose} title="Shop & category defaults" description="Every product's sheet starts from these; blank follows the level above (a category follows the shop)." widthClassName="max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose}>Close</Button><Button loading={save.isPending} disabled={!draft} onClick={() => save.mutate()} data-testid="cost-defaults-save">Save</Button></>}>
      {q.isLoading && <TableSkeleton rows={4} cols={2} />}
      {q.isError && <Alert variant="danger">{getErrorMessage(q.error, "The defaults couldn't be loaded")}</Alert>}
      {q.data && (
        <div className="space-y-5">
          <Select aria-label="Defaults for" value={target} onChange={(e) => { setTarget(e.target.value); setDraft(null); }}>
            <option value="shop">The whole shop</option>
            {q.data.categories.map((c) => <option key={c.id} value={c.id}>Category: {c.name}</option>)}
          </Select>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-3 text-sm text-fg">
                {f.label}
                <span className="flex items-center gap-1.5"><Input inputMode="decimal" className="w-20 text-right tabular-nums" value={d[f.key]} placeholder={String(f.placeholder ?? "")} onChange={(e) => set({ [f.key]: e.target.value })} aria-label={f.label} /><span className="text-fg-muted">%</span></span>
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-fg">Costs set for every product here</p>
            {EDITABLE.map((k) => {
              const l = d.lines[k] ?? { mode: "AUTO" as CostLineMode, amount: "" };
              return (
                <div key={k} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle py-2 last:border-b-0">
                  <span className="text-sm text-fg">{api.KIND_LABEL[k]}</span>
                  <span className="flex items-center gap-2">
                    <Select aria-label={`${api.KIND_LABEL[k]}: how`} className="w-auto" value={l.mode} onChange={(e) => set({ lines: { ...d.lines, [k]: { ...l, mode: e.target.value as CostLineMode } } })}>
                      <option value="AUTO">{target === "shop" ? "Auto" : "Follow the shop"}</option>
                      <option value="FIXED">{storeCurrencySymbol()} per sale</option>
                      <option value="PERCENT_OF_PRICE">% of price</option>
                    </Select>
                    {l.mode !== "AUTO" && <Input aria-label={`${api.KIND_LABEL[k]}: amount`} inputMode="decimal" className="w-24 tabular-nums" value={l.amount} onChange={(e) => set({ lines: { ...d.lines, [k]: { ...l, amount: e.target.value } } })} />}
                  </span>
                </div>
              );
            })}
            <p className="text-xs text-fg-muted">Making is worked out per product from its recipe or stock cost — set it on the product if you need to.</p>
          </div>
        </div>
      )}
    </Modal>
  );
}
