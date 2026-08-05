"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Printer, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InvoiceDocument } from "@/components/orders/invoice-document";
import { getMyOrder } from "@/lib/api/customers";
import { getSettings } from "@/lib/api/settings";

export default function AccountOrderInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: orderData, isLoading } = useQuery({ queryKey: ["my-order", id], queryFn: () => getMyOrder(id) });
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: getSettings });

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
