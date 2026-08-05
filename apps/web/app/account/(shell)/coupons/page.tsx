"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Check } from "lucide-react";
import { listActiveCoupons } from "@/lib/api/coupons";
import { formatPrice } from "@/lib/format";

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

      {isLoading && <p className="text-ink-400">Loading…</p>}
      {!isLoading && data?.coupons.length === 0 && <p className="text-ink-400">No active coupons right now.</p>}

      <div className="space-y-3">
        {data?.coupons.map((coupon) => (
          <div key={coupon.id} className="flex items-center justify-between border border-dashed border-brass-300 bg-brass-50 p-4">
            <div>
              <p className="font-display text-lg text-ink-900">{coupon.code}</p>
              <p className="text-sm text-ink-600">
                {coupon.type === "PERCENTAGE" ? `${coupon.value}% off` : `${formatPrice(coupon.value)} off`}
                {coupon.minOrderAmount ? ` orders over ${formatPrice(coupon.minOrderAmount)}` : ""}
              </p>
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
