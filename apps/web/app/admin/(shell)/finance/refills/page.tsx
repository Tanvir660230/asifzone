"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Droplets } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { SetupChecklist } from "@/components/admin/finance/setup-checklist";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as booksApi from "@/lib/api/finance-books";
import * as mfgApi from "@/lib/api/manufacturing";
import { formatBookDate, formatPrice } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";

/** Owner's books §7.2: refill attar into bottles in one step — the recipe's oil and bottles leave stock, the bottles arrive
 * with their exact cost. Runs the production engine start to finish (Inventory › Manufacturing shows each refill). */
export default function QuickRefillPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("manufacturing.view");
  const boms = useQuery({ queryKey: [...mfgApi.manufacturingKeys.all, "boms", "APPROVED"], queryFn: () => mfgApi.listBoms({ status: "APPROVED" }), enabled: allowed });
  const refills = useQuery({ queryKey: booksApi.booksKeys.refills(), queryFn: booksApi.listQuickRefills, enabled: allowed });
  // The latest approved recipe of each product.
  const recipes = useMemo(() => {
    const by = new Map<string, mfgApi.Bom>();
    for (const b of boms.data?.boms ?? []) if (!by.has(b.product.id) || by.get(b.product.id)!.version < b.version) by.set(b.product.id, b);
    return [...by.values()].sort((a, b) => a.product.name.localeCompare(b.product.name));
  }, [boms.data]);
  const [bomId, setBomId] = useState("");
  const recipe = recipes.find((r) => r.id === bomId) ?? null;
  const products = useQuery({ queryKey: [...mfgApi.manufacturingKeys.all, "products", recipe?.product.name ?? ""], queryFn: () => mfgApi.searchProducts(recipe!.product.name), enabled: Boolean(recipe) });
  const variants = products.data?.products.find((p) => p.id === recipe?.product.id)?.variants ?? [];
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState("");
  const [used, setUsed] = useState<Record<string, string>>({});
  const n = Number(qty);
  const lines = (recipe?.lines ?? []).filter((l) => l.suppliedBy === "BUSINESS" && (!l.finishedVariant || l.finishedVariant.id === variantId));
  const planned = (l: mfgApi.BomLine) => (n > 0 ? Math.ceil(n * Number(l.qtyPerUnit) * (1 + Number(l.wastagePct) / 100)) : 0);
  const body = {
    variantId, quantity: n,
    used: lines.filter((l) => used[l.material.variantId] !== undefined && used[l.material.variantId] !== "").map((l) => ({ materialVariantId: l.material.variantId, quantity: Number(used[l.material.variantId]) })),
  };
  const run = useMutation({
    mutationFn: () => booksApi.quickRefill(body, idempotencyKeyFor("refill", body)),
    onSuccess: (r) => {
      settleIdempotencyKey("refill");
      toast.success(`${r.order.number}: ${n} bottle${n === 1 ? "" : "s"} in stock${r.order.finalCost?.perAcceptedUnit != null ? ` at ${formatPrice(r.order.finalCost.perAcceptedUnit)} each` : ""}`);
      setQty("");
      setUsed({});
      void queryClient.invalidateQueries({ queryKey: booksApi.booksKeys.refills() });
      void queryClient.invalidateQueries({ queryKey: mfgApi.manufacturingKeys.all });
    },
    onError: (e) => toast.error(getErrorMessage(e, "The refill couldn't be recorded")),
  });

  if (ready && !allowed) return <div><ModuleTabs /><EmptyState icon={Droplets} title="Refills aren't available to your role" /></div>;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Quick refill" description="Refill attar into bottles in one step: the oil and bottles leave stock and the bottles arrive with their exact cost." />
      {boms.isLoading && <Skeleton className="h-40 w-full" />}
      {boms.isError && <Alert variant="danger" title="Recipes couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => boms.refetch()}>Retry</Button>}>{getErrorMessage(boms.error, "")}</Alert>}
      {boms.data && recipes.length === 0 && (
        <SetupChecklist
          title="Before the first refill"
          description="A refill takes the oil and bottles out of stock by its recipe, so each attar needs one."
          testId="refill-setup"
          steps={[
            { done: false, title: "Approve a recipe for each attar", detail: "Once per attar — e.g. 6 ml bottle: 6 ml oil + 1 bottle + 1 label.", href: "/admin/manufacturing/boms", cta: "Bills of materials" },
            { done: false, title: "Refill here", detail: "Pick the attar, the bottle size and how many you filled — stock and cost update in one step." },
          ]}
        />
      )}
      {recipes.length > 0 && (
        <Card className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field htmlFor="rf-product" label="Attar" required>
              <Select id="rf-product" value={bomId} onChange={(e) => { setBomId(e.target.value); setVariantId(""); setUsed({}); }} data-testid="refill-product">
                <option value="">Choose…</option>
                {recipes.map((r) => <option key={r.id} value={r.id}>{r.product.name}</option>)}
              </Select>
            </Field>
            <Field htmlFor="rf-variant" label="Bottle size" required>
              <Select id="rf-variant" value={variantId} disabled={!recipe} onChange={(e) => setVariantId(e.target.value)} data-testid="refill-variant">
                <option value="">Choose…</option>
                {variants.map((v) => <option key={v.id} value={v.id}>{[v.size, v.color].filter((x) => x && x !== "Default").join(" · ") || v.sku} ({v.stock} in stock)</option>)}
              </Select>
            </Field>
            <Field htmlFor="rf-qty" label="Bottles filled" required><Input id="rf-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="refill-qty" /></Field>
          </div>
          {recipe && variantId && n > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-fg">Taken from stock</p>
              <ul className="divide-y divide-line-subtle rounded-lg border border-line-subtle">
                {lines.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 text-fg">{l.material.name} <span className="text-xs text-fg-muted">({l.qtyPerUnit} {l.material.stockUnit} each{Number(l.wastagePct) ? ` + ${l.wastagePct}% loss` : ""})</span></span>
                    <span className="flex items-center gap-2">
                      <Input aria-label={`${l.material.name} used`} className="h-8 w-24 text-right tabular-nums" inputMode="numeric" value={used[l.material.variantId] ?? String(planned(l))} onChange={(e) => setUsed((u) => ({ ...u, [l.material.variantId]: e.target.value }))} />
                      <span className="w-10 text-xs text-fg-muted">{l.material.stockUnit}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-fg-muted">Change a figure if you really used more or less — the cost follows what was used.</p>
            </div>
          )}
          {can("manufacturing.approve") ? (
            <Button disabled={!variantId || !(Number.isInteger(n) && n > 0)} loading={run.isPending} onClick={() => run.mutate()} data-testid="run-refill">Record refill</Button>
          ) : (
            <p className="text-sm text-fg-muted">Recording a refill is for the owner.</p>
          )}
        </Card>
      )}
      <section className={cn("space-y-2", boms.data && recipes.length === 0 && refills.data?.refills.length === 0 && "hidden")}>
        <h2 className="text-lg font-semibold text-fg">Recent refills</h2>
        {refills.isLoading && <Skeleton className="h-24 w-full" />}
        {refills.data && (refills.data.refills.length === 0 ? (
          <p className="text-sm text-fg-muted">None yet.</p>
        ) : (
          <Card className="divide-y divide-line p-0 text-sm">
            {refills.data.refills.map((r) => (
              <Link key={r.id} href={`/admin/manufacturing/production-orders/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-ink-900/[0.03]" data-testid="refill-row">
                <span className="min-w-0">
                  <span className="block text-fg">{r.product}{r.variant?.size && r.variant.size !== "Default" ? ` · ${r.variant.size}` : ""} × {r.quantity}</span>
                  <span className="block text-xs text-fg-muted">{r.number} · {formatBookDate(r.date)} · {r.materials.map((m) => `${m.used} ${m.unit} ${m.name}`).join(", ")}</span>
                </span>
                <span className="flex items-center gap-2">
                  {r.status !== "CLOSED" && <Badge variant="warning">{r.status.toLowerCase().replace(/_/g, " ")}</Badge>}
                  <span className="tabular-nums text-fg">{r.unitCost === null ? "—" : `${formatPrice(r.unitCost)} each`}</span>
                </span>
              </Link>
            ))}
          </Card>
        ))}
      </section>
    </div>
  );
}
