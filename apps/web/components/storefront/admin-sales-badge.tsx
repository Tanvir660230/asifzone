"use client";

import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import type { ProductSalesSummary } from "@clothing-brand/shared";
import { clearAdminHint, hasAdminHint } from "@/lib/admin-hint";
import { env } from "@/lib/env";

/** GET the figures with the admin session cookie. The access token is short-lived, so a 401 gets one silent refresh through the
 * *admin* refresh endpoint (the shared apiFetch would refresh the customer session on a storefront page) and a retry. */
async function fetchSummary(productId: string): Promise<{ status: "ok"; summary: ProductSalesSummary } | { status: "denied" } | { status: "error" }> {
  const url = `${env.apiUrl}/api/products/${productId}/sales-summary`;
  try {
    let res = await fetch(url, { credentials: "include" });
    if (res.status === 401) {
      const refreshed = await fetch(`${env.apiUrl}/api/auth/refresh`, { method: "POST", credentials: "include" });
      if (refreshed.ok) res = await fetch(url, { credentials: "include" });
    }
    if (res.status === 401 || res.status === 403) return { status: "denied" };
    if (!res.ok) return { status: "error" };
    return { status: "ok", summary: (await res.json()) as ProductSalesSummary };
  } catch {
    return { status: "error" };
  }
}

/** "Sold in the last 7 days", for the shop's own admins only. Renders nothing for everyone else and, because it only asks the API when
 * this browser carries the admin marker, costs customers no request at all. The API is what enforces who may see the numbers. */
export function AdminSalesBadge({ productId }: { productId: string }) {
  const [summary, setSummary] = useState<ProductSalesSummary | null>(null);

  useEffect(() => {
    if (!hasAdminHint()) return;
    let live = true;
    fetchSummary(productId).then((result) => {
      if (!live) return;
      if (result.status === "ok") setSummary(result.summary);
      else if (result.status === "denied") clearAdminHint(); // the session ended: stop asking until the next admin login
    });
    return () => {
      live = false;
    };
  }, [productId]);

  if (!summary) return null;

  return (
    <div className="mt-3 rounded-lg border border-dashed border-brass-300 bg-brass-50 px-3 py-2 text-sm text-ink-800" data-testid="admin-sales-7d">
      <p className="flex items-center gap-1.5">
        <BarChart3 size={14} className="shrink-0 text-brass-700" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-brass-800">Admin only</span>
        <span>
          Sold in the last {summary.days} days: <strong data-testid="admin-sales-7d-units">{summary.unitsSold}</strong> unit{summary.unitsSold === 1 ? "" : "s"}
          {summary.orders > 0 && (
            <span className="text-ink-500">
              {" "}
              in {summary.orders} order{summary.orders === 1 ? "" : "s"}
            </span>
          )}
        </span>
      </p>
      {summary.byVariant.length > 0 && (
        <details className="mt-1 text-xs text-ink-600">
          <summary className="cursor-pointer text-ink-500">By variant</summary>
          <ul className="mt-1 space-y-0.5">
            {summary.byVariant.map((v) => (
              <li key={v.variantId}>
                {[v.size, v.color].filter(Boolean).join(" / ")} <span className="text-ink-400">({v.sku})</span>: {v.units}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
