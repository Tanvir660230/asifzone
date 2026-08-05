"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Printer, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InvoiceDocument } from "@/components/orders/invoice-document";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import * as settingsApi from "@/lib/api/settings";

export default function OrderInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: orderData, isLoading } = useQuery({ queryKey: ["admin-order", id], queryFn: () => adminOrdersApi.getOrder(id) });
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: settingsApi.getSettings });

  if (isLoading || !orderData) return <p className="p-8 text-ink-400">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-10">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
          <ArrowLeft size={16} /> Back
        </button>
        <Button onClick={() => window.print()} variant="brass" size="sm">
          <Printer size={14} /> Print
        </Button>
      </div>

      <InvoiceDocument order={orderData.order} store={settingsData?.settings} />
    </div>
  );
}
