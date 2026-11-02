"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Table, TableCell, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { PermissionState } from "@/components/admin/permission-state";
import { useCapabilities } from "@/hooks/use-capability";
import * as stockApi from "@/lib/api/stock";
import type { UsageFlag } from "@/lib/api/stock";

const FLAG: Record<UsageFlag, { label: string; hint: string }> = {
  OVER_RECIPE: { label: "More than the recipes", hint: "Fills used more than their recipes say — a recipe quantity too low, or breakage while filling." },
  COUNT_LOSS: { label: "Count loss", hint: "A count found less than the books — unrecorded use, breakage or a wrong conversion." },
  COUNT_GAIN: { label: "Count gain", hint: "A count found more — goods received without a purchase, or a counting mistake." },
  WASTE: { label: "Wasted", hint: "Recorded as broken or spoiled." },
};
const num = (n: number) => n.toLocaleString("en-US");
const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Stock › Material usage (docs/MATERIALS_PURCHASING.md §6): per material, where the month's stock went — opening, bought,
 * used in fills (against what the recipes say), packaging, wasted, count differences, closing — with flags for what to look
 * into. Read-only.
 */
export default function MaterialUsagePage() {
  const { can, ready } = useCapabilities();
  const allowed = can("inventory.view");
  const [month, setMonth] = useState(thisMonth());
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const q = useQuery({ queryKey: [...stockApi.stockKeys.all, "usage", month], queryFn: () => stockApi.getMaterialUsage(month), enabled: allowed && valid });
  if (ready && !allowed) return <div><ModuleTabs /><PermissionState icon={Gauge} page="Material usage" /></div>;
  const rows = q.data?.rows ?? [];
  const flagged = rows.filter((r) => r.flags.length).length;
  const cols = 10;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Material usage"
        description="Where each material went this month — bought, used in fills, packed, wasted, counted — and what to look into."
        action={
          <Field htmlFor="usage-month" label={<span className="sr-only">Month</span>}>
            <Input id="usage-month" type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} className="w-44" data-testid="usage-month" />
          </Field>
        }
      />
      {q.isSuccess && rows.length > 0 && (
        <p className="text-sm text-fg-muted" data-testid="usage-summary">{flagged ? `${flagged} of ${rows.length} materials to look into.` : `All ${rows.length} materials add up with nothing to look into.`}</p>
      )}
      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Material</TableHeaderCell>
                <TableHeaderCell align="right">Opening</TableHeaderCell>
                <TableHeaderCell align="right">Bought</TableHeaderCell>
                <TableHeaderCell align="right">Used in fills</TableHeaderCell>
                <TableHeaderCell align="right">Recipes say</TableHeaderCell>
                <TableHeaderCell align="right">Packed</TableHeaderCell>
                <TableHeaderCell align="right">Wasted</TableHeaderCell>
                <TableHeaderCell align="right">Count +/−</TableHeaderCell>
                <TableHeaderCell align="right">Closing</TableHeaderCell>
                <TableHeaderCell>Look into</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {q.isLoading && <TableSkeleton rows={5} cols={cols} />}
              {q.isError && <TableMessageRow colSpan={cols}>Usage couldn&apos;t be loaded. <Button size="sm" variant="ghost" onClick={() => q.refetch()}>Retry</Button></TableMessageRow>}
              {!valid && <TableMessageRow colSpan={cols}>Choose a month.</TableMessageRow>}
              {rows.map((r) => (
                <TableRow key={r.variantId} data-testid="usage-row">
                  <TableCell><span className="font-medium text-fg">{r.name}</span><span className="block text-xs text-fg-muted">{r.unit}</span></TableCell>
                  <TableCell align="right" className="tabular-nums">{num(r.opening)}</TableCell>
                  <TableCell align="right" className="tabular-nums">{r.received ? num(r.received) : "—"}{r.returned ? <span className="block text-xs text-fg-muted">−{num(r.returned)} sent back</span> : null}</TableCell>
                  <TableCell align="right" className="tabular-nums">{r.usedInFills ? num(r.usedInFills) : "—"}</TableCell>
                  <TableCell align="right" className="tabular-nums text-fg-muted">{r.recipeSays ? num(r.recipeSays) : "—"}</TableCell>
                  <TableCell align="right" className="tabular-nums">{r.packaging ? num(r.packaging) : "—"}</TableCell>
                  <TableCell align="right" className="tabular-nums">{r.wasted ? num(r.wasted) : "—"}</TableCell>
                  <TableCell align="right" className="tabular-nums">{r.counted ? `${r.counted > 0 ? "+" : "−"}${num(Math.abs(r.counted))}` : "—"}</TableCell>
                  <TableCell align="right" className="font-semibold tabular-nums">{num(r.closing)}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {r.flags.map((f) => <Badge key={f} variant={f === "WASTE" ? "neutral" : "warning"} title={FLAG[f].hint}>{FLAG[f].label}</Badge>)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
        {q.isSuccess && rows.length === 0 && <EmptyState icon={Gauge} title="No materials yet" description="Add materials under Production › Materials; their use shows here month by month." />}
      </Card>
      <p className="text-xs text-fg-muted">Opening + bought − sent back − used − packed − wasted ± counts (and returns from orders) = closing. &ldquo;Recipes say&rdquo; is what the month&apos;s fills planned from their recipes.</p>
    </div>
  );
}
