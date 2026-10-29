"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/empty-state";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useBiDateRange } from "@/components/admin/bi-date-range-context";
import * as analyticsApi from "@/lib/api/admin-analytics";
import type { AdReturnRow } from "@/lib/api/admin-analytics";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const taka = (v: number) => formatPrice(Math.round(v));
const n = (v: number) => Math.round(v).toLocaleString("en-US");
const roas = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}×`);

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "good" | "bad" }) {
  return (
    <Card className="p-3.5 sm:p-4">
      <p className="text-[13px] font-medium text-fg-muted">{label}</p>
      <p className={cn("pt-1 text-[22px] font-semibold leading-tight tracking-tight tabular-nums sm:text-[26px]", tone === "good" ? "text-success-700" : tone === "bad" ? "text-danger-600" : "text-fg")}>{value}</p>
      {note && <p className="mt-1 text-[12.5px] leading-snug text-fg-muted">{note}</p>}
    </Card>
  );
}

function CampaignRow({ c }: { c: AdReturnRow }) {
  const profit = c.profitAfterAds;
  return (
    <TableRow>
      <TableCell className="min-w-[10rem] font-medium text-fg">
        <span className="block max-w-[18rem] truncate" title={c.name}>
          {c.name}
        </span>
        {c.plannedShare !== null && c.plannedShare > 0.01 && <span className="block text-[12px] font-normal text-fg-muted">{Math.round(c.plannedShare * 100)}% of spend is the planned budget</span>}
      </TableCell>
      <TableCell align="right">{n(c.sessions)}</TableCell>
      <TableCell align="right">{n(c.orders)}</TableCell>
      <TableCell align="right">{n(c.realisedOrders)}</TableCell>
      <TableCell align="right">{taka(c.netSales)}</TableCell>
      <TableCell align="right" className={cn("whitespace-nowrap", c.spend === null && "text-fg-muted")}>
        {c.spend === null ? "not recorded" : taka(c.spend)}
      </TableCell>
      <TableCell align="right" className={cn(c.roas !== null && c.roas < 1 && "font-semibold text-danger-600")}>
        {roas(c.roas)}
      </TableCell>
      <TableCell align="right" className={cn("font-semibold", profit === null ? "font-normal text-fg-muted" : profit >= 0 ? "text-success-700" : "text-danger-600")}>
        {profit === null ? "—" : `${profit < 0 ? "−" : ""}${taka(Math.abs(profit))}`}
      </TableCell>
      <TableCell align="right">{c.costPerRealisedOrder === null ? "—" : taka(c.costPerRealisedOrder)}</TableCell>
    </TableRow>
  );
}

/** Each ad campaign judged on what was actually delivered and paid, not on orders placed. */
export default function AdReturnsView() {
  const { range } = useBiDateRange();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["ad-returns", range.from.toISOString(), range.to.toISOString()],
    queryFn: () => analyticsApi.getAdReturns(range.from, range.to),
  });

  if (isError) return <ErrorState description="Ad figures didn't load." onRetry={() => void refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-ink-900/[0.04]" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-xl bg-ink-900/[0.04]" />
      </div>
    );
  }

  const t = data.totals;
  const withSpend = t.spend > 0;
  return (
    <div className="space-y-6">
      {!withSpend && (
        <div className="flex items-start gap-3 rounded-xl border border-info-100 bg-info-50/60 p-3.5 text-[13px] text-info-700">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            No ad spend recorded for these campaigns yet, so this shows what each one brought but not whether it paid off. Add the campaigns (with their Meta campaign id) in{" "}
            <Link href="/admin/finance/ads" className="font-medium underline underline-offset-2">
              Finance › Ads
            </Link>{" "}
            or connect Meta there, and spend, real ROAS and profit appear here.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Tile label="Ad spend" value={withSpend ? taka(t.spend) : "—"} note={withSpend ? "Recorded in Finance (actual, else the budget)" : "Not recorded yet"} />
        <Tile label="Net sales from ads" value={taka(t.netSales)} note={`${n(t.realisedOrders)} delivered or paid of ${n(t.orders)} orders`} />
        <Tile label="Real ROAS" value={roas(t.roas)} note="Delivered net sales ÷ spend" tone={t.roas === null ? undefined : t.roas >= 1 ? "good" : "bad"} />
        <Tile
          label="Margin after ads (estimate)"
          value={t.profitAfterAds === null ? "—" : `${t.profitAfterAds < 0 ? "−" : ""}${taka(Math.abs(t.profitAfterAds))}`}
          note="Sales-estimate margin − spend, campaigns with spend"
          tone={t.profitAfterAds === null ? undefined : t.profitAfterAds >= 0 ? "good" : "bad"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          {data.campaigns.length === 0 ? (
            <p className="py-8 text-center text-sm text-fg-muted">No visits carried a campaign tag (utm_campaign) in this period.</p>
          ) : (
            <TableContainer>
              <Table>
                <caption className="sr-only">Ad campaigns: visits, orders, delivered, net sales, spend, ROAS, profit after ads, cost per delivered order</caption>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Campaign</TableHeaderCell>
                    <TableHeaderCell align="right">Visits</TableHeaderCell>
                    <TableHeaderCell align="right">Orders</TableHeaderCell>
                    <TableHeaderCell align="right">Delivered</TableHeaderCell>
                    <TableHeaderCell align="right">Net sales</TableHeaderCell>
                    <TableHeaderCell align="right">Spend</TableHeaderCell>
                    <TableHeaderCell align="right">ROAS</TableHeaderCell>
                    <TableHeaderCell align="right" className="whitespace-nowrap">
                      Profit after ads
                    </TableHeaderCell>
                    <TableHeaderCell align="right" className="whitespace-nowrap">
                      Per delivered
                    </TableHeaderCell>
                  </tr>
                </TableHead>
                <tbody>
                  {data.campaigns.map((c) => (
                    <CampaignRow key={c.key} c={c} />
                  ))}
                </tbody>
              </Table>
            </TableContainer>
          )}
          {data.unmatchedSpend.length > 0 && (
            <p className="mt-3 text-[12.5px] leading-relaxed text-warning-700">
              Spend with no visits carrying the campaign&apos;s id or name: {data.unmatchedSpend.map((u) => `${u.name} (${taka(u.spend)})`).join(", ")}. Check the
              campaign id in Finance › Ads matches the ad&apos;s utm_campaign.
            </p>
          )}
          <p className="mt-3 text-[12px] leading-relaxed text-fg-muted">
            An order belongs to the campaign its visit came from (the visit&apos;s utm_campaign). Net sales and margin count only delivered COD and
            paid online orders, less refunds — so refused parcels don&apos;t flatter an ad. Margin needs product costs; uncosted items are left out.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
