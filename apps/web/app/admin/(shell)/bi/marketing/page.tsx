"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Gift, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { RankedBarList, type RankedBarListItem } from "@/components/admin/ranked-bar-list";
import * as analyticsApi from "@/lib/api/admin-analytics";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type RangeOption = 7 | 30 | 90 | "all";
const RANGE_OPTIONS: RangeOption[] = [7, 30, 90, "all"];

function toBarItems<T>(rows: T[] | undefined, opts: { key: (r: T) => string; label: (r: T) => string; value: (r: T) => number; valueLabel: (r: T) => string }): RankedBarListItem[] {
  return (rows ?? []).map((r) => ({ key: opts.key(r), label: opts.label(r), value: opts.value(r), valueLabel: opts.valueLabel(r) }));
}

export default function MarketingIntelligencePage() {
  const [range, setRange] = useState<RangeOption>(30);
  const apiDays = range === "all" ? undefined : range;
  const legacyDays = range === "all" ? 365 : range;

  const { data: sources } = useQuery({ queryKey: ["bi-marketing-sources", legacyDays], queryFn: () => analyticsApi.getTrafficSources(legacyDays, 8) });
  const { data: campaigns } = useQuery({ queryKey: ["bi-marketing-campaigns", legacyDays], queryFn: () => analyticsApi.getCampaignPerformance(legacyDays, 8) });

  const { data: coupons } = useQuery({ queryKey: ["bi-marketing-coupons", apiDays], queryFn: () => analyticsApi.getCouponEffectiveness(apiDays, 10) });
  const { data: bundles } = useQuery({ queryKey: ["bi-marketing-bundles", apiDays], queryFn: () => analyticsApi.getBundlePerformance(apiDays, 10) });
  const { data: flashSales } = useQuery({ queryKey: ["bi-marketing-flash-sales"], queryFn: () => analyticsApi.getFlashSalePerformance(10) });
  const { data: delivery } = useQuery({ queryKey: ["bi-marketing-delivery"], queryFn: () => analyticsApi.getCampaignDeliveryStats(10) });
  const { data: loyalty } = useQuery({ queryKey: ["bi-marketing-loyalty"], queryFn: analyticsApi.getLoyaltyPointsOverview });

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Marketing Intelligence</h1>
          <p className="mt-1 text-sm text-ink-500">Where traffic comes from, and what coupons, bundles, sales, and campaigns actually earn.</p>
        </div>
        <div className="inline-flex shrink-0 items-center gap-0.5 self-start rounded-full border border-ink-100 bg-ink-50/60 p-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setRange(opt)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ease-smooth",
                range === opt ? "bg-ink-900 text-cream-50 shadow-sm" : "text-ink-500 hover:text-ink-900",
              )}
            >
              {opt === "all" ? "All" : `${opt}D`}
            </button>
          ))}
        </div>
      </div>

      {/* Attribution */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Traffic sources (first-touch UTM)</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(sources?.sources, { key: (s) => s.source, label: (s) => s.source, value: (s) => s.sessions, valueLabel: (s) => `${s.sessions} sessions` })}
              emptyLabel="No tagged traffic yet for this range."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Campaign performance (UTM revenue)</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(campaigns?.campaigns, { key: (c) => c.campaign, label: (c) => c.campaign, value: (c) => c.revenue, valueLabel: (c) => formatPrice(c.revenue) })}
              emptyLabel="No campaign-attributed revenue yet for this range."
            />
          </CardContent>
        </Card>
      </section>

      {/* Promotions */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Coupon effectiveness</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!coupons || coupons.coupons.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No coupon redemptions yet for this range.</p>
            ) : (
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">Code</th>
                    <th className="pb-2 pr-4">Orders</th>
                    <th className="pb-2 pr-4">Discount given</th>
                    <th className="pb-2">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {coupons.coupons.map((c) => (
                    <tr key={c.code} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs font-medium text-ink-800">{c.code}</td>
                      <td className="py-2 pr-4 text-ink-600">{c.orders}</td>
                      <td className="py-2 pr-4 text-ink-600">{formatPrice(c.discountGiven)}</td>
                      <td className="py-2 text-ink-800">{formatPrice(c.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Bundle performance</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!bundles || bundles.bundles.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No bundle redemptions yet for this range.</p>
            ) : (
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">Bundle</th>
                    <th className="pb-2 pr-4">Orders</th>
                    <th className="pb-2 pr-4">Discount given</th>
                    <th className="pb-2">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {bundles.bundles.map((b) => (
                    <tr key={b.name} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4 font-medium text-ink-800">{b.name}</td>
                      <td className="py-2 pr-4 text-ink-600">{b.orders}</td>
                      <td className="py-2 pr-4 text-ink-600">{formatPrice(b.discountGiven)}</td>
                      <td className="py-2 text-ink-800">{formatPrice(b.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>Flash sale performance</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!flashSales || flashSales.sales.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No flash sales scheduled yet.</p>
            ) : (
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">Sale</th>
                    <th className="pb-2 pr-4">Window</th>
                    <th className="pb-2 pr-4">Units sold</th>
                    <th className="pb-2">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {flashSales.sales.map((s) => (
                    <tr key={s.id} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4 font-medium text-ink-800">{s.name}</td>
                      <td className="py-2 pr-4 text-xs text-ink-500">
                        {new Date(s.startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} –{" "}
                        {new Date(s.endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </td>
                      <td className="py-2 pr-4 text-ink-600">{s.unitsSold}</td>
                      <td className="py-2 text-ink-800">{formatPrice(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Sends & loyalty */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Email / SMS / push delivery</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!delivery || delivery.campaigns.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No campaigns sent yet.</p>
            ) : (
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">Campaign</th>
                    <th className="pb-2 pr-4">Channel</th>
                    <th className="pb-2 pr-4">Sent</th>
                    <th className="pb-2 pr-4">Failed</th>
                    <th className="pb-2">Delivery rate</th>
                  </tr>
                </thead>
                <tbody>
                  {delivery.campaigns.map((c) => (
                    <tr key={c.id} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4 font-medium text-ink-800">{c.name}</td>
                      <td className="py-2 pr-4 text-ink-600">{c.channel}</td>
                      <td className="py-2 pr-4 text-ink-600">{c.sent}</td>
                      <td className={cn("py-2 pr-4", c.failed > 0 ? "font-medium text-danger-600" : "text-ink-600")}>{c.failed}</td>
                      <td className="py-2 text-ink-800">{c.total > 0 ? `${((c.sent / c.total) * 100).toFixed(0)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Reward points (lifetime)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {!loyalty ? (
                Array.from({ length: 4 }).map((_, i) => <StatTileSkeleton key={i} />)
              ) : (
                <>
                  <StatTile label="Points issued" value={loyalty.issued.toLocaleString("en-BD")} icon={<Gift size={18} />} />
                  <StatTile label="Points redeemed" value={loyalty.redeemed.toLocaleString("en-BD")} icon={<Gift size={18} />} />
                  <StatTile label="Outstanding balance" value={loyalty.outstanding.toLocaleString("en-BD")} icon={<Wallet size={18} />} tone="accent" />
                  <StatTile label="Customers with a balance" value={loyalty.customersWithBalance.toLocaleString("en-BD")} icon={<Wallet size={18} />} />
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          No referral program exists in this store today — nothing to report there. Flash sale figures count sales of a sale&apos;s products
          placed during that sale&apos;s own active window, not all-time sales of those products.
        </p>
      </Card>
    </div>
  );
}
