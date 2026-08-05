"use client";

import { useQuery } from "@tanstack/react-query";
import { useCurrentCustomer } from "@/hooks/use-current-customer";
import { listMyPointsLedger } from "@/lib/api/customers";

export default function AccountRewardPointsPage() {
  const { data: customerData } = useCurrentCustomer();
  const { data, isLoading } = useQuery({ queryKey: ["my-points"], queryFn: () => listMyPointsLedger() });

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl text-ink-900">Reward Points</h1>

      <div className="mb-6 border border-ink-100 bg-cream-50 p-6">
        <p className="text-xs uppercase tracking-wide text-ink-500">Current balance</p>
        <p className="mt-1 font-display text-3xl text-ink-900">{customerData?.customer?.rewardPoints ?? 0} pts</p>
      </div>

      {isLoading && <p className="text-ink-400">Loading…</p>}
      {!isLoading && data?.items.length === 0 && <p className="text-ink-400">No points activity yet.</p>}

      <div className="divide-y divide-ink-100 border-y border-ink-100">
        {data?.items.map((entry) => (
          <div key={entry.id} className="flex items-center justify-between py-3 text-sm">
            <div>
              <p className="text-ink-900">{entry.reason}</p>
              <p className="text-xs text-ink-400">{new Date(entry.createdAt).toLocaleDateString()}</p>
            </div>
            <span className={entry.points >= 0 ? "text-success-600" : "text-danger-600"}>
              {entry.points >= 0 ? "+" : ""}
              {entry.points} pts
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
