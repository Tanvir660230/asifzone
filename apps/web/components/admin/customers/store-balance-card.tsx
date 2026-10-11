"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import type { StoreCreditEntryType } from "@clothing-brand/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import * as adminCustomersApi from "@/lib/api/admin-customers";
import { formatPrice, formatStoreDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const ENTRY_LABEL: Record<StoreCreditEntryType, string> = {
  CANCELLATION: "Order cancelled",
  ORDER_MODIFICATION: "Order changed",
  RETURN: "Return",
  EXCHANGE: "Exchange",
  REFUND_TO_CREDIT: "Refund to store balance",
  ORDER_PAYMENT: "Paid an order",
  ORDER_PAYMENT_RELEASED: "Order payment released",
};

/** Blueprint V2 P5 "store credit sheet": the customer's store balance and its history, read from the credit ledger
 * (never a stored number). Read-only — credit is issued and spent through orders (docs/ORDER_ADJUSTMENTS.md §4). Shown
 * only once the customer has any store-balance history. */
export function StoreBalanceCard({ customerId }: { customerId: string }) {
  const { data } = useQuery({
    queryKey: ["customer-store-credit", customerId],
    queryFn: () => adminCustomersApi.getCustomerStoreCredit(customerId),
  });
  const credit = data?.storeCredit;
  if (!credit || credit.entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Wallet size={16} className="text-success-600" aria-hidden="true" /> Store balance
          </span>
          <span className="text-lg font-semibold tabular-nums text-fg">{formatPrice(credit.balance)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-line-subtle text-sm">
          {credit.entries.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="font-medium text-fg">
                  {ENTRY_LABEL[e.type] ?? e.type}
                  {e.orderId && e.orderNumber && (
                    <>
                      {" · "}
                      <Link href={`/admin/orders/${e.orderId}`} className="text-accent hover:underline">
                        {e.orderNumber}
                      </Link>
                    </>
                  )}
                </p>
                {e.reason && <p className="truncate text-xs text-fg-muted" title={e.reason}>{e.reason}</p>}
                <p className="text-xs text-fg-subtle">{formatStoreDateTime(e.createdAt)}</p>
              </div>
              <span className={cn("shrink-0 font-medium tabular-nums", e.amount >= 0 ? "text-success-700" : "text-fg")}>
                {e.amount >= 0 ? "+" : "−"}
                {formatPrice(Math.abs(e.amount))}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
