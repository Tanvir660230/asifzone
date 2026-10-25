"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as stockApi from "@/lib/api/stock";
import type { KitComponent } from "@/lib/api/stock";
import { formatBookDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
const SOURCE: Record<KitComponent["source"], string> = { RECIPE: "Recipe", ITEM: "The item", PACKING: "Packing", ROLL: "Roll" };

/** A product's kit (docs/STOCK_HUB.md §11): everything one sale of a size takes — its recipe (or the item itself), the
 * parcel's packing, rolls — with what is in stock, how many sales that covers, when it runs out and the last purchase. */
export function KitPanel({ productId }: { productId: string }) {
  const { can } = useCapabilities();
  const q = useQuery({ queryKey: [...stockApi.stockKeys.all, "kit", productId], queryFn: () => stockApi.getProductKit(productId), enabled: can("inventory.view") });
  const [sizeId, setSizeId] = useState<string | null>(null);
  if (!can("inventory.view")) return null;
  if (q.isLoading) return <Skeleton className="h-56 w-full" />;
  if (q.isError || !q.data) return <Alert variant="danger" title="The kit couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>;
  const kit = q.data;
  const size = kit.sizes.find((s) => s.variantId === sizeId) ?? kit.sizes[0];
  if (!size) return <p className="text-sm text-fg-muted">No sizes on sale yet.</p>;
  const canBuy = can("purchasing.receive");
  const canCount = can("inventory.adjust");

  return (
    <div className="space-y-4" data-testid="kit-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {kit.sizes.length > 1 ? (
          <SegmentedControl aria-label="Size" value={size.variantId} onChange={setSizeId} options={kit.sizes.map((s) => ({ value: s.variantId, label: s.label }))} />
        ) : <span className="text-sm text-fg-muted">{size.label}</span>}
        <p className="text-sm text-fg-muted">
          {size.canSell === null ? "How many can be sold isn't known yet" : <>Stock covers <span className="font-semibold tabular-nums text-fg">{num(size.canSell)}</span> more sales{size.runsOutFirst ? <> — <span className="text-fg">{size.runsOutFirst.name}</span> runs out first</> : null}</>}
          {size.kitCost !== null && <> · {formatPrice(size.kitCost)} a sale</>}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line-subtle">
        <ul>
          {size.components.map((c) => (
            <li key={c.variantId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b border-line-subtle px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]" data-testid="kit-component">
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-fg">
                  {c.name}
                  <Badge variant="neutral">{SOURCE[c.source]}</Badge>
                  {c.low && <Badge variant="warning">Low</Badge>}
                </span>
                <span className="block text-xs text-fg-muted">
                  {c.perSale === null ? "A share of the roll per parcel" : `${num(c.perSale)} ${c.unit} a sale`}
                  {c.costPerSale !== null && ` · ${formatPrice(c.costPerSale)} a sale`}
                  {c.lastPurchase ? ` · last bought ${formatBookDate(c.lastPurchase.date)}${c.lastPurchase.unitCost !== null ? ` at ${formatPrice(c.lastPurchase.unitCost)}/${c.unit}` : ""}` : " · no purchase recorded"}
                </span>
              </span>
              <span className="text-right text-sm sm:text-left">
                <span className="block font-semibold tabular-nums text-fg">{num(c.stock)} {c.unit}</span>
                <span className="block text-xs text-fg-muted">in stock</span>
              </span>
              <span className="text-sm max-sm:col-span-2">
                <span className={cn("block font-semibold tabular-nums", c.enoughFor !== null && c.enoughFor <= 10 ? "text-warning-700" : "text-fg")}>{c.enoughFor === null ? "—" : `${num(c.enoughFor)} sales`}</span>
                <span className="block text-xs text-fg-muted">{c.daysLeft === null ? "not used lately" : `about ${num(c.daysLeft)} days`}</span>
              </span>
              <span className="flex gap-1 max-sm:col-span-2 sm:justify-end">
                {canBuy && kit.costingActive && <Link href={`/admin/stock?bought=${c.variantId}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Bought</Link>}
                {canCount && kit.costingActive && <Link href={`/admin/stock?count=${c.variantId}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Count</Link>}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-fg-muted">
        Change what goes in: {size.recipe ? <Link href="/admin/manufacturing/boms" className="font-medium text-accent hover:underline">recipe v{size.recipe.version}</Link> : <Link href="/admin/manufacturing/boms" className="font-medium text-accent hover:underline">add a recipe</Link>} ·{" "}
        <Link href="/admin/finance/packaging" className="font-medium text-accent hover:underline">packing rules</Link> · rolls on <Link href="/admin/finance/stock-check" className="font-medium text-accent hover:underline">Stock check</Link>.
      </p>
    </div>
  );
}
