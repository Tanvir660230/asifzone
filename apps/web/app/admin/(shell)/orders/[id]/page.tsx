"use client";

import { useParams, useRouter } from "next/navigation";
import { OrderDetailPanel } from "@/components/admin/order-detail-panel";

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  return <OrderDetailPanel orderId={id} onClose={() => router.push("/admin/orders")} variant="page" />;
}
