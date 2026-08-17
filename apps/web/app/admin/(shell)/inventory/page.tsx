"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { PageSizeSelect } from "@/components/admin/page-size-select";
import { Pagination } from "@/components/admin/pagination";
import { AdjustStockModal, type AdjustStockPrefill } from "@/components/admin/adjust-stock-modal";
import * as inventoryApi from "@/lib/api/inventory";
import { cn } from "@/lib/utils";

const REASONS = ["ORDER", "RESTOCK", "ADJUSTMENT", "RETURN"] as const;

const REASON_BADGE: Record<(typeof REASONS)[number], string> = {
  ORDER: "bg-ink-100 text-ink-700",
  RESTOCK: "bg-success-100 text-success-700",
  ADJUSTMENT: "bg-warning-100 text-warning-700",
  RETURN: "bg-info-100 text-info-700",
};

export default function InventoryPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [reason, setReason] = useState("");
  const variantId = searchParams.get("variantId") ?? undefined;
  const productId = searchParams.get("productId") ?? undefined;

  const { data, isLoading } = useQuery({
    queryKey: ["stock-movements", { page, pageSize, reason, variantId, productId }],
    queryFn: () =>
      inventoryApi.listStockMovements({
        page,
        pageSize,
        reason: (reason || undefined) as never,
        variantId,
        productId,
      }),
  });

  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustPrefill, setAdjustPrefill] = useState<AdjustStockPrefill | null>(null);
  const [showReconciliation, setShowReconciliation] = useState(false);

  const reconciliationQuery = useQuery({
    queryKey: ["stock-reconciliation"],
    queryFn: inventoryApi.getStockReconciliation,
    enabled: false,
  });

  function invalidateMovements() {
    queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
    queryClient.invalidateQueries({ queryKey: ["stock-reconciliation"] });
  }

  function openAdjust(prefill: AdjustStockPrefill | null = null) {
    setAdjustPrefill(prefill);
    setShowAdjust(true);
  }

  return (
    <div>
      <PageHeader
        title="Inventory"
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowReconciliation(true);
                reconciliationQuery.refetch();
              }}
            >
              <ShieldCheck size={16} /> Check integrity
            </Button>
            <Button variant="brass" onClick={() => openAdjust(null)}>
              <Plus size={16} /> Adjust stock
            </Button>
          </div>
        }
      />

      {(variantId || productId) && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-brass-300 bg-brass-50/60 px-3 py-2 text-sm text-ink-700">
          <span>Filtered to a specific {variantId ? "variant" : "product"}.</span>
          <button onClick={() => router.replace("/admin/inventory")} className="text-brass-700 underline">
            Clear filter
          </button>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-2">
        <Select
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setPage(1);
          }}
          className="w-48"
        >
          <option value="">All reasons</option>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <PageSizeSelect
          value={pageSize}
          onChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>

      {/* sm and up: the table below. Below sm: a card list (below that) — same split as the other
          admin list pages. */}
      <div className="hidden overflow-hidden rounded-lg border border-ink-100 bg-cream-50 sm:block">
        <HScrollShadow className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3 text-right">Change</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Admin</th>
                <th className="px-4 py-3">Note</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={8} cols={7} />}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-ink-400">
                    No stock movements yet.
                  </td>
                </tr>
              )}
              {data?.items.map((m) => (
                <tr key={m.id} className="border-t border-ink-100 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                  <td className="px-4 py-3 text-ink-500">{new Date(m.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {m.variant ? (
                      <>
                        <div>{m.variant.product.name}</div>
                        <div className="text-xs text-ink-400">
                          {m.variant.sku} · {m.variant.size}/{m.variant.color}
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={REASON_BADGE[m.reason]}>{m.reason}</Badge>
                  </td>
                  <td className={`px-4 py-3 text-right font-medium ${m.change > 0 ? "text-success-600" : "text-danger-600"}`}>
                    {m.change > 0 ? `+${m.change}` : m.change}
                  </td>
                  <td className="px-4 py-3">
                    {m.orderId ? (
                      <Link href={`/admin/orders/${m.orderId}`} className="text-brass-600 hover:underline">
                        View
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-500">{m.admin?.name ?? "System"}</td>
                  <td className="px-4 py-3 text-ink-500">{m.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScrollShadow>
      </div>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50 sm:hidden">
        {isLoading &&
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={cn("animate-pulse border-t border-ink-100 p-3.5", i === 0 && "border-t-0")}>
              <div className="h-3.5 w-2/3 rounded bg-ink-100" />
              <div className="mt-3 h-3 w-1/3 rounded bg-ink-50" />
            </div>
          ))}
        {!isLoading && data?.items.length === 0 && (
          <p className="px-4 py-10 text-center text-ink-400">No stock movements yet.</p>
        )}
        {data?.items.map((m) => (
          <div key={m.id} className="border-t border-ink-100 p-3.5 first:border-t-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {m.variant ? (
                  <>
                    <p className="truncate font-medium text-ink-900">{m.variant.product.name}</p>
                    <p className="truncate text-xs text-ink-400">
                      {m.variant.sku} · {m.variant.size}/{m.variant.color}
                    </p>
                  </>
                ) : (
                  <p className="text-ink-400">—</p>
                )}
              </div>
              <span className={cn("shrink-0 font-medium", m.change > 0 ? "text-success-600" : "text-danger-600")}>
                {m.change > 0 ? `+${m.change}` : m.change}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-2.5 text-xs text-ink-500">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={REASON_BADGE[m.reason]}>{m.reason}</Badge>
                <span>{new Date(m.createdAt).toLocaleString()}</span>
              </div>
              {m.orderId && (
                <Link href={`/admin/orders/${m.orderId}`} className="text-brass-600 hover:underline">
                  View order
                </Link>
              )}
            </div>
            {(m.admin?.name || m.note) && (
              <div className="mt-2 text-xs text-ink-500">
                {m.admin?.name ?? "System"}
                {m.note ? ` — ${m.note}` : ""}
              </div>
            )}
          </div>
        ))}
      </div>

      {data && data.total > data.pageSize && (
        <Pagination page={page} totalPages={Math.ceil(data.total / data.pageSize)} onChange={setPage} />
      )}

      <AdjustStockModal
        open={showAdjust}
        onClose={() => setShowAdjust(false)}
        prefill={adjustPrefill}
        onSuccess={invalidateMovements}
      />

      <Modal open={showReconciliation} onClose={() => setShowReconciliation(false)} title="Stock integrity check">
        {reconciliationQuery.isFetching && <p className="text-sm text-ink-500">Checking every variant against its ledger…</p>}
        {!reconciliationQuery.isFetching && reconciliationQuery.data && (
          reconciliationQuery.data.discrepancies.length === 0 ? (
            <p className="text-sm text-success-700">Everything matches — no drift found.</p>
          ) : (
            <ul className="space-y-2">
              {reconciliationQuery.data.discrepancies.map((d) => (
                <li
                  key={d.variantId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-warning-200 bg-warning-50/60 px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium text-ink-900">
                      {d.productName} — {d.sku}
                    </div>
                    <div className="text-ink-500">
                      Stock shows {d.currentStock}, ledger says {d.ledgerSum}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowReconciliation(false);
                      openAdjust({ variantId: d.variantId, label: `${d.productName} — ${d.sku} (currently ${d.currentStock})` });
                    }}
                  >
                    Adjust
                  </Button>
                </li>
              ))}
            </ul>
          )
        )}
      </Modal>
    </div>
  );
}
