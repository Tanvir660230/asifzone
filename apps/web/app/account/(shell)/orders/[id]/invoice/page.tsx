"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { InvoicePageChrome } from "@/components/orders/invoice-page-chrome";
import { getMyOrder } from "@/lib/api/customers";
import { getSettings } from "@/lib/api/settings";

export default function AccountOrderInvoicePage() {
  const { id } = useParams<{ id: string }>();

  const { data: orderData, isLoading } = useQuery({ queryKey: ["my-order", id], queryFn: () => getMyOrder(id) });
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: getSettings });

  return <InvoicePageChrome isLoading={isLoading} order={orderData?.order} store={settingsData?.settings} />;
}
