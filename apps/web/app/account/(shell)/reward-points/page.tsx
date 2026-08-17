"use client";

import { useQuery } from "@tanstack/react-query";
import { Gift } from "lucide-react";
import { useCurrentCustomer } from "@/hooks/use-current-customer";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { AccountEmptyState } from "@/components/account/account-empty-state";
import { listMyPointsLedger } from "@/lib/api/customers";

export default function AccountRewardPointsPage() {
  const { data: customerData } = useCurrentCustomer();
  const { data, isLoading } = useQuery({ queryKey: ["my-points"], queryFn: () => listMyPointsLedger() });

  return (
    <div>
      <AccountPageHeader title="Reward Points" description="Earn points on every order and redeem them for discounts." />

      <div className="mb-6 rounded-lg border border-ink-100 bg-cream-50 p-6 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-ink-500">Current balance</p>
        <p className="mt-1 font-display text-3xl text-ink-900">{customerData?.customer?.rewardPoints ?? 0} pts</p>
      </div>

      {isLoading && (
        <div className="animate-pulse divide-y divide-ink-100 border-y border-ink-100">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center justify-between py-4">
              <div className="space-y-1.5">
                <div className="h-3.5 w-32 rounded bg-ink-100" />
                <div className="h-2.5 w-20 rounded bg-ink-100" />
              </div>
              <div className="h-3.5 w-12 rounded bg-ink-100" />
            </div>
          ))}
        </div>
      )}
      {!isLoading && data?.items.length === 0 && (
        <AccountEmptyState icon={Gift} title="No points activity yet" description="Points you earn or redeem will show up here." />
      )}

      <div className="divide-y divide-ink-100 border-y border-ink-100">
        {data?.items.map((entry) => (
          <div key={entry.id} className="flex items-center justify-between py-4 text-sm">
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
