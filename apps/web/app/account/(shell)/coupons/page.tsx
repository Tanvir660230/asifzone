"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Check } from "lucide-react";
import type { Coupon } from "@clothing-brand/shared";
import { listActiveCoupons } from "@/lib/api/coupons";
import { formatPrice } from "@/lib/format";

function discountLine(coupon: Coupon): string {
  if (coupon.type === "FREE_SHIPPING") return "Free shipping";
  return coupon.type === "PERCENTAGE" ? `${coupon.value}% off` : `${formatPrice(coupon.value ?? 0)} off`;
}

function targetLine(coupon: Coupon): string | null {
  if (coupon.scope === "SPECIFIC_PRODUCTS") {
    const names = coupon.products.map((p) => p.product?.name).filter(Boolean);
    return names.length ? `On: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} more` : ""}` : null;
  }
  if (coupon.scope === "SPECIFIC_CATEGORIES") {
    const names = coupon.categories.map((c) => c.category?.name).filter(Boolean);
    return names.length ? `On: ${names.join(", ")}` : null;
  }
  return null;
}

export default function AccountCouponsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["active-coupons"], queryFn: () => listActiveCoupons() });
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
      <h1 className="mb-6 font-display text-2xl text-ink-900">Coupons</h1>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="animate-pulse border border-dashed border-ink-200 bg-cream-50 p-4">
              <div className="h-4 w-28 rounded bg-ink-100" />
              <div className="mt-2 h-3 w-40 rounded bg-ink-100" />
            </div>
          ))}
        </div>
      )}
      {!isLoading && data?.coupons.length === 0 && <p className="text-ink-400">No active coupons right now.</p>}

      <div className="space-y-3">
        {data?.coupons.map((coupon) => (
          <div key={coupon.id} className="flex items-center justify-between border border-dashed border-sale-500/40 bg-sale-50 p-4">
            <div>
              <p className="font-display text-lg text-ink-900">{coupon.code}</p>
              <p className="text-sm text-ink-600">
                {discountLine(coupon)}
                {coupon.minOrderAmount ? ` orders over ${formatPrice(coupon.minOrderAmount)}` : ""}
              </p>
              {targetLine(coupon) && <p className="text-xs text-ink-500">{targetLine(coupon)}</p>}
              {coupon.expiresAt && (
                <p className="text-xs text-ink-400">Expires {new Date(coupon.expiresAt).toLocaleDateString()}</p>
              )}
            </div>
            <button
              onClick={() => handleCopy(coupon.code)}
              className="flex items-center gap-1.5 rounded-full border border-ink-200 bg-cream-50 px-3 py-1.5 text-xs text-ink-700 hover:border-brass-400"
            >
              {copiedCode === coupon.code ? <Check size={14} /> : <Copy size={14} />}
              {copiedCode === coupon.code ? "Copied" : "Copy"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
