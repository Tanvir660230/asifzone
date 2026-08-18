"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Heart, Star, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { RankedBarList, type RankedBarListItem } from "@/components/admin/ranked-bar-list";
import * as analyticsApi from "@/lib/api/admin-analytics";
import { cn } from "@/lib/utils";

type RangeOption = 7 | 30 | 90 | "all";
const RANGE_OPTIONS: RangeOption[] = [7, 30, 90, "all"];

function toBarItems<T>(rows: T[] | undefined, opts: { key: (r: T) => string; label: (r: T) => string; value: (r: T) => number; valueLabel: (r: T) => string }): RankedBarListItem[] {
  return (rows ?? []).map((r) => ({ key: opts.key(r), label: opts.label(r), value: opts.value(r), valueLabel: opts.valueLabel(r) }));
}

export default function UserBehaviorPage() {
  const [range, setRange] = useState<RangeOption>(30);
  const apiDays = range === "all" ? undefined : range;

  const { data: mostWishlisted } = useQuery({ queryKey: ["bi-behavior-wishlisted"], queryFn: () => analyticsApi.getMostWishlisted(8) });
  const { data: wishlistConv } = useQuery({ queryKey: ["bi-behavior-wishlist-conv", apiDays], queryFn: () => analyticsApi.getWishlistConversion(apiDays) });

  const { data: reviews } = useQuery({ queryKey: ["bi-behavior-reviews", apiDays], queryFn: () => analyticsApi.getReviewBehaviorStats(apiDays) });
  const { data: feedback } = useQuery({ queryKey: ["bi-behavior-feedback", apiDays], queryFn: () => analyticsApi.getFeedbackVolume(apiDays) });

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">User Behavior</h1>
          <p className="mt-1 text-sm text-ink-500">Wishlisting, reviewing, and reaching out — the signals customers leave beyond a purchase.</p>
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

      {/* Wishlist */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Most wishlisted (lifetime)</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(mostWishlisted?.products, { key: (p) => p.id, label: (p) => p.name, value: (p) => p.count, valueLabel: (p) => p.count.toLocaleString("en-BD") })}
              emptyLabel="No wishlist activity yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Wishlist → purchase conversion</CardTitle>
          </CardHeader>
          <CardContent>
            {!wishlistConv ? (
              <StatTileSkeleton />
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="Wishlisted" value={wishlistConv.totalWishlisted.toLocaleString("en-BD")} icon={<Heart size={18} />} />
                <StatTile label="Later bought" value={wishlistConv.converted.toLocaleString("en-BD")} icon={<Heart size={18} />} />
                <StatTile label="Conversion" value={`${wishlistConv.conversionRatePct.toFixed(1)}%`} icon={<Heart size={18} />} tone="accent" />
              </div>
            )}
            <p className="mt-3 text-xs text-ink-400">Matched by product (not exact variant) — the customer may buy a different size or color than the one they wishlisted.</p>
          </CardContent>
        </Card>
      </section>

      {/* Reviews */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <Star size={16} className="mr-1.5 inline" /> Rating distribution {reviews ? `(avg ${reviews.avgRating.toFixed(1)})` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(reviews?.byRating, { key: (r) => String(r.rating), label: (r) => `${r.rating} star${r.rating === 1 ? "" : "s"}`, value: (r) => r.count, valueLabel: (r) => String(r.count) })}
              emptyLabel="No reviews submitted yet for this range."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Moderation status</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!reviews || reviews.byStatus.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No reviews submitted yet for this range.</p>
            ) : (
              <table className="w-full min-w-[320px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Count</th>
                    <th className="pb-2">Verified purchase</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.byStatus.map((s) => (
                    <tr key={s.status} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4 text-ink-800">{s.status}</td>
                      <td className="py-2 pr-4 text-ink-600">{s.count}</td>
                      <td className="py-2 text-ink-600">{s.verified}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Feedback */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Contact-form feedback</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {!feedback ? (
            Array.from({ length: 3 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Submissions" value={feedback.total.toLocaleString("en-BD")} icon={<MessageSquare size={18} />} />
              <StatTile label="Read" value={feedback.read.toLocaleString("en-BD")} icon={<MessageSquare size={18} />} />
              <StatTile label="Unread" value={feedback.unread.toLocaleString("en-BD")} icon={<MessageSquare size={18} />} tone={feedback.unread > 0 ? "warning" : "default"} />
            </>
          )}
        </div>
      </section>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          Session recordings and heatmaps aren&apos;t shown — no pointer/scroll trace is captured, only the aggregate scroll-depth and
          click-count already surfaced under Visitor Analytics&apos; engagement summary. General on-site engagement (time on page, scroll
          depth) also lives there rather than being duplicated here.
        </p>
      </Card>
    </div>
  );
}
