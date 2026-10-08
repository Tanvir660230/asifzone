"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Check, Tag } from "lucide-react";
import type { Coupon } from "@clothing-brand/shared";
import { AccountTitle } from "@/components/account/account-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/empty-state";
import { AccountEmptyState } from "@/components/account/account-empty-state";
import { listActiveCoupons } from "@/lib/api/coupons";
import { formatPrice, formatStoreDate } from "@/lib/format";

function discountLine(coupon: Coupon): string {
  if (coupon.type === "FREE_SHIPPING") return "Free shipping";
  return coupon.type === "PERCENTAGE" ? `${coupon.value}% off` : `${formatPrice(coupon.value ?? 0)} off`;
}

function targetLine(coupon: Coupon): string | null {
  if (coupon.scope === "SPECIFIC_PRODUCTS") {
    const names = coupon.products.map((p) => p.product?.name).filter(Boolean);
    return names.length ? `For ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}` : null;
  }
  if (coupon.scope === "SPECIFIC_CATEGORIES") {
    const names = coupon.categories.map((c) => c.category?.name).filter(Boolean);
    return names.length ? `For ${names.join(", ")}` : null;
  }
  return null;
}

export default function AccountCouponsPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["active-coupons"], queryFn: () => listActiveCoupons() });
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  async function handleCopy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      // clipboard API unavailable — the code is still visible to copy manually
    }
  }

  return (
    <div>
      <AccountTitle title="Coupons" description="Codes you can use right now. Copy one and paste it at checkout." />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState variant="bordered" title="Coupons didn't load" onRetry={() => refetch()} />
      ) : !data || data.coupons.length === 0 ? (
        <AccountEmptyState icon={Tag} title="No coupons right now" description="New codes appear here during sales and special offers." />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {data.coupons.map((coupon) => {
            const copied = copiedCode === coupon.code;
            const target = targetLine(coupon);
            return (
              <li key={coupon.id} className="relative flex overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-inset ring-line-subtle">
                <div className="flex min-w-0 flex-1 flex-col p-5 sm:p-6">
                  <p className="font-display text-3xl tracking-tight text-fg">{discountLine(coupon)}</p>
                  <p className="mt-1 text-sm text-fg-muted">
                    {coupon.minOrderAmount ? `On orders over ${formatPrice(coupon.minOrderAmount)}` : "On any order"}
                    {target && <span className="block">{target}</span>}
                  </p>
                  {coupon.expiresAt && (
                    <p className="mt-auto pt-4 text-xs text-fg-muted">Ends {formatStoreDate(coupon.expiresAt, { day: "numeric", month: "long" })}</p>
                  )}
                </div>
                {/* Perforated edge between the offer and its code, like a paper ticket. */}
                <div aria-hidden="true" className="my-4 border-l border-dashed border-line-strong" />
                <div className="flex w-32 shrink-0 flex-col items-center justify-center gap-3 p-4 sm:w-36">
                  <p className="break-all text-center text-sm font-semibold tracking-[0.06em] text-fg">{coupon.code}</p>
                  <Button variant={copied ? "secondary" : "outline"} size="sm" onClick={() => handleCopy(coupon.code)} aria-label={`Copy code ${coupon.code}`}>
                    {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <span className="sr-only" role="status" aria-live="polite">
                    {copied ? `${coupon.code} copied to clipboard` : ""}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
