"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, Ban, Megaphone, PackageMinus, PackagePlus, ScanEye, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/empty-state";
import * as analyticsApi from "@/lib/api/admin-analytics";
import type { ProductAction, ProductActionKind } from "@/lib/api/admin-analytics";
import { cn } from "@/lib/utils";

const KINDS: Record<ProductActionKind, { label: string; icon: LucideIcon; tone: string }> = {
  sold_out: { label: "Sold out", icon: Ban, tone: "text-danger-600" },
  restock: { label: "Restock", icon: PackagePlus, tone: "text-warning-600" },
  refusals: { label: "Refusals", icon: AlertOctagon, tone: "text-danger-600" },
  fix_page: { label: "Fix the page", icon: ScanEye, tone: "text-warning-600" },
  clear_stock: { label: "Clear stock", icon: PackageMinus, tone: "text-ink-500" },
  promote: { label: "Promote", icon: Megaphone, tone: "text-success-700" },
};
const ORDER: ProductActionKind[] = ["sold_out", "restock", "refusals", "fix_page", "clear_stock", "promote"];
const GROUPS: Array<{ priority: 1 | 2 | 3; title: string }> = [
  { priority: 1, title: "Do today" },
  { priority: 2, title: "This week" },
  { priority: 3, title: "When there's time" },
];

function ActionRow({ a }: { a: ProductAction }) {
  const k = KINDS[a.kind];
  const Icon = k.icon;
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-900/[0.04]", k.tone)} aria-hidden="true">
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-snug text-fg">
          <Link href={`/admin/products/${a.productId}`} className="font-semibold hover:underline">
            {a.name}
          </Link>
          <span className="text-fg-muted"> · </span>
          {a.title}
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-fg-muted">{a.detail}</p>
      </div>
      <span className="sr-only">Type: {k.label}</span>
    </li>
  );
}

/** Every product signal turned into a to-do: sold out, restock, refusals, fix the page, clear stock, promote. */
export default function ActionsView() {
  const [filter, setFilter] = useState<ProductActionKind | "all">("all");
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["product-actions"], queryFn: analyticsApi.getProductActions });

  if (isError) return <ErrorState description="The action list didn't load." onRetry={() => void refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading">
        <div className="h-9 w-full max-w-xl animate-pulse rounded-full bg-ink-900/[0.05]" />
        <div className="h-80 animate-pulse rounded-xl bg-ink-900/[0.04]" />
      </div>
    );
  }

  const shown = filter === "all" ? data.actions : data.actions.filter((a) => a.kind === filter);
  const chip = (value: ProductActionKind | "all", label: string, count: number) => (
    <button
      key={value}
      type="button"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
      disabled={value !== "all" && count === 0}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors duration-fast disabled:opacity-40",
        filter === value ? "bg-ink-900 text-cream-50" : "bg-ink-900/[0.05] text-fg hover:bg-ink-900/[0.08]",
      )}
    >
      {label}
      <span className={cn("tabular-nums", filter === value ? "text-cream-50/70" : "text-fg-muted")}>{count}</span>
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Show actions of type">
        {chip("all", "All", data.actions.length)}
        {ORDER.map((k) => chip(k, KINDS[k].label, data.counts[k]))}
      </div>

      {shown.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-[15px] font-medium text-fg">Nothing to do here</p>
          <p className="mt-1 text-sm text-fg-muted">No product needs this kind of attention right now.</p>
        </Card>
      ) : (
        GROUPS.map((g) => {
          const items = shown.filter((a) => a.priority === g.priority);
          if (!items.length) return null;
          return (
            <section key={g.priority} aria-labelledby={`actions-${g.priority}`}>
              <h3 id={`actions-${g.priority}`} className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-fg-muted">
                {g.title} <span className="tabular-nums">· {items.length}</span>
              </h3>
              <Card className="p-4 sm:p-5">
                <ul className="divide-y divide-line">
                  {items.map((a) => (
                    <ActionRow key={`${a.productId}:${a.kind}:${a.title}`} a={a} />
                  ))}
                </ul>
              </Card>
            </section>
          );
        })
      )}

      <p className="text-[12px] leading-relaxed text-fg-muted">
        From the last 30 days of views, add-to-carts and orders, current stock, and the last 60 days of deliveries. Store averages:{" "}
        {(data.baseline.viewToCartRate * 100).toFixed(1)}% of views add to cart, {(data.baseline.viewToOrderRate * 100).toFixed(1)}% order,{" "}
        {Math.round(data.baseline.refusalRate * 100)}% of parcels refused.
      </p>
    </div>
  );
}
