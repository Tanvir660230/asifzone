"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined, Droplets, Factory, ListTree, PackagePlus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import { getProductionHome, stockKeys } from "@/lib/api/stock";
import { formatBookDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const num = (n: number) => n.toLocaleString("en-US");

/** Production home (docs/STOCK_HUB.md §9): the four things the owner does — bought, filled, recipes, price & profit —
 * then what needs them, what the materials in stock can still make, and the latest fills. */
export default function ProductionHomePage() {
  const { can, ready } = useCapabilities();
  const allowed = can("manufacturing.view") && can("inventory.view");
  const q = useQuery({ queryKey: [...stockKeys.all, "production-home"], queryFn: getProductionHome, enabled: allowed });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Factory} title="Production isn't available to your role" description="Ask the owner for access to inventory and production." />
      </div>
    );
  }

  const actions = [
    { href: "/admin/stock?bought=new", label: "Bought", detail: "Oil, bottles, boxes — in litres, dozens or pieces", icon: PackagePlus, tint: "bg-info-100 text-info-700", show: can("purchasing.receive") },
    { href: "/admin/stock?fill=1", label: "Filled", detail: "Bottles filled — oil and bottles leave stock at cost", icon: Droplets, tint: "bg-success-100 text-success-700", show: can("manufacturing.view") },
    { href: "/admin/manufacturing/boms", label: "Recipes", detail: "What goes into one bottle or piece", icon: ListTree, tint: "bg-warning-100 text-warning-700", show: true },
    { href: "/admin/finance/profit", label: "Price & profit", detail: "What each sale costs and earns", icon: ChartNoAxesCombined, tint: "bg-ink-100 text-ink-700", show: can("finance.view") },
  ].filter((a) => a.show);
  const d = q.data;
  const needs = d ? [
    ...(d.owed.length ? [{ key: "owed", tone: "danger", title: `${num(d.owed.reduce((s, o) => s + o.owed, 0))} ordered, not filled yet`, detail: d.owed.map((o) => `${o.name} ${num(o.owed)}`).join(" · "), href: "/admin/stock?fill=1", action: "Fill" }] : []),
    ...d.noRecipe.map((p) => ({ key: `r-${p.productId}`, tone: "danger", title: `${p.name} has no recipe`, detail: "It can't be filled until a recipe is approved", href: "/admin/manufacturing/boms", action: "Add recipe" })),
    ...d.lowMaterials.map((m) => ({ key: `m-${m.variantId}`, tone: "warning", title: `${m.name} is low`, detail: `${num(m.stock)} ${m.unit} left${m.daysLeft !== null ? ` · about ${num(m.daysLeft)} days` : ""}`, href: `/admin/stock?bought=${m.variantId}`, action: "Bought" })),
  ] : [];

  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Production" description="Materials, recipes and filling in one place." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {actions.map((a) => (
          <Link key={a.label} href={a.href} className="group flex min-h-28 flex-col gap-2 rounded-2xl border border-line-subtle bg-surface p-4 shadow-sm transition-colors duration-fast hover:border-line" data-testid={`production-action-${a.label.toLowerCase().replace(/\W+/g, "-")}`}>
            <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", a.tint)}><a.icon className="h-5 w-5" aria-hidden="true" /></span>
            <span className="text-[15px] font-semibold text-fg">{a.label}</span>
            <span className="text-sm text-fg-muted max-sm:hidden">{a.detail}</span>
          </Link>
        ))}
      </div>

      {q.isLoading && <Skeleton className="h-64 w-full" />}
      {q.isError && <Alert variant="danger" title="Production couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>}

      {d && (
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <Card className="overflow-hidden p-0" data-testid="production-needs">
            <h2 className="px-4 pb-2 pt-4 text-[17px] font-semibold text-fg">Needs you</h2>
            {needs.length === 0 ? (
              <p className="border-t border-line-subtle px-4 py-6 text-sm text-fg-muted">Nothing waiting — no bottles owed, every filled-to-order product has a recipe and no material is low.</p>
            ) : (
              <ul>
                {needs.map((n) => (
                  <li key={n.key} className="flex items-center gap-3 border-t border-line-subtle px-4 py-3">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", n.tone === "danger" ? "bg-danger-500" : "bg-warning-500")} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium text-fg">{n.title}</span>
                      <span className="block text-sm text-fg-muted">{n.detail}</span>
                    </span>
                    <Link href={n.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>{n.action}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="overflow-hidden p-0" data-testid="production-can-make">
            <div className="px-4 pb-2 pt-4">
              <h2 className="text-[17px] font-semibold text-fg">Can still make</h2>
              <p className="text-sm text-fg-muted">From the materials in stock now — each size on its own</p>
            </div>
            {d.canMake.length === 0 ? (
              <p className="border-t border-line-subtle px-4 py-6 text-sm text-fg-muted">No approved recipe yet. <Link href="/admin/manufacturing/boms" className="font-medium text-accent hover:underline">Add one in Recipes</Link>.</p>
            ) : (
              <HScrollShadow>
                <Table>
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Product</TableHeaderCell>
                      <TableHeaderCell align="right">Can make</TableHeaderCell>
                      <TableHeaderCell>Runs out first</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <tbody>
                    {d.canMake.map((r) => (
                      <TableRow key={r.variantId} data-testid="can-make-row">
                        <TableCell><span className="font-medium text-fg">{r.productName}</span> <span className="text-fg-muted">{r.label}</span></TableCell>
                        <TableCell align="right" className={cn("tabular-nums font-semibold", r.canMake <= 10 ? "text-warning-700" : "text-fg")}>{num(r.canMake)}</TableCell>
                        <TableCell className="text-sm text-fg-muted">{r.limiting ? `${r.limiting.name} · ${num(Math.max(0, r.limiting.stock))} ${r.limiting.unit}` : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </HScrollShadow>
            )}
          </Card>

          <Card className="overflow-hidden p-0 lg:col-span-2" data-testid="production-recent-fills">
            <h2 className="px-4 pb-2 pt-4 text-[17px] font-semibold text-fg">Recent fills</h2>
            {d.recentFills.length === 0 ? (
              <p className="border-t border-line-subtle px-4 py-6 text-sm text-fg-muted">No bottles recorded as filled yet. <Link href="/admin/stock?fill=1" className="font-medium text-accent hover:underline">Record a fill</Link>.</p>
            ) : (
              <ul>
                {d.recentFills.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-subtle px-4 py-3 text-sm">
                    <span className="w-24 tabular-nums text-fg-muted">{f.number ?? "—"}</span>
                    <span className="min-w-0 flex-1 font-medium text-fg">{f.name}{f.quantity !== null && <span className="font-normal text-fg-muted"> × {num(f.quantity)}</span>}</span>
                    <span className="text-fg-muted">{formatBookDate(f.date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {!d.costingActive && <Alert variant="info" className="lg:col-span-2">Stock costing hasn&apos;t gone live, so Bought and Filled open once it does.</Alert>}
        </div>
      )}
    </div>
  );
}
