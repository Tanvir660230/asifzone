"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { InvoicePageChrome } from "@/components/orders/invoice-page-chrome";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import * as settingsApi from "@/lib/api/settings";

export default function OrderInvoicePage() {
  const { id } = useParams<{ id: string }>();

  const { data: orderData, isLoading } = useQuery({ queryKey: ["admin-order", id], queryFn: () => adminOrdersApi.getOrder(id) });
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: settingsApi.getSettings });

  return <InvoicePageChrome isLoading={isLoading} order={orderData?.order} store={settingsData?.settings} />;
}
