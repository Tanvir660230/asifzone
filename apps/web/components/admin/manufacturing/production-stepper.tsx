"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import * as booksApi from "@/lib/api/finance-books";
import type { ProductionOrderStatus } from "@/lib/api/manufacturing";
import { cn } from "@/lib/utils";

const STEPS = [
  { label: "Plan", at: ["DRAFT"] },
  { label: "Approved", at: ["APPROVED"] },
  { label: "Making", at: ["IN_PRODUCTION"] },
  { label: "Received", at: ["PARTIALLY_RECEIVED", "RECEIVED"] },
  { label: "Closed", at: ["CLOSED"] },
] as const satisfies ReadonlyArray<{ label: string; at: readonly ProductionOrderStatus[] }>;

/**
 * Where a production run is (stock UI redesign): plan → approved → making → received → closed, the current step marked.
 * A cancelled run shows no steps — only that it was cancelled.
 */
export function ProductionStepper({ status }: { status: ProductionOrderStatus }) {
  if (status === "CANCELLED") return null;
  const current = STEPS.findIndex((s) => (s.at as readonly string[]).includes(status));
  return (
    <ol aria-label="Progress" className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:gap-2" data-testid="mo-stepper">
      {STEPS.map((s, i) => {
        const done = i < current || status === "CLOSED";
        const here = i === current && status !== "CLOSED";
        const label = s.label === "Received" && status === "PARTIALLY_RECEIVED" ? "Part received" : s.label;
        return (
          <li key={s.label} className="flex shrink-0 items-center gap-1.5 sm:gap-2" aria-current={here ? "step" : undefined}>
            {i > 0 && <span aria-hidden className={cn("h-px w-4 sm:w-8", i <= current ? "bg-info-500" : "bg-line")} />}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full py-1 text-xs font-medium",
                here ? "px-2.5" : "px-1.5 sm:px-2.5",
                done && "bg-success-100 text-success-700",
                here && "bg-info-100 text-info-700",
                !done && !here && "text-fg-subtle",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", here ? "bg-info-500" : "bg-ink-300")} />}
              {/* phones name only the current step; the others stay as marks so all five fit at 375px */}
              <span className={here ? undefined : "sr-only sm:not-sr-only"}>{label}</span>
              {done && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The packaging each parcel of this product takes when it leaves (Finance › Packaging rules), so a production plan shows
 * the packaging to have ready beside the materials. Rules for every parcel and for this product are listed; category
 * rules are counted with a link, since a run doesn't carry the product's categories.
 */
export function ProductPackaging({ productId }: { productId: string }) {
  const q = useQuery({ queryKey: booksApi.booksKeys.packaging(), queryFn: booksApi.getPackaging });
  if (q.isLoading) return <Skeleton className="h-20 w-full rounded-xl" />;
  if (q.isError || !q.data) return null;
  const active = q.data.rules.filter((r) => r.isActive);
  const rules = active.filter((r) => r.scope === "EVERY_PARCEL" || (r.scope === "PRODUCT" && r.scopeId === productId));
  const byCategory = active.filter((r) => r.scope === "CATEGORY").length;
  const material = new Map(q.data.materials.map((m) => [m.id, m]));
  return (
    <section className="space-y-2" aria-labelledby="mo-packaging" data-testid="mo-packaging">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="mo-packaging" className="text-lg font-semibold text-fg">Packaging</h2>
        <Link href="/admin/finance/packaging" className="text-sm font-medium text-accent hover:underline">Packing rules</Link>
      </div>
      {rules.length === 0 ? (
        <p className="text-sm text-fg-muted">No packing rule covers this product yet{byCategory ? ` (${byCategory} category rule${byCategory === 1 ? "" : "s"} may)` : ""}.</p>
      ) : (
        <Card className="divide-y divide-line p-0 text-sm">
          {rules.map((r) => {
            const m = material.get(r.material.id);
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="text-fg">{r.quantity} × {r.material.product.name}{r.material.size && r.material.size !== "Default" ? ` (${r.material.size})` : ""}</span>
                  <span className="text-fg-muted"> {r.per === "UNIT" ? "per item" : "per parcel"} · {r.scope === "EVERY_PARCEL" ? "every parcel" : "this product"}</span>
                </span>
                <span className={cn("whitespace-nowrap tabular-nums", m?.low ? "font-medium text-warning-700" : "text-fg-muted")}>
                  {r.material.stock.toLocaleString()} {r.material.product.stockUnit ?? ""} in stock{m?.low ? " · buy soon" : ""}
                </span>
              </div>
            );
          })}
        </Card>
      )}
      {rules.length > 0 && byCategory > 0 && <p className="text-xs text-fg-muted">{byCategory} category rule{byCategory === 1 ? "" : "s"} may add more.</p>}
    </section>
  );
}
