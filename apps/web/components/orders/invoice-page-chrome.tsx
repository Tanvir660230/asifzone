"use client";

import { useRouter } from "next/navigation";
import { Printer, ArrowLeft } from "lucide-react";
import type { Order, StoreSettings } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { InvoiceDocument } from "@/components/orders/invoice-document";

interface InvoicePageChromeProps {
  isLoading: boolean;
  order: Order | undefined;
  store: StoreSettings | undefined;
}

/** Back/print chrome + loading skeleton around InvoiceDocument — was duplicated byte-for-byte
 * between the admin and account invoice routes, which otherwise only differ in which API they
 * fetch the order from. */
export function InvoicePageChrome({ isLoading, order, store }: InvoicePageChromeProps) {
  const router = useRouter();

  if (isLoading || !order) {
    return (
      <div className="mx-auto max-w-3xl animate-pulse space-y-4 p-6 sm:p-10">
        <div className="h-6 w-40 rounded bg-ink-100" />
        <div className="h-64 w-full rounded bg-ink-100" />
      </div>
    );
  }

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

      <InvoiceDocument order={order} store={store} />
    </div>
  );
}
