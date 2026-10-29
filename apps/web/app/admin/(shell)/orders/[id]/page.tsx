"use client";

import { useParams, useRouter } from "next/navigation";
import { OrderDetailPanel } from "@/components/admin/order-detail-panel";
import { ordersListHref } from "@/lib/admin/orders-return";

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  // Closing returns to the Orders list as it was left (page, filters, sort).
  return <OrderDetailPanel orderId={id} onClose={() => router.push(ordersListHref())} variant="page" />;
}
